// Document preparation and input-quality assessment.
//
// Everything in this module conditions or measures the INPUT document before any
// audit action runs: contrast normalization, small-angle deskew (alignment),
// illumination flattening for camera photos, and the quality metrics behind the
// report's input-quality gauge. No audit logic lives here, and nothing here ever
// alters a decoded value - preparation is content-preserving (monotonic tone
// mapping and geometry only). Pure numeric helpers are exported separately from
// the canvas wrappers so Node tests can exercise them without a browser canvas.
import { canvasLuminanceSample } from './canvasUtils.js';

// ---------------------------------------------------------------------------
// Contrast normalization (moved here from canvasUtils: it is input preparation)
// ---------------------------------------------------------------------------

/**
 * Gentle, colour-preserving contrast stretch over the 2nd-98th percentile of
 * luminance (pixel brightness), applied in place. Only stretches when the dynamic
 * range is compressed, so a clean
 * full-range scan (or a crisp PDF render) is left untouched. Content is preserved -
 * the remap is monotonic, so bar/space and glyph relationships are never inverted.
 */
function normalizeCanvasContrast(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const total = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    hist[(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0] += 1;
  }
  let lo = 0;
  let hi = 255;
  let cum = 0;
  for (let v = 0; v < 256; v += 1) {
    cum += hist[v];
    if (cum >= total * 0.02) {
      lo = v;
      break;
    }
  }
  cum = 0;
  for (let v = 255; v >= 0; v -= 1) {
    cum += hist[v];
    if (cum >= total * 0.02) {
      hi = v;
      break;
    }
  }
  if (hi <= lo || hi - lo >= 205) return false; // already full-range: leave the input untouched
  const gain = 255 / (hi - lo);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, (data[i] - lo) * gain));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - lo) * gain));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - lo) * gain));
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

/**
 * Upfront, content-preserving quality pass run on every rendered page/image before any
 * decode or OCR, so downstream operations work from the most readable copy possible.
 * Deliberately does NOT resize (resolution is handled per operation downstream).
 * Returns `{ canvas, factor, contrastApplied }`; `factor` is always 1 (no resize).
 */
export function enhanceInputForQuality(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0); // same-size copy: an exact, non-interpolated duplicate
  const contrastApplied = normalizeCanvasContrast(ctx, out.width, out.height);
  return { canvas: out, factor: 1, contrastApplied };
}

// ---------------------------------------------------------------------------
// Small-angle deskew (alignment)
// ---------------------------------------------------------------------------

// Residual tilt below this is noise; above the max it is a rotation problem the
// quarter-turn orientation pass should have caught, not a scanner skew.
export const DESKEW_MIN_DEGREES = 0.6;
export const DESKEW_MAX_DEGREES = 12;

/**
 * Median residual skew (degrees, in [-45, 45]) reported by decoded symbols.
 * Quarter turns are handled by the orientation pass; this only measures the
 * few-degree tilt a scanner or camera introduces. Returns 0 when no symbol
 * carries a usable orientation or the tilt is below the noise floor.
 */
export function residualSkewDegrees(symbols = []) {
  const residuals = [];
  for (const s of symbols) {
    if (!Number.isFinite(s?.orientation)) continue;
    let r = ((s.orientation % 90) + 90) % 90; // 0..90
    if (r > 45) r -= 90; // -45..45
    residuals.push(r);
  }
  if (!residuals.length) return 0;
  residuals.sort((a, b) => a - b);
  const median = residuals[Math.floor(residuals.length / 2)];
  return Math.abs(median) >= DESKEW_MIN_DEGREES && Math.abs(median) <= DESKEW_MAX_DEGREES ? median : 0;
}

/** Variance of the per-row ink fraction (share of dark pixels), sampled along lines tilted by `degrees`. Pure. */
function tiltedProfileScore(lum, width, height, degrees) {
  const slope = Math.tan((degrees * Math.PI) / 180);
  const cx = width / 2;
  const rows = new Float64Array(height);
  const counts = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 2) {
      const sy = Math.round(y + (x - cx) * slope);
      if (sy < 0 || sy >= height) continue;
      if (lum[sy * width + x] < 128) rows[y] += 1;
      counts[y] += 1;
    }
  }
  let mean = 0;
  let used = 0;
  for (let y = 0; y < height; y += 1) {
    if (!counts[y]) continue;
    rows[y] /= counts[y];
    mean += rows[y];
    used += 1;
  }
  if (!used) return 0;
  mean /= used;
  let variance = 0;
  for (let y = 0; y < height; y += 1) {
    if (!counts[y]) continue;
    const d = rows[y] - mean;
    variance += d * d;
  }
  return variance / used;
}

/**
 * Estimates page skew by maximizing the variance of the row-ink profile over
 * candidate tilt angles (text rows produce a spiky profile only when sampled
 * along their true baseline). Returns the CORRECTION angle to pass to
 * `rotateCanvasFine` (0 when the page already scores best untilted or the
 * signal is too weak to trust). Pure; operates on a downscaled luminance array.
 */
export function estimateSkewByProjection(lum, width, height, { maxDegrees = 5, stepDegrees = 0.5 } = {}) {
  const baseline = tiltedProfileScore(lum, width, height, 0);
  let bestAngle = 0;
  let bestScore = baseline;
  for (let a = stepDegrees; a <= maxDegrees; a += stepDegrees) {
    for (const angle of [a, -a]) {
      const score = tiltedProfileScore(lum, width, height, angle);
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }
  }
  // Require a clear win over the untilted profile; a marginal difference is noise.
  if (bestAngle === 0 || bestScore < baseline * 1.25) return 0;
  // Content tilted so that sampling along +a aligns with the text needs a -a
  // canvas rotation to straighten (rotateCanvasFine rotates content clockwise).
  return -bestAngle;
}

/**
 * Returns a same-size copy rotated by an arbitrary small angle (degrees,
 * clockwise) about the centre, on a white background. Only meant for the few
 * degrees of scanner/camera skew - corners clipped by the rotation fall on
 * blank margin at those angles.
 */
export function rotateCanvasFine(sourceCanvas, degrees) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return out;
}

// ---------------------------------------------------------------------------
// Illumination flattening (camera photos)
// ---------------------------------------------------------------------------

// Tiles per axis in the background-brightness grid (a 6x6 map of the page).
const FLATTEN_TILES = 6;
// Background brightness must vary by more than this ratio across the page
// before flattening is worth applying; flat scans skip it entirely.
const FLATTEN_MIN_UNEVENNESS = 1.22;

/** Per-tile background (bright paper) level estimate over a grayscale plane. Pure. */
export function tileBackgroundLevels(gray, width, height, tiles = FLATTEN_TILES) {
  const levels = [];
  const tw = Math.max(1, Math.floor(width / tiles));
  const th = Math.max(1, Math.floor(height / tiles));
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const x0 = tx * tw;
      const y0 = ty * th;
      const x1 = tx === tiles - 1 ? width : x0 + tw;
      const y1 = ty === tiles - 1 ? height : y0 + th;
      const hist = new Uint32Array(256);
      let count = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          hist[Math.max(0, Math.min(255, gray[y * width + x] | 0))] += 1;
          count += 1;
        }
      }
      // 85th percentile approximates local paper brightness while ignoring ink.
      let cum = 0;
      let level = 255;
      for (let v = 0; v < 256; v += 1) {
        cum += hist[v];
        if (cum >= count * 0.85) {
          level = v;
          break;
        }
      }
      levels.push({ tx, ty, level: Math.max(1, level) });
    }
  }
  return levels;
}

/**
 * Divides a grayscale plane by a bilinearly-interpolated background map so an
 * unevenly-lit photo reads like a flat scan. Applied in place; returns true only
 * when the illumination was actually uneven enough to warrant it. The remap is
 * monotonic per pixel neighbourhood, so glyph/bar relationships survive.
 */
export function flattenGrayPlane(gray, width, height, tiles = FLATTEN_TILES) {
  const levels = tileBackgroundLevels(gray, width, height, tiles);
  let min = 255;
  let max = 1;
  for (const t of levels) {
    if (t.level < min) min = t.level;
    if (t.level > max) max = t.level;
  }
  if (min <= 0 || max / min < FLATTEN_MIN_UNEVENNESS) return false;
  const grid = new Float32Array(tiles * tiles);
  for (const t of levels) grid[t.ty * tiles + t.tx] = t.level;
  const cellW = width / tiles;
  const cellH = height / tiles;
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(tiles - 1.001, Math.max(0, y / cellH - 0.5));
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(tiles - 1.001, Math.max(0, x / cellW - 0.5));
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const y1 = Math.min(tiles - 1, y0 + 1);
      const x1 = Math.min(tiles - 1, x0 + 1);
      const bg =
        grid[y0 * tiles + x0] * (1 - fx) * (1 - fy) +
        grid[y0 * tiles + x1] * fx * (1 - fy) +
        grid[y1 * tiles + x0] * (1 - fx) * fy +
        grid[y1 * tiles + x1] * fx * fy;
      const i = y * width + x;
      gray[i] = Math.max(0, Math.min(255, (gray[i] / Math.max(1, bg)) * 235));
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Input-quality assessment (drives the report gauge)
// ---------------------------------------------------------------------------

/**
 * Edge statistics over a luminance window: the 95th-percentile absolute response
 * of a Laplacian (a second-derivative edge filter) relative to the window's tonal
 * spread. Crisp print jumps the full tonal range within a pixel (ratio near 1);
 * blur spreads the step over several pixels (ratio well below). Pure; exported for tests.
 */
export function laplacianEdgeStats(lum, width, height) {
  const responses = [];
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = y * width + x;
      const lap = Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - width] - lum[i + width]);
      if (lap > 8) responses.push(lap);
    }
  }
  if (responses.length < 50) return { edgeCount: responses.length, p95: 0 };
  responses.sort((a, b) => a - b);
  return { edgeCount: responses.length, p95: responses[Math.floor(responses.length * 0.95)] };
}

/** 2nd..98th percentile luminance spread. Pure. */
export function luminanceSpread(lum) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i += 1) hist[lum[i] | 0] += 1;
  let cum = 0;
  let lo = 0;
  for (let v = 0; v < 256; v += 1) {
    cum += hist[v];
    if (cum >= lum.length * 0.02) {
      lo = v;
      break;
    }
  }
  cum = 0;
  let hi = 255;
  for (let v = 255; v >= 0; v -= 1) {
    cum += hist[v];
    if (cum >= lum.length * 0.02) {
      hi = v;
      break;
    }
  }
  return Math.max(0, hi - lo);
}

/**
 * Estimated Code 128 module (narrowest bar) width in pixels from the measured
 * bar count and symbol box width. Bar count = 3 bars per symbol character plus
 * 4 stop bars, so characters = (bars - 4) / 3 and total modules = 11 x chars + 13.
 * Returns null when the inputs are implausible. Pure.
 */
export function code128ModuleWidthPx(barCount, boxWidthPx) {
  if (!Number.isFinite(barCount) || !Number.isFinite(boxWidthPx)) return null;
  if (barCount < 16 || barCount > 220 || boxWidthPx < 20) return null;
  const chars = (barCount - 4) / 3;
  const modules = 11 * chars + 13;
  const px = boxWidthPx / modules;
  return px > 0.2 && px < 60 ? px : null;
}

const RATING = { good: 'good', fair: 'fair', poor: 'poor' };

function rate(value, goodAt, fairAt) {
  if (value == null) return null;
  if (value >= goodAt) return RATING.good;
  if (value >= fairAt) return RATING.fair;
  return RATING.poor;
}

/**
 * Pure quality assessment over pre-measured inputs; `assessLabelQuality` is the
 * canvas-reading wrapper. Sharpness is measured at native pixel scale in a few
 * windows and the best window wins (blur is global, blank windows are ignored).
 */
export function summarizeInputQuality({ sharpnessRatio, spread, dpi, pxPerModule, deskewDegrees, contrastApplied }) {
  const sharpness =
    sharpnessRatio == null
      ? null
      : { value: Math.round(sharpnessRatio * 100) / 100, rating: rate(sharpnessRatio, 0.55, 0.32) };
  const contrast = spread == null ? null : { value: spread, rating: rate(spread, 150, 90) };
  const resolution =
    dpi != null
      ? { kind: 'dpi', value: Math.round(dpi), rating: rate(dpi, 250, 150) }
      : pxPerModule != null
        ? { kind: 'pxPerModule', value: Math.round(pxPerModule * 10) / 10, rating: rate(pxPerModule, 2.5, 1.8) }
        : null;
  const ratings = [sharpness?.rating, contrast?.rating, resolution?.rating].filter(Boolean);
  const overall = ratings.includes(RATING.poor)
    ? RATING.poor
    : ratings.includes(RATING.fair)
      ? RATING.fair
      : RATING.good;
  return {
    sharpness,
    contrast,
    resolution,
    deskewDegrees: deskewDegrees || 0,
    contrastApplied: Boolean(contrastApplied),
    overall: ratings.length ? overall : null
  };
}

const SHARPNESS_WINDOW = 512;

/** Reads sharpness sample windows from a canvas at native resolution. */
function sharpnessRatioFromCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 64 || canvas.height < 64) return null;
  const w = Math.min(SHARPNESS_WINDOW, canvas.width);
  const h = Math.min(SHARPNESS_WINDOW, canvas.height);
  const spots = [
    { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2 },
    { x: canvas.width * 0.12, y: canvas.height * 0.12 },
    { x: Math.max(0, canvas.width * 0.68 - w / 2), y: Math.max(0, canvas.height * 0.68 - h / 2) }
  ];
  let best = null;
  for (const spot of spots) {
    const x = Math.max(0, Math.min(canvas.width - w, Math.round(spot.x)));
    const y = Math.max(0, Math.min(canvas.height - h, Math.round(spot.y)));
    const data = ctx.getImageData(x, y, w, h).data;
    const lum = new Uint8Array(w * h);
    for (let i = 0; i < lum.length; i += 1) {
      const o = i * 4;
      lum[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) | 0;
    }
    const spread = luminanceSpread(lum);
    if (spread < 40) continue; // blank window: nothing to measure
    const { edgeCount, p95 } = laplacianEdgeStats(lum, w, h);
    if (!edgeCount || !p95) continue;
    const ratio = p95 / (2 * spread);
    if (best == null || ratio > best) best = ratio;
  }
  return best;
}

/**
 * Measures the audited label canvas and returns the input-quality summary shown
 * by the report gauge. `widthMm` (when the source document declares physical
 * size) yields a true DPI; otherwise the decoded Code 128 bar count acts as an
 * on-label ruler and quality is expressed as pixels per barcode module.
 */
export function assessLabelQuality(
  canvas,
  { widthMm = null, barcodes = [], deskewDegrees = 0, contrastApplied = false } = {}
) {
  const sharpnessRatio = sharpnessRatioFromCanvas(canvas);
  const { lum } = canvasLuminanceSample(canvas, 720);
  const spread = luminanceSpread(lum);
  const dpi = widthMm && canvas.width ? (canvas.width / widthMm) * 25.4 : null;
  let pxPerModule = null;
  for (const b of barcodes) {
    const box = b?.pageBoundingBox;
    const estimate = box ? code128ModuleWidthPx(b.barCount, box.width) : null;
    if (estimate != null && (pxPerModule == null || estimate > pxPerModule)) pxPerModule = estimate;
  }
  return summarizeInputQuality({ sharpnessRatio, spread, dpi, pxPerModule, deskewDegrees, contrastApplied });
}
