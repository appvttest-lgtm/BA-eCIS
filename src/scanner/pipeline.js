// File-to-labels pipeline: render PDFs/images, normalize orientation, segment
// multi-label sheets, then decode barcodes per label region.
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readBarcodes as readWasmBarcodes } from 'zxing-wasm/reader';
import { mergeExtractedText, recognizeCanvasText } from '../ocrText.js';
import { isUprightOrientation, pickRotationCandidates, findLabelRegions } from '../preprocess.js';
import { FORMAT_KIND, isDataMatrixBarcode, isLinearBarcode, isQrBarcode } from './barcodeTypes.js';
import { debugWarn } from './debugLog.js';
import {
  clampBox,
  rotateCanvas,
  cropCanvas,
  scaleCanvas,
  thresholdCanvas,
  addWhiteBorder,
  trimDarkBounds,
  squareCanvas,
  downscaleCanvasSmooth,
  canvasLuminanceSample,
  countLinearBars
} from './canvasUtils.js';
import { dedupeBarcodes, detectWithBrowserBarcodeDetector, zxingDecodeCanvas, wasmDecodeCanvas } from './decoders.js';
import { STARTRACK_LINEAR_TARGETS, createLabelImages } from './labelImages.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// PDF pages are rendered at high scale so small barcode modules survive
// rasterization. Raising this improves decode odds but costs memory and CPU.
export const PDF_RENDER_SCALE = 4.0;

export const MAX_PDF_PAGES = 40;

export const MAX_IMAGE_PIXELS = 50_000_000;

export const PDF_TEXT_LAYER_MIN_USEFUL_CHARS = 80;

export const SCAN_VARIANT_LABELS = {
  linear: ['original', 'trimmed + border', '2x nearest', '4x nearest', 'threshold 150', 'threshold 185'],
  qr: ['original', 'trimmed + border', '2x nearest', 'square pure 2x'],
  datamatrix: ['original', 'trimmed + border', '2x nearest', '4x nearest', 'threshold 150', 'square pure 2x'],
  mixed: ['original', 'trimmed + border', '2x nearest']
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

/** Builds the preprocessed canvas variants (trim, threshold, scale...) for one target. */
export function makeScanVariants(baseCanvas, kind, labels = null) {
  const allowed = labels ? new Set(labels) : null;
  const variants = [];
  const add = (label, makeCanvas, options = {}) => {
    if (!allowed || allowed.has(label)) variants.push({ label, canvas: makeCanvas(), options });
  };
  const trimSettings = kind === FORMAT_KIND.datamatrix ? SCAN_TRIM_SETTINGS.datamatrix : SCAN_TRIM_SETTINGS.default;
  const trimmed = trimDarkBounds(baseCanvas, trimSettings.padding, trimSettings.threshold);
  const bordered = addWhiteBorder(trimmed, trimSettings.borderRatio);
  let bordered2x = null;
  const getBordered2x = () => {
    if (!bordered2x) bordered2x = scaleCanvas(bordered, 2);
    return bordered2x;
  };
  add('original', () => baseCanvas);
  add('trimmed + border', () => bordered);
  add('2x nearest', getBordered2x);
  add('4x nearest', () => scaleCanvas(bordered, 4));
  add('threshold 150', () => thresholdCanvas(getBordered2x(), 150), { binarizer: 'FixedThreshold' });
  add('threshold 185', () => thresholdCanvas(getBordered2x(), 185), { binarizer: 'FixedThreshold' });
  if (kind === FORMAT_KIND.datamatrix || kind === FORMAT_KIND.qr) {
    add('square pure 2x', () => scaleCanvas(squareCanvas(trimmed, 0.2), 2), {
      isPure: true,
      binarizer: 'FixedThreshold'
    });
    add(
      'square pure 4x',
      () => scaleCanvas(kind === FORMAT_KIND.datamatrix ? squareCanvas(trimmed, 0.16) : bordered, 4),
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

/** Defines one crop region scan target with its expected formats. */
export function makeTarget(sourceCanvas, kind, label, x, y, w, h, formats) {
  const targetCanvas =
    x === 0 && y === 0 && w === sourceCanvas.width && h === sourceCanvas.height
      ? sourceCanvas
      : cropCanvas(sourceCanvas, x, y, w, h);
  return { kind, label, x, y, w, h, canvas: targetCanvas, formats };
}

/** True when any decoded barcode matches the given kind. */
export function hasBarcodeKind(barcodes, kind) {
  return (barcodes || []).some(barcode =>
    kind === FORMAT_KIND.qr
      ? isQrBarcode(barcode)
      : kind === FORMAT_KIND.datamatrix
        ? isDataMatrixBarcode(barcode)
        : kind === FORMAT_KIND.linear
          ? isLinearBarcode(barcode) && !isDataMatrixBarcode(barcode) && !isQrBarcode(barcode)
          : false
  );
}

/** Skips the expensive full-page scan when targeted scans already found everything. */
export function shouldSkipFullPageSafetyScan(found, labelFamily = 'eparcel') {
  const unique = dedupeBarcodes(found);
  if (labelFamily === 'startrack') {
    return unique.length >= 3 && hasBarcodeKind(unique, FORMAT_KIND.qr);
  }
  return unique.length >= 2;
}

/** Plans the ordered list of crop scan targets for the carrier label family. */
export function buildCategorizedScanTargets(canvas, labelFamily = 'eparcel') {
  const w = canvas.width;
  const h = canvas.height;
  if (labelFamily === 'startrack') {
    const st = STARTRACK_LINEAR_TARGETS;
    return [
      makeTarget(canvas, FORMAT_KIND.qr, 'StarTrack QR full label scan', 0, 0, w, h, ['QRCode']),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack ATL barcode expected crop',
        w * st.atl.x,
        h * st.atl.y,
        w * st.atl.w,
        h * st.atl.h,
        ['Code128']
      ),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack routing barcode expected crop',
        w * st.routing.x,
        h * st.routing.y,
        w * st.routing.w,
        h * st.routing.h,
        ['Code128']
      ),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack freight item barcode expected crop',
        w * st.freight.x,
        h * st.freight.y,
        w * st.freight.w,
        h * st.freight.h,
        ['Code128']
      ),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack linear barcode sweep crop',
        w * st.sweep.x,
        h * st.sweep.y,
        w * st.sweep.w,
        h * st.sweep.h,
        ['Code128']
      ),
      makeTarget(canvas, FORMAT_KIND.mixed, 'Full page safety scan', 0, 0, w, h, ['Code128', 'QRCode'])
    ];
  }
  return [
    makeTarget(
      canvas,
      FORMAT_KIND.linear,
      'eParcel primary linear barcode crop',
      w * 0.04,
      h * 0.23,
      w * 0.62,
      h * 0.22,
      ['Code128']
    ),
    makeTarget(canvas, FORMAT_KIND.mixed, 'Full page safety scan', 0, 0, w, h, ['Code128', 'DataMatrix'])
  ];
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

/** Maps a crop-local barcode box back to page coordinates when the crop was not transformed. */
export function mapBarcodeToPage(barcode, target, variantLabel = '') {
  const base = { ...barcode };
  const targetBox = {
    x: Math.round(target.x || 0),
    y: Math.round(target.y || 0),
    width: Math.round(target.w || target.canvas?.width || 0),
    height: Math.round(target.h || target.canvas?.height || 0)
  };
  base.targetBox = targetBox;

  // Transformed crops are useful for decoding, but their coordinates are not reliable
  // evidence of final label placement. Only untransformed reads can prove location.
  const isUntransformed = !variantLabel || variantLabel === 'original';
  if (base.boundingBox && isUntransformed) {
    base.pageBoundingBox = clampBox(
      {
        x: targetBox.x + base.boundingBox.x,
        y: targetBox.y + base.boundingBox.y,
        width: base.boundingBox.width,
        height: base.boundingBox.height
      },
      targetBox.x + Math.max(targetBox.width, 1),
      targetBox.y + Math.max(targetBox.height, 1)
    );
    base.locationQuality = 'decoded-symbol-bounding-box';
  } else if (target.label === 'Full page safety scan' && base.boundingBox) {
    base.pageBoundingBox = clampBox(base.boundingBox, target.canvas.width, target.canvas.height);
    base.locationQuality = 'decoded-symbol-bounding-box';
  } else {
    base.locationQuality = 'decoded-no-page-box';
  }
  return base;
}

/**
 * Attaches the measured bar count to Code 128 hits while the canvas the
 * symbol was decoded from is still in hand. The count is encodation evidence
 * (e.g. the compressed StarTrack freight barcode always has 61 bars).
 */
function attachLinearBarCount(hit, canvas) {
  if (hit?.barCount == null && hit?.boundingBox && /128/i.test(String(hit.format || ''))) {
    const barCount = countLinearBars(canvas, hit.boundingBox);
    if (barCount != null) return { ...hit, barCount };
  }
  return hit;
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
    found.push(
      ...browserHits.map(hit => mapBarcodeToPage(attachLinearBarCount(hit, target.canvas), target, 'original'))
    );
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
      ...wasmHits.map(hit => mapBarcodeToPage(attachLinearBarCount(hit, variant.canvas), target, variant.label))
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
        ...jsHits.map(hit => mapBarcodeToPage(attachLinearBarCount(hit, variant.canvas), target, variant.label))
      );
      if (shouldStopTargetScan(target, found)) return found;
    }
  }

  // Rotated linear scans are expensive and only pay off when all normal variants miss.
  if (target.kind === FORMAT_KIND.linear && !found.length) {
    for (const variant of variants.slice(0, 2)) {
      for (const degrees of [90, 270]) {
        const rotated = rotateCanvas(variant.canvas, degrees);
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
            mapBarcodeToPage(attachLinearBarCount(hit, rotated), target, `${variant.label} rotated ${degrees}`)
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

  for (const target of targets) {
    if (target.kind === FORMAT_KIND.mixed && shouldSkipFullPageSafetyScan(found, labelFamily)) {
      const decodedCount = dedupeBarcodes(found).length;
      scanDiagnostics.push(scanDiagnostic(target, [], pageNumber, 0, { skipped: true }));
      onDebug?.(`Skipped ${target.label}; targeted scans already found ${decodedCount} barcode candidate(s)`, 0);
      continue;
    }

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
    return { canvas, rotation: 0 };
  }
  for (const candidate of pickRotationCandidates(symbols)) {
    const verify = await quickSymbolProbe(rotateCanvas(probe, candidate));
    if (verify.length && isUprightOrientation(verify)) {
      mark?.(
        `Orientation check (${contextLabel}): rotated input detected; auto-corrected by ${candidate} degrees`,
        performance.now() - probeStart
      );
      return { canvas: rotateCanvas(canvas, candidate), rotation: candidate };
    }
  }
  mark?.(
    `Orientation check (${contextLabel}): rotation suspected but could not be verified; continuing with the original orientation`,
    performance.now() - probeStart
  );
  return { canvas, rotation: 0 };
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

/** Groups pdf.js text items into reading-order lines. */
export function textContentItemsToLines(items) {
  const entries = [];
  for (const item of items || []) {
    const str = String(item.str || '').trim();
    if (!str) continue;
    const tx = item.transform || [1, 0, 0, 1, 0, 0];
    entries.push({ text: str, x: tx[4] || 0, y: tx[5] || 0, height: Math.abs(tx[3] || item.height || 8) });
  }
  entries.sort((a, b) => b.y - a.y || a.x - b.x);

  const groups = [];
  const yTolerance = 3.5;
  const yBuckets = new Map();
  for (const entry of entries) {
    const bucketKey = Math.round(entry.y / yTolerance);
    let group = null;
    for (const key of [bucketKey - 1, bucketKey, bucketKey + 1]) {
      const bucketGroups = yBuckets.get(key) || [];
      group = bucketGroups.find(candidate => Math.abs(candidate.y - entry.y) <= yTolerance);
      if (group) break;
    }
    if (!group) {
      group = { y: entry.y, items: [] };
      groups.push(group);
      const bucketGroups = yBuckets.get(bucketKey) || [];
      bucketGroups.push(group);
      yBuckets.set(bucketKey, bucketGroups);
    }
    group.items.push(entry);
  }

  groups.sort((a, b) => b.y - a.y);
  return groups
    .map(group => {
      group.items.sort((a, b) => a.x - b.x);
      const parts = [];
      let lastRight = null;
      for (const item of group.items) {
        if (lastRight !== null && item.x - lastRight > 18) parts.push('   ');
        parts.push(item.text);
        lastRight = item.x + item.text.length * 5;
      }
      return parts
        .join(' ')
        .replace(/\s{4,}/g, '   ')
        .trim();
    })
    .filter(Boolean);
}

/** True when the PDF text layer is too sparse to audit and OCR should run. */
export function pdfTextLayerNeedsOcr(lines) {
  const usefulChars = lines.join(' ').replace(/[^A-Za-z0-9]/g, '').length;
  return usefulChars < PDF_TEXT_LAYER_MIN_USEFUL_CHARS;
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

    const oriented = await normalizeCanvasOrientation(baseCanvas, mark, `image ${file.name}`);
    await yieldToBrowser();
    const segments = segmentLabelCanvases(oriented.canvas, mark, `image ${file.name}`);

    const labels = [];
    for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
      const canvas = segments[segIndex].canvas;
      const segLabel = segments.length > 1 ? `label ${segIndex + 1} of ${segments.length}` : null;
      const segContext = `image ${file.name}${segLabel ? ` ${segLabel}` : ''}`;
      const ocrText = await recognizeCanvasText(canvas, mark, segContext);
      await yieldToBrowser();
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

      labels.push({
        fileInfo: {
          filename: file.name,
          fileType: file.type || 'image',
          pageCount: 1,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          widthMm: null,
          heightMm: null,
          pageLabel: segLabel || undefined,
          preprocess: {
            rotationApplied: oriented.rotation,
            segmentIndex: segIndex + 1,
            segmentCount: segments.length
          },
          note: 'Raster images do not reliably expose physical DPI. A6 dimensions are assumed for layout heuristics.',
          textSources: ocrText ? ['ocr'] : []
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

    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.floor(viewport.width);
    renderCanvas.height = Math.floor(viewport.height);
    const ctx = renderCanvas.getContext('2d', { willReadFrequently: true });
    const renderStart = performance.now();
    await page.render({ canvasContext: ctx, viewport }).promise;
    mark(`Rendered page ${pageNumber} to canvas (${renderCanvas.width}x${renderCanvas.height}px)`, renderStart);
    await yieldToBrowser();

    const oriented = await normalizeCanvasOrientation(renderCanvas, mark, `page ${pageNumber}`);
    const rotatedQuarter = oriented.rotation === 90 || oriented.rotation === 270;
    const orientedMm = rotatedQuarter ? { widthMm: pageMm.heightMm, heightMm: pageMm.widthMm } : pageMm;
    // Only hunt for multiple labels when the sheet is bigger than any single
    // label format (A4 portrait/landscape and larger).
    const attemptSegmentation = Math.min(orientedMm.widthMm, orientedMm.heightMm) > 170;
    const segments = attemptSegmentation
      ? segmentLabelCanvases(oriented.canvas, mark, `page ${pageNumber}`)
      : [{ canvas: oriented.canvas, region: null }];
    await yieldToBrowser();

    for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
      const canvas = segments[segIndex].canvas;
      const region = segments[segIndex].region;
      const isSegmented = segments.length > 1;
      const segLabel = isSegmented ? `label ${segIndex + 1} of ${segments.length}` : null;
      const segContext = `PDF page ${pageNumber}${segLabel ? ` ${segLabel}` : ''}`;
      // The PDF text layer covers the whole page, so it cannot be trusted once
      // the page was rotated (line order scrambles) or split into multiple
      // labels (facts from one label would contaminate another) - OCR instead.
      const useTextLayer = !isSegmented && oriented.rotation === 0;
      const segLines = useTextLayer ? pageLines : [];
      const shouldOcrPage = useTextLayer ? pdfTextLayerNeedsOcr(segLines) : true;
      const ocrText = shouldOcrPage ? await recognizeCanvasText(canvas, mark, segContext) : '';
      if (!shouldOcrPage) {
        mark(
          `Skipped OCR on page ${pageNumber}; selectable PDF text layer provided sufficient audit text`,
          performance.now()
        );
      }
      const extractedText = mergeExtractedText(segLines.join('\n'), ocrText);
      await yieldToBrowser();
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

      const basePageLabel = pdf.numPages > 1 ? `page ${pageNumber} of ${pdf.numPages}` : 'page 1';
      labels.push({
        fileInfo: {
          filename: file.name,
          fileType: file.type || 'application/pdf',
          pageCount: 1,
          sourcePdfPage: pageNumber,
          sourcePdfPageCount: pdf.numPages,
          pageLabel: segLabel ? `${basePageLabel}, ${segLabel}` : basePageLabel,
          widthMm: isSegmented && region ? orientedMm.widthMm * (region.w / oriented.canvas.width) : orientedMm.widthMm,
          heightMm:
            isSegmented && region ? orientedMm.heightMm * (region.h / oriented.canvas.height) : orientedMm.heightMm,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          preprocess: {
            rotationApplied: oriented.rotation,
            segmentIndex: segIndex + 1,
            segmentCount: segments.length
          },
          note: isSegmented
            ? 'Label region cropped from a multi-label sheet and audited as an individual label.'
            : 'PDF page rendered locally in the browser and audited as an individual label.',
          textSources: [...(segLines.length ? ['pdf-text-layer'] : []), ...(ocrText ? ['ocr'] : [])]
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
