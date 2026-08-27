// File-to-labels pipeline: render PDFs/images, normalize orientation, segment
// multi-label sheets, then decode barcodes per label region.
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readBarcodes as readWasmBarcodes } from 'zxing-wasm/reader';
import { mergeExtractedText, recognizeCanvasText, recognizeBarcodeCropText } from '../ocrText.js';
import { isUprightOrientation, pickRotationCandidates, findLabelRegions } from '../preprocess.js';
import { FORMAT_KIND } from './barcodeTypes.js';
import { debugWarn } from './debugLog.js';
import {
  rotateCanvas,
  cropCanvas,
  scaleCanvas,
  thresholdCanvas,
  sharpenCanvas,
  addWhiteBorderWithInfo,
  trimDarkBoundsWithOffset,
  squareCanvasWithInfo,
  downscaleCanvasSmooth,
  canvasLuminanceSample,
  countLinearBars,
  measureLinearBarExtent
} from './canvasUtils.js';
import {
  enhanceInputForQuality,
  residualSkewDegrees,
  estimateSkewByProjection,
  rotateCanvasFine,
  assessLabelQuality
} from './inputPrep.js';
import { dedupeBarcodes, detectWithBrowserBarcodeDetector, zxingDecodeCanvas, wasmDecodeCanvas } from './decoders.js';
import { createLabelImages } from './labelImages.js';
import {
  buildCategorizedScanTargets,
  mapBarcodeToPage,
  textContentItemsToLines,
  textEntriesFromItems,
  assignTextEntriesToRegions,
  linesFromTextEntries
} from './scanPlan.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// PDF pages are rendered at high scale so small barcode modules survive
// rasterization. Raising this improves decode odds but costs memory and CPU.
export const PDF_RENDER_SCALE = 4.0;

export const MAX_PDF_PAGES = 40;

export const MAX_IMAGE_PIXELS = 50_000_000;

export const PDF_TEXT_LAYER_MIN_USEFUL_CHARS = 80;

export const SCAN_VARIANT_LABELS = {
  linear: ['original', 'trimmed + border', '2x nearest', '4x nearest', 'threshold 150', 'threshold 185', 'sharpen 2x'],
  qr: ['original', 'trimmed + border', '2x nearest', 'square pure 2x', 'sharpen 2x'],
  datamatrix: [
    'original',
    'trimmed + border',
    '2x nearest',
    '4x nearest',
    'threshold 150',
    'square pure 2x',
    'sharpen 2x'
  ],
  mixed: ['original', 'trimmed + border', '2x nearest', 'sharpen 2x']
};

export const SCAN_TRIM_SETTINGS = {
  datamatrix: { padding: 8, threshold: 220, borderRatio: 0.18 },
  default: { padding: 18, threshold: 210, borderRatio: 0.08 }
};

export const ORIENTATION_PROBE_MAX_DIM = 1500;

export const SEGMENT_MARGIN_FRAC = 0.012;

/** Yields to the event loop so long scans keep the UI responsive. */
export function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Builds the preprocessed canvas variants (trim, threshold, scale...) for one target.
 * Every variant records the affine transform that produced it (base = variant / scale + d),
 * so a symbol decoded from ANY variant can map its bounding box back to true page
 * coordinates instead of falling back to fixed template crops.
 */
export function makeScanVariants(baseCanvas, kind, labels = null) {
  const allowed = labels ? new Set(labels) : null;
  const variants = [];
  const add = (label, makeVariant, options = {}) => {
    if (!allowed || allowed.has(label)) {
      const made = makeVariant();
      variants.push({ label, canvas: made.canvas, transform: made.transform, options });
    }
  };
  const trimSettings = kind === FORMAT_KIND.datamatrix ? SCAN_TRIM_SETTINGS.datamatrix : SCAN_TRIM_SETTINGS.default;
  const trimInfo = trimDarkBoundsWithOffset(baseCanvas, trimSettings.padding, trimSettings.threshold);
  const trimmed = trimInfo.canvas;
  const borderInfo = addWhiteBorderWithInfo(trimmed, trimSettings.borderRatio);
  const bordered = borderInfo.canvas;
  const borderedTransform = scale => ({
    scale,
    dx: trimInfo.dx - borderInfo.border,
    dy: trimInfo.dy - borderInfo.border
  });
  let bordered2x = null;
  const getBordered2x = () => {
    if (!bordered2x) bordered2x = scaleCanvas(bordered, 2);
    return bordered2x;
  };
  add('original', () => ({ canvas: baseCanvas, transform: { scale: 1, dx: 0, dy: 0 } }));
  add('trimmed + border', () => ({ canvas: bordered, transform: borderedTransform(1) }));
  add('2x nearest', () => ({ canvas: getBordered2x(), transform: borderedTransform(2) }));
  add('4x nearest', () => ({ canvas: scaleCanvas(bordered, 4), transform: borderedTransform(4) }));
  add('threshold 150', () => ({ canvas: thresholdCanvas(getBordered2x(), 150), transform: borderedTransform(2) }), {
    binarizer: 'FixedThreshold'
  });
  add('threshold 185', () => ({ canvas: thresholdCanvas(getBordered2x(), 185), transform: borderedTransform(2) }), {
    binarizer: 'FixedThreshold'
  });
  // Smooth-upscale + unsharp: recovers crisp bar edges on blurry/low-resolution input.
  add('sharpen 2x', () => ({ canvas: sharpenCanvas(bordered, 2, 1.0), transform: borderedTransform(2) }));
  if (kind === FORMAT_KIND.datamatrix || kind === FORMAT_KIND.qr) {
    add(
      'square pure 2x',
      () => {
        const sq = squareCanvasWithInfo(trimmed, 0.2);
        return {
          canvas: scaleCanvas(sq.canvas, 2),
          transform: { scale: 2, dx: trimInfo.dx - sq.ox, dy: trimInfo.dy - sq.oy }
        };
      },
      { isPure: true, binarizer: 'FixedThreshold' }
    );
    add(
      'square pure 4x',
      () => {
        if (kind === FORMAT_KIND.datamatrix) {
          const sq = squareCanvasWithInfo(trimmed, 0.16);
          return {
            canvas: scaleCanvas(sq.canvas, 4),
            transform: { scale: 4, dx: trimInfo.dx - sq.ox, dy: trimInfo.dy - sq.oy }
          };
        }
        return { canvas: scaleCanvas(bordered, 4), transform: borderedTransform(4) };
      },
      { isPure: true }
    );
  }
  return variants;
}

/** Chooses which scan variants apply for the given barcode kind. */
export function selectScanVariants(baseCanvas, kind) {
  const preferred = SCAN_VARIANT_LABELS[kind] || SCAN_VARIANT_LABELS.mixed;
  return makeScanVariants(baseCanvas, kind, preferred);
}

/** True once a targeted scan already produced the kind it was looking for. */
export function shouldStopTargetScan(target, found) {
  if (!found.length) return false;
  if (target.kind === FORMAT_KIND.datamatrix || target.kind === FORMAT_KIND.qr) return true;
  if (target.kind === FORMAT_KIND.linear) return true;
  return found.length >= 2;
}

/** Truncates long decoded values for log readability. */
export function shortenBarcodeValue(value, maxLength = 42) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

/** One-line summary of decoded values for the scan debug log. */
export function detectorResultSummary(decoded) {
  if (!decoded.length) return 'no detector results';
  return decoded
    .map(barcode => {
      const source = barcode.source || 'Unknown detector';
      const format = barcode.format || barcode.symbology || 'unknown format';
      const variant = barcode.variantLabel ? ` via ${barcode.variantLabel}` : '';
      return `${source} (${format}${variant}) "${shortenBarcodeValue(barcode.rawValue)}"`;
    })
    .join('; ');
}

/** Formats decoder/region/variant provenance for a decoded barcode. */
export function decodedSourceEvidence(decoded) {
  return decoded.map(d => ({
    source: d.source || 'Unknown detector',
    format: d.format || d.symbology || 'unknown format',
    variantLabel: d.variantLabel || '',
    rawValue: d.rawValue || ''
  }));
}

/** Normalized per-target scan record kept for the diagnostics panel. */
export function scanDiagnostic(target, decoded, pageNumber, durationMs, extra = {}) {
  return {
    pageNumber,
    kind: target.kind,
    label: target.label,
    formats: target.formats,
    decodedCount: decoded.length,
    width: target.canvas.width,
    height: target.canvas.height,
    decodedValues: decoded.map(d => d.rawValue),
    decodedSources: decodedSourceEvidence(decoded),
    durationMs,
    ...extra
  };
}

/** Measures ink density and transition stats for a canvas region. */
export function imageStats(canvas, label) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  if (!width || !height) return { label, blackRatio: 0, transitionRate: 0, evidence: `${label}: empty region` };
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 180));
  let samples = 0;
  let black = 0;
  let transitions = 0;
  let previous = null;

  for (let y = 0; y < height; y += step) {
    previous = null;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const grey = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
      const isBlack = grey < 110;
      if (isBlack) black += 1;
      if (previous !== null && previous !== isBlack) transitions += 1;
      previous = isBlack;
      samples += 1;
    }
  }

  const blackRatio = samples ? black / samples : 0;
  const transitionRate = samples ? transitions / samples : 0;
  return {
    label,
    blackRatio,
    transitionRate,
    evidence: `${label}: blackRatio=${blackRatio.toFixed(3)}, transitionRate=${transitionRate.toFixed(3)}, size=${width}x${height}`
  };
}

/** Returns the strongest barcode-like cell stats over an n-by-n grid. */
export function bestStatsOverGrid(canvas, label, cellsX = 5, cellsY = 5) {
  let best = null;
  const minCell = 40;
  for (let gy = 0; gy < cellsY; gy += 1) {
    for (let gx = 0; gx < cellsX; gx += 1) {
      const cw = Math.max(minCell, Math.floor((canvas.width / cellsX) * 1.5));
      const ch = Math.max(minCell, Math.floor((canvas.height / cellsY) * 1.5));
      const x = Math.min(canvas.width - cw, Math.floor((canvas.width - cw) * (gx / Math.max(1, cellsX - 1))));
      const y = Math.min(canvas.height - ch, Math.floor((canvas.height - ch) * (gy / Math.max(1, cellsY - 1))));
      const crop = cropCanvas(canvas, Math.max(0, x), Math.max(0, y), cw, ch);
      const stats = imageStats(crop, `${label} grid ${gx},${gy}`);
      const score = stats.blackRatio * 1.2 + stats.transitionRate * 3.0;
      if (!best || score > best.score) best = { ...stats, score, x, y, width: cw, height: ch };
    }
  }
  return best || imageStats(canvas, `${label} grid empty`);
}

/** Heuristically checks whether barcode-like ink exists even if undecodable. */
export function detectVisualBarcodeEvidence(canvas) {
  const w = canvas.width;
  const h = canvas.height;

  // Visual evidence is a backup when a symbol appears on the label but does not decode.
  // These heuristics are not pass/fail barcode verification; they help explain likely
  // scanner misses in the report so a reviewer knows where to look.
  const dataMatrixBroadRegion = cropCanvas(canvas, w * 0.55, h * 0.02, w * 0.43, h * 0.3);
  const dataMatrixExactRegion = cropCanvas(canvas, w * 0.74, h * 0.09, w * 0.23, h * 0.17);
  const rightStripeRegion = cropCanvas(canvas, w * 0.7, h * 0.25, w * 0.28, h * 0.62);
  const lowerBarcodeRegion = cropCanvas(canvas, w * 0.05, h * 0.45, w * 0.9, h * 0.25);

  const dmBroadStats = imageStats(dataMatrixBroadRegion, 'top-right DataMatrix broad visual region');
  const dmExactStats = imageStats(dataMatrixExactRegion, 'top-right DataMatrix expected visual region');
  const dmGridStats = bestStatsOverGrid(dataMatrixBroadRegion, 'top-right DataMatrix', 5, 4);
  const rightStats = imageStats(rightStripeRegion, 'right-side linear barcode visual region');
  const lowerStats = imageStats(lowerBarcodeRegion, 'lower linear barcode visual region');

  const dmCandidates = [dmBroadStats, dmExactStats, dmGridStats];
  const dataMatrixVisible =
    dmCandidates.some(stats => stats.blackRatio > 0.055 && stats.transitionRate > 0.012) ||
    dmCandidates.some(stats => stats.blackRatio > 0.11 && stats.transitionRate > 0.008);

  const linearBarcodeVisible =
    (rightStats.blackRatio > 0.08 && rightStats.transitionRate > 0.035) ||
    (lowerStats.blackRatio > 0.08 && lowerStats.transitionRate > 0.035);

  return {
    dataMatrixVisible,
    linearBarcodeVisible,
    dataMatrixEvidence: [dmBroadStats.evidence, dmExactStats.evidence, dmGridStats.evidence].join('; '),
    linearEvidence: `${rightStats.evidence}; ${lowerStats.evidence}`,
    regions: [dmBroadStats, dmExactStats, dmGridStats, rightStats, lowerStats]
  };
}

/**
 * Refines a linear hit while the canvas it decoded from is still in hand:
 * 1D result points sit on a single scanline, so the reported box height is
 * unreliable - measure the true bar extent before the box drives outlines,
 * evidence crops and the HRI OCR crop. Then attach the measured bar count
 * (encodation evidence, e.g. the compressed StarTrack freight barcode always
 * has 61 bars) using the corrected box.
 */
function refineLinearHit(hit, canvas) {
  let out = hit;
  if (out?.boundingBox && /128/i.test(String(out.format || ''))) {
    const extent = measureLinearBarExtent(canvas, out.boundingBox);
    if (extent && extent.height > out.boundingBox.height) {
      out = { ...out, boundingBox: { ...out.boundingBox, y: extent.y, height: extent.height } };
    }
    if (out.barCount == null) {
      const barCount = countLinearBars(canvas, out.boundingBox);
      if (barCount != null) out = { ...out, barCount };
    }
  }
  return out;
}

/** Runs every available decode engine over one scan target until something reads. */
export async function scanTargetWithAllEngines(target, detector, pageNumber = 1) {
  const found = [];
  const categoryFormats = target.formats || ['Code128', 'DataMatrix'];
  const variants = selectScanVariants(target.canvas, target.kind);

  // Native reads are attempted first so browsers with reliable support can avoid
  // unnecessary WASM/JS passes on the same crop.
  if (detector) {
    const browserHits = await detectWithBrowserBarcodeDetector(target.canvas, detector, pageNumber, target.label);
    found.push(...browserHits.map(hit => mapBarcodeToPage(refineLinearHit(hit, target.canvas), target, 'original')));
    if (shouldStopTargetScan(target, found)) return found;
  }

  for (const variant of variants) {
    // WASM is the main cross-browser decoder for Australia Post label symbols.
    const wasmHits = await wasmDecodeCanvas(
      variant.canvas,
      pageNumber,
      target.label,
      categoryFormats,
      target.kind,
      variant.label,
      variant.options || {}
    );
    found.push(
      ...wasmHits.map(hit =>
        mapBarcodeToPage(refineLinearHit(hit, variant.canvas), target, variant.label, variant.transform)
      )
    );
    if (shouldStopTargetScan(target, found)) return found;

    // The JS reader is retained for scanner diversity, but only after WASM misses
    // on the current crop variant.
    if (!wasmHits.length) {
      const jsHits = zxingDecodeCanvas(
        variant.canvas,
        pageNumber,
        target.label,
        categoryFormats,
        target.kind,
        variant.label
      );
      found.push(
        ...jsHits.map(hit =>
          mapBarcodeToPage(refineLinearHit(hit, variant.canvas), target, variant.label, variant.transform)
        )
      );
      if (shouldStopTargetScan(target, found)) return found;
    }
  }

  // Rotated linear scans are expensive and only pay off when all normal variants miss.
  if (target.kind === FORMAT_KIND.linear && !found.length) {
    for (const variant of variants.slice(0, 2)) {
      for (const degrees of [90, 270]) {
        const rotated = rotateCanvas(variant.canvas, degrees);
        const rotatedTransform = variant.transform
          ? { ...variant.transform, rotate: degrees, rotatedWidth: rotated.width, rotatedHeight: rotated.height }
          : null;
        const rotWasmHits = await wasmDecodeCanvas(
          rotated,
          pageNumber,
          target.label,
          categoryFormats,
          target.kind,
          `${variant.label} rotated ${degrees}`,
          variant.options || {}
        );
        found.push(
          ...rotWasmHits.map(hit =>
            mapBarcodeToPage(
              refineLinearHit(hit, rotated),
              target,
              `${variant.label} rotated ${degrees}`,
              rotatedTransform
            )
          )
        );
        if (shouldStopTargetScan(target, found)) return found;
      }
    }
  }

  return found;
}

/** Scans one label canvas through all planned targets and dedupes the results. */
export async function detectOnCanvas(canvas, detector, pageNumber = 1, onDebug = null, labelFamily = 'eparcel') {
  const found = [];
  const scanDiagnostics = [];
  const targets = buildCategorizedScanTargets(canvas, labelFamily);

  // The full-page safety scan now always runs (never skipped): a barcode that a
  // targeted per-role crop misses - like an ATL that reads from the whole label but
  // not its tight crop - must still be captured, so value capture never depends on
  // crop alignment. Each target's own variants already include a sharpen+upscale pass.
  for (const target of targets) {
    const scanStart = performance.now();
    const decoded = await scanTargetWithAllEngines(target, detector, pageNumber);
    const durationMs = performance.now() - scanStart;
    found.push(...decoded);
    scanDiagnostics.push(scanDiagnostic(target, decoded, pageNumber, durationMs));
    if (decoded.length || durationMs >= 1000) {
      onDebug?.(
        `Scan target "${target.label}" found ${decoded.length} candidate${decoded.length === 1 ? '' : 's'}: ${detectorResultSummary(decoded)}`,
        durationMs
      );
    }
  }

  const barcodes = dedupeBarcodes(found).map((b, index) => ({ ...b, index }));
  barcodes.scanDiagnostics = scanDiagnostics;
  return { barcodes, scanDiagnostics };
}

/** Fast full-page decode used only to read symbol orientation, not values. */
export async function quickSymbolProbe(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const results = await readWasmBarcodes(imageData, {
      formats: ['QRCode', 'DataMatrix', 'Code128'],
      tryHarder: true,
      tryRotate: true,
      tryInvert: false,
      tryDownscale: true,
      maxNumberOfSymbols: 8,
      returnErrors: false
    });
    return (results || [])
      .filter(r => r && r.text && r.isValid !== false && Number.isFinite(r.orientation))
      .map(r => ({ format: r.format, orientation: r.orientation }));
  } catch (error) {
    debugWarn('Orientation probe failed', error);
    return [];
  }
}

/**
 * Detects sideways/upside-down input from decoded symbol orientation and returns
 * an upright canvas. Each rotation candidate is verified by re-probing a rotated
 * downscale, so no assumption is made about the decoder's angle sign convention.
 */
export async function normalizeCanvasOrientation(canvas, mark = null, contextLabel = 'input') {
  const probeStart = performance.now();
  const probe = downscaleCanvasSmooth(canvas, ORIENTATION_PROBE_MAX_DIM);
  const symbols = await quickSymbolProbe(probe);
  if (!symbols.length || isUprightOrientation(symbols)) {
    mark?.(
      `Orientation check (${contextLabel}): upright or undetermined from ${symbols.length} reference symbol${symbols.length === 1 ? '' : 's'}`,
      performance.now() - probeStart
    );
    return { canvas, rotation: 0, symbols };
  }
  for (const candidate of pickRotationCandidates(symbols)) {
    const verify = await quickSymbolProbe(rotateCanvas(probe, candidate));
    if (verify.length && isUprightOrientation(verify)) {
      mark?.(
        `Orientation check (${contextLabel}): rotated input detected; auto-corrected by ${candidate} degrees`,
        performance.now() - probeStart
      );
      return { canvas: rotateCanvas(canvas, candidate), rotation: candidate, symbols };
    }
  }
  mark?.(
    `Orientation check (${contextLabel}): rotation suspected but could not be verified; continuing with the original orientation`,
    performance.now() - probeStart
  );
  return { canvas, rotation: 0, symbols };
}

/**
 * Corrects the few degrees of scanner/camera tilt the quarter-turn orientation
 * pass cannot see. The residual angle comes from decoded symbol orientation when
 * available (verified by re-probing a rotated downscale, so the decoder's angle
 * sign convention is never assumed); when nothing decoded, a projection-profile
 * estimate on the luminance sample covers scans too degraded to read yet - the
 * exact case where straightening most helps the retry and the OCR. Residuals
 * mod 90 are invariant under the quarter-turn fix, so the original probe
 * symbols stay valid here.
 */
export async function fineDeskewCanvas(canvas, symbols = [], mark = null, contextLabel = 'input') {
  const start = performance.now();
  const residual = residualSkewDegrees(symbols);
  let candidates = residual ? [-residual, residual] : [];
  if (!candidates.length) {
    const { lum, width, height } = canvasLuminanceSample(canvas, 480);
    const projected = estimateSkewByProjection(lum, width, height);
    if (projected) candidates = [projected];
  }
  if (!candidates.length) return { canvas, degrees: 0 };

  let chosen = null;
  if (residual) {
    const probe = downscaleCanvasSmooth(canvas, ORIENTATION_PROBE_MAX_DIM);
    let bestAbs = Math.abs(residual);
    for (const candidate of candidates) {
      const verify = await quickSymbolProbe(rotateCanvasFine(probe, candidate));
      if (!verify.length) continue;
      const remainingAbs = Math.abs(residualSkewDegrees(verify));
      if (remainingAbs < bestAbs - 0.2) {
        bestAbs = remainingAbs;
        chosen = candidate;
      }
    }
    if (chosen == null) {
      mark?.(
        `Deskew check (${contextLabel}): ${Math.abs(residual).toFixed(1)} degree tilt suspected but could not be verified; keeping original geometry`,
        performance.now() - start
      );
      return { canvas, degrees: 0 };
    }
  } else {
    chosen = candidates[0];
  }
  mark?.(
    `Deskew (${contextLabel}): straightened a ${Math.abs(chosen).toFixed(1)} degree scan tilt`,
    performance.now() - start
  );
  return { canvas: rotateCanvasFine(canvas, chosen), degrees: Math.round(chosen * 10) / 10 };
}

/**
 * Splits a sheet carrying multiple labels (e.g. A4 with 2 or 4 labels) into
 * per-label canvases with a small margin. Returns a single full-canvas segment
 * when no confident multi-label layout is found.
 */
export function segmentLabelCanvases(canvas, mark = null, contextLabel = 'input') {
  const segStart = performance.now();
  const { lum, width, height } = canvasLuminanceSample(canvas);
  const regions = findLabelRegions(lum, width, height);
  if (regions.length < 2) {
    return [{ canvas, region: null }];
  }
  const margin = Math.round(Math.min(canvas.width, canvas.height) * SEGMENT_MARGIN_FRAC);
  const segments = regions.map(region => {
    const x = Math.max(0, Math.round(region.x * canvas.width) - margin);
    const y = Math.max(0, Math.round(region.y * canvas.height) - margin);
    const w = Math.min(canvas.width - x, Math.round(region.w * canvas.width) + margin * 2);
    const h = Math.min(canvas.height - y, Math.round(region.h * canvas.height) + margin * 2);
    return { canvas: cropCanvas(canvas, x, y, w, h), region: { x, y, w, h } };
  });
  segments.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
  mark?.(
    `Multi-label sheet detected (${contextLabel}): split into ${segments.length} label regions`,
    performance.now() - segStart
  );
  return segments;
}

/** True when the PDF text layer is too sparse to audit and OCR should run. */
export function pdfTextLayerNeedsOcr(lines) {
  const usefulChars = lines.join(' ').replace(/[^A-Za-z0-9]/g, '').length;
  return usefulChars < PDF_TEXT_LAYER_MIN_USEFUL_CHARS;
}

export const NATIVE_RENDER_MIN_SCALE = 1.25;
export const NATIVE_RENDER_MAX_SCALE = 8;

/**
 * For an image-only (scanned) PDF page, finds the embedded scan's native pixel
 * size and returns the render scale that maps it 1:1 onto the canvas - so decode
 * and OCR see every pixel the scanner captured instead of a fixed multiple that
 * silently up- or down-samples it. Returns null (caller keeps PDF_RENDER_SCALE)
 * whenever the page does not look like a single full-page scan, or inspection
 * fails or times out; everything here is best-effort and bounded because the
 * PDF is untrusted input.
 */
async function scannedPageNativeScale(page, viewport72) {
  const withTimeout = (promise, ms) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  const ops = await withTimeout(page.getOperatorList(), 6000);
  const names = [];
  for (let i = 0; i < ops.fnArray.length && names.length < 8; i += 1) {
    if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject) names.push(ops.argsArray[i][0]);
  }
  let best = null;
  for (const name of names) {
    const image = await withTimeout(
      new Promise((resolve, reject) => {
        try {
          page.objs.get(name, resolve);
        } catch (error) {
          reject(error);
        }
      }),
      2500
    ).catch(() => null);
    if (image?.width > 0 && image?.height > 0 && (!best || image.width * image.height > best.width * best.height)) {
      best = { width: image.width, height: image.height };
    }
  }
  if (!best) return null;
  // Only trust an image that plausibly IS the scanned page (similar aspect ratio).
  const aspectRatio = best.width / best.height / (viewport72.width / viewport72.height);
  if (aspectRatio < 0.7 || aspectRatio > 1.4) return null;
  let scale = best.width / viewport72.width;
  if (!Number.isFinite(scale) || scale < NATIVE_RENDER_MIN_SCALE) return null;
  scale = Math.min(scale, NATIVE_RENDER_MAX_SCALE, Math.sqrt(MAX_IMAGE_PIXELS / (viewport72.width * viewport72.height)));
  return { scale, imageWidth: best.width, imageHeight: best.height };
}

// At most this many decoded barcodes get a dedicated HRI OCR pass per label.
const MAX_BARCODE_CROP_OCR = 4;

/**
 * Targeted OCR over the located barcode regions, expanded to include the
 * human-readable line printed with each symbol. The crops get an aggressive
 * contrast/sharpen profile that would degrade the label's general text, which is
 * why this runs separately from the gentle full-label pass. Returns merged text
 * that is only ever used as visible-text evidence (one-way cross-check).
 */
async function recognizeBarcodeCropOcr(canvas, detectedBarcodes, mark, contextLabel) {
  const located = (detectedBarcodes || []).filter(b => b?.pageBoundingBox).slice(0, MAX_BARCODE_CROP_OCR);
  const texts = [];
  for (const [index, barcode] of located.entries()) {
    const box = barcode.pageBoundingBox;
    // HRI digits print above/below the symbol: pad generously sideways and extend
    // well below (and a little above) the decoded bounding box.
    const padX = Math.round(box.width * 0.2) + 12;
    const x = Math.max(0, Math.round(box.x - padX));
    const w = Math.min(canvas.width - x, Math.round(box.width + padX * 2));
    const y = Math.max(0, Math.round(box.y - box.height * 0.5 - 10));
    const h = Math.min(canvas.height - y, Math.round(box.height * 2.2 + 20));
    if (w < 40 || h < 24) continue;
    const crop = cropCanvas(canvas, x, y, w, h);
    const ocr = await recognizeBarcodeCropText(crop, mark, `${contextLabel} barcode crop ${index + 1}`);
    if (ocr.text) texts.push(ocr.text);
    await yieldToBrowser();
  }
  return mergeExtractedText(...texts);
}

/** Image upload pipeline: orient, segment and scan; returns one entry per label. */
export async function processImageLabels(file, detector, onDebug = null, labelFamily = 'eparcel') {
  const fileStart = performance.now();
  const mark = (message, startedAt = fileStart) => onDebug?.(message, performance.now() - startedAt);
  const imgUrl = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  try {
    img.src = imgUrl;
    const decodeStart = performance.now();
    await img.decode();
    if (img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error(
        `Image ${file.name} is too large to process safely (${img.naturalWidth}x${img.naturalHeight}px).`
      );
    }
    mark(`Decoded image ${file.name} (${img.naturalWidth}x${img.naturalHeight}px)`, decodeStart);

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = img.naturalWidth;
    baseCanvas.height = img.naturalHeight;
    const ctx = baseCanvas.getContext('2d', { willReadFrequently: true });
    const drawStart = performance.now();
    ctx.drawImage(img, 0, 0);
    mark('Rendered image to canvas', drawStart);
    await yieldToBrowser();
    // First step: normalize input quality (upscale small scans, lift faded contrast)
    // so every later operation reads the clearest copy. The factor lets us still report
    // the true source resolution rather than the enhanced one.
    const enhanceStart = performance.now();
    const enhanced = enhanceInputForQuality(baseCanvas);
    const qualityFactor = enhanced.factor;
    mark(
      `Quality preprocess (image ${file.name}): contrast ${enhanced.contrastApplied ? 'normalized for faded scan' : 'already full-range, left unchanged'}`,
      enhanceStart
    );
    await yieldToBrowser();

    const oriented = await normalizeCanvasOrientation(enhanced.canvas, mark, `image ${file.name}`);
    await yieldToBrowser();
    // Alignment: correct the small tilt scanners/cameras introduce before any
    // segmentation, decode or OCR sees the canvas.
    const deskewed = await fineDeskewCanvas(oriented.canvas, oriented.symbols, mark, `image ${file.name}`);
    await yieldToBrowser();
    const segments = segmentLabelCanvases(deskewed.canvas, mark, `image ${file.name}`);

    const labels = [];
    for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
      const canvas = segments[segIndex].canvas;
      const segLabel = segments.length > 1 ? `label ${segIndex + 1} of ${segments.length}` : null;
      const segContext = `image ${file.name}${segLabel ? ` ${segLabel}` : ''}`;
      const visualStart = performance.now();
      const visualEvidence = detectVisualBarcodeEvidence(canvas);
      mark(`Checked visual barcode evidence (${segContext})`, visualStart);
      await yieldToBrowser();
      const scanStart = performance.now();
      const scanResult = await detectOnCanvas(canvas, detector, 1, mark, labelFamily);
      const detected = scanResult.barcodes;
      mark(`Decoded barcode candidates (${detected.length}) for ${segContext}`, scanStart);
      await yieldToBrowser();
      const imageStart = performance.now();
      const labelImages = createLabelImages(canvas, detected, labelFamily);
      mark(`Generated label preview and barcode crops (${segContext})`, imageStart);
      await yieldToBrowser();
      // OCR is the final information grab: barcodes are the primary source of truth,
      // so they are decoded first; OCR then reads the whole label as text to supplement
      // them for validation (the label prints every barcode value in human-readable form,
      // so OCR backs up any value a barcode failed to decode). Located symbols are masked
      // out of the full-label pass - their black mass only degrades layout analysis, and
      // the dedicated crop pass below reads their HRI digits anyway.
      const ocr = await recognizeCanvasText(canvas, mark, segContext, {
        maskBoxes: detected.filter(b => b.pageBoundingBox).map(b => b.pageBoundingBox)
      });
      // The gentle full-label pass often misses the small HRI digits printed with each
      // barcode; a second, aggressive pass over just the located barcode crops recovers
      // them for the printed-vs-decoded cross-checks.
      const cropOcrText = await recognizeBarcodeCropOcr(canvas, detected, mark, segContext);
      const ocrText = mergeExtractedText(ocr.text, cropOcrText);
      const quality = assessLabelQuality(canvas, {
        widthMm: null,
        barcodes: detected,
        deskewDegrees: deskewed.degrees,
        contrastApplied: enhanced.contrastApplied
      });
      await yieldToBrowser();

      labels.push({
        fileInfo: {
          filename: file.name,
          fileType: file.type || 'image',
          pageCount: 1,
          pixelWidth: Math.round(canvas.width / qualityFactor),
          pixelHeight: Math.round(canvas.height / qualityFactor),
          widthMm: null,
          heightMm: null,
          pageLabel: segLabel || undefined,
          preprocess: {
            rotationApplied: oriented.rotation,
            deskewDegrees: deskewed.degrees,
            segmentIndex: segIndex + 1,
            segmentCount: segments.length
          },
          quality,
          note: 'Raster images do not reliably expose physical DPI. A6 dimensions are assumed for layout heuristics.',
          textSources: ocrText ? ['ocr'] : [],
          ocr: { status: ocr.status, charCount: ocr.charCount, detail: ocr.detail, confidence: ocr.confidence ?? null }
        },
        detectedBarcodes: detected,
        visualEvidence,
        labelImages,
        scanDiagnostics: scanResult.scanDiagnostics || [],
        extractedText: ocrText
      });
      await yieldToBrowser();
    }
    mark(`Completed image ${file.name} (${labels.length} label${labels.length === 1 ? '' : 's'})`, fileStart);
    return labels;
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

/** PDF upload pipeline: render, orient, segment and scan every page; one entry per label. */
export async function processPdfLabels(file, detector, onDebug = null, labelFamily = 'eparcel') {
  const fileStart = performance.now();
  const mark = (message, startedAt = fileStart) => onDebug?.(message, performance.now() - startedAt);
  const bufferStart = performance.now();
  const data = new Uint8Array(await file.arrayBuffer());
  mark(`Loaded PDF bytes for ${file.name} (${Math.round(file.size / 1024)} KB)`, bufferStart);
  const documentStart = performance.now();
  // isEvalSupported: false blocks the font/PostScript eval path inside pdf.js
  // (CVE-2024-4367 class) - uploaded PDFs are untrusted input.
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new Error(`PDF ${file.name} has ${pdf.numPages} pages; the safe limit is ${MAX_PDF_PAGES} pages per file.`);
  }
  mark(`Opened PDF document (${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'})`, documentStart);
  const labels = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pageStart = performance.now();
    mark(`Started page ${pageNumber} of ${pdf.numPages}`, pageStart);
    const getPageStart = performance.now();
    const page = await pdf.getPage(pageNumber);
    mark(`Loaded PDF page ${pageNumber}`, getPageStart);
    const viewport72 = page.getViewport({ scale: 1 });
    const pageMm = {
      widthMm: (viewport72.width * 25.4) / 72,
      heightMm: (viewport72.height * 25.4) / 72
    };

    const textStart = performance.now();
    const textContent = await page.getTextContent().catch(() => ({ items: [] }));
    const pageLines = textContentItemsToLines(textContent.items || []);
    mark(
      `Extracted text from page ${pageNumber} (${pageLines.length} line${pageLines.length === 1 ? '' : 's'})`,
      textStart
    );

    // Vector pages render at the fixed high scale; image-only (scanned) pages
    // render at the embedded scan's own resolution when it can be determined.
    let renderScale = PDF_RENDER_SCALE;
    if (pdfTextLayerNeedsOcr(pageLines)) {
      const nativeStart = performance.now();
      const native = await scannedPageNativeScale(page, viewport72).catch(() => null);
      if (native) {
        renderScale = native.scale;
        mark(
          `Scanned page detected on page ${pageNumber}; rendering at the embedded scan's native resolution (${native.imageWidth}x${native.imageHeight}px, ~${Math.round(renderScale * 72)} DPI)`,
          nativeStart
        );
      }
    }
    const viewport = page.getViewport({ scale: renderScale });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.floor(viewport.width);
    renderCanvas.height = Math.floor(viewport.height);
    const ctx = renderCanvas.getContext('2d', { willReadFrequently: true });
    const renderStart = performance.now();
    await page.render({ canvasContext: ctx, viewport }).promise;
    mark(`Rendered page ${pageNumber} to canvas (${renderCanvas.width}x${renderCanvas.height}px)`, renderStart);
    await yieldToBrowser();
    // First step: normalize input quality. High-DPI vector renders are already
    // full-range and pass through; this mainly lifts faded contrast on scanned-image PDFs.
    const enhanceStart = performance.now();
    const enhanced = enhanceInputForQuality(renderCanvas);
    const qualityFactor = enhanced.factor;
    mark(
      `Quality preprocess (page ${pageNumber}): contrast ${enhanced.contrastApplied ? 'normalized for faded scan' : 'already full-range, left unchanged'}`,
      enhanceStart
    );
    await yieldToBrowser();

    const oriented = await normalizeCanvasOrientation(enhanced.canvas, mark, `page ${pageNumber}`);
    // Alignment: correct the small scanner tilt before segmentation, decode or OCR.
    const deskewed = await fineDeskewCanvas(oriented.canvas, oriented.symbols, mark, `page ${pageNumber}`);
    const rotatedQuarter = oriented.rotation === 90 || oriented.rotation === 270;
    const orientedMm = rotatedQuarter ? { widthMm: pageMm.heightMm, heightMm: pageMm.widthMm } : pageMm;
    // Only hunt for multiple labels when the sheet is bigger than any single
    // label format (A4 portrait/landscape and larger).
    const attemptSegmentation = Math.min(orientedMm.widthMm, orientedMm.heightMm) > 170;
    const segments = attemptSegmentation
      ? segmentLabelCanvases(deskewed.canvas, mark, `page ${pageNumber}`)
      : [{ canvas: deskewed.canvas, region: null }];
    await yieldToBrowser();

    // A segmented upright sheet keeps its exact PDF text layer: entries are split
    // between the label regions by position, so one label's facts can never
    // contaminate another. Once the canvas geometry changed (quarter rotation or
    // deskew) the item coordinates no longer match and OCR takes over instead.
    const geometryUnchanged = oriented.rotation === 0 && !deskewed.degrees;
    let segmentTextLines = null;
    if (geometryUnchanged && segments.length > 1 && pageLines.length && segments.every(s => s.region)) {
      const buckets = assignTextEntriesToRegions(
        textEntriesFromItems(textContent.items || []),
        segments.map(s => s.region),
        renderScale,
        viewport72.height
      );
      segmentTextLines = buckets.map(bucket => linesFromTextEntries(bucket));
    }

    for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
      const canvas = segments[segIndex].canvas;
      const region = segments[segIndex].region;
      const isSegmented = segments.length > 1;
      const segLabel = isSegmented ? `label ${segIndex + 1} of ${segments.length}` : null;
      const segContext = `PDF page ${pageNumber}${segLabel ? ` ${segLabel}` : ''}`;
      // The text layer applies when the canvas geometry still matches the PDF's
      // coordinates: whole upright pages use it directly, segmented upright sheets
      // use the per-region split computed above, and anything rotated or deskewed
      // falls back to OCR.
      const useTextLayer = geometryUnchanged && (!isSegmented || Boolean(segmentTextLines));
      const segLines = !useTextLayer ? [] : isSegmented ? segmentTextLines[segIndex] : pageLines;
      const shouldOcrPage = useTextLayer ? pdfTextLayerNeedsOcr(segLines) : true;
      const visualStart = performance.now();
      const visualEvidence = detectVisualBarcodeEvidence(canvas);
      mark(`Checked visual barcode evidence on ${segContext}`, visualStart);
      await yieldToBrowser();
      const scanStart = performance.now();
      const pageScan = await detectOnCanvas(canvas, detector, pageNumber, mark, labelFamily);
      const detected = dedupeBarcodes(pageScan.barcodes || []);
      mark(`Decoded ${segContext} barcode candidates (${detected.length})`, scanStart);
      await yieldToBrowser();
      const imageStart = performance.now();
      const labelImages = createLabelImages(canvas, detected, labelFamily);
      mark(`Generated ${segContext} label preview and barcode crops`, imageStart);
      await yieldToBrowser();
      // OCR is the final information grab, after barcodes are decoded. It runs on the
      // rendered page only when the selectable PDF text layer is too sparse to audit;
      // its text is merged with the text layer to supplement the decoded barcodes.
      // Located symbols are masked out of the full pass (their black mass only harms
      // layout analysis); the crop pass below reads their HRI digits regardless.
      const ocr = shouldOcrPage
        ? await recognizeCanvasText(canvas, mark, segContext, {
            maskBoxes: detected.filter(b => b.pageBoundingBox).map(b => b.pageBoundingBox)
          })
        : {
            text: '',
            status: 'skipped',
            charCount: 0,
            detail: 'Selectable PDF text layer was sufficient; OCR not required.'
          };
      // Barcode-crop OCR runs whenever the page needed OCR at all: on scanned/rotated
      // pages the HRI digits are exactly the text the gentle full-page pass misses.
      const cropOcrText = shouldOcrPage ? await recognizeBarcodeCropOcr(canvas, detected, mark, segContext) : '';
      const ocrText = mergeExtractedText(ocr.text, cropOcrText);
      if (!shouldOcrPage) {
        mark(
          `Skipped OCR on page ${pageNumber}; selectable PDF text layer provided sufficient audit text`,
          performance.now()
        );
      }
      const extractedText = mergeExtractedText(segLines.join('\n'), ocrText);
      const segWidthMm =
        isSegmented && region ? orientedMm.widthMm * (region.w / deskewed.canvas.width) : orientedMm.widthMm;
      const segHeightMm =
        isSegmented && region ? orientedMm.heightMm * (region.h / deskewed.canvas.height) : orientedMm.heightMm;
      const quality = assessLabelQuality(canvas, {
        widthMm: segWidthMm,
        barcodes: detected,
        deskewDegrees: deskewed.degrees,
        contrastApplied: enhanced.contrastApplied
      });
      await yieldToBrowser();

      const basePageLabel = pdf.numPages > 1 ? `page ${pageNumber} of ${pdf.numPages}` : 'page 1';
      labels.push({
        fileInfo: {
          filename: file.name,
          fileType: file.type || 'application/pdf',
          pageCount: 1,
          sourcePdfPage: pageNumber,
          sourcePdfPageCount: pdf.numPages,
          pageLabel: segLabel ? `${basePageLabel}, ${segLabel}` : basePageLabel,
          widthMm: segWidthMm,
          heightMm: segHeightMm,
          pixelWidth: Math.round(canvas.width / qualityFactor),
          pixelHeight: Math.round(canvas.height / qualityFactor),
          preprocess: {
            rotationApplied: oriented.rotation,
            deskewDegrees: deskewed.degrees,
            renderDpi: Math.round(renderScale * 72),
            segmentIndex: segIndex + 1,
            segmentCount: segments.length
          },
          quality,
          note: isSegmented
            ? 'Label region cropped from a multi-label sheet and audited as an individual label.'
            : 'PDF page rendered locally in the browser and audited as an individual label.',
          textSources: [...(segLines.length ? ['pdf-text-layer'] : []), ...(ocrText ? ['ocr'] : [])],
          ocr: { status: ocr.status, charCount: ocr.charCount, detail: ocr.detail, confidence: ocr.confidence ?? null }
        },
        detectedBarcodes: detected,
        visualEvidence,
        labelImages,
        scanDiagnostics: pageScan.scanDiagnostics || [],
        extractedText
      });
      await yieldToBrowser();
    }
    mark(`Completed page ${pageNumber} of ${pdf.numPages}`, pageStart);
  }

  mark(`Completed PDF ${file.name}`, fileStart);
  return labels;
}
