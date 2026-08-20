// Pure canvas/geometry helpers shared by the scan pipeline and preview crops.

export const BARCODE_BOX_MARGIN_PX = 36;

export const PREVIEW_BARCODE_BOX_MARGIN_PX = 8;

/** Converts ZXing result points into the rectangular evidence box used by crops and overlays. */
export function pointsToBox(points) {
  const xs = points.map(p => p.getX());
  const ys = points.map(p => p.getY());
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY)
  };
}

/** Clamps an evidence/crop box so image extraction never reads outside the source canvas. */
export function clampBox(box, width, height) {
  if (!box) return null;
  const x = Math.max(0, Math.min(width - 1, Math.round(box.x || 0)));
  const y = Math.max(0, Math.min(height - 1, Math.round(box.y || 0)));
  const right = Math.max(x + 1, Math.min(width, Math.round((box.x || 0) + (box.width || 0))));
  const bottom = Math.max(y + 1, Math.min(height, Math.round((box.y || 0) + (box.height || 0))));
  return { x, y, width: right - x, height: bottom - y };
}

/** Adds a consistent visual margin around barcode boxes so report crops are readable and comparable. */
export function expandBox(box, canvasWidth, canvasHeight, marginPx = BARCODE_BOX_MARGIN_PX) {
  if (!box) return null;
  const pad = Math.max(0, Math.round(marginPx));
  return clampBox(
    {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2
    },
    canvasWidth,
    canvasHeight
  );
}

/** Returns a new canvas rotated by 0/90/180/270 degrees clockwise. */
export function rotateCanvas(sourceCanvas, degrees) {
  if (degrees === 0) return sourceCanvas;
  const out = document.createElement('canvas');
  const radians = (degrees * Math.PI) / 180;
  const swap = degrees === 90 || degrees === 270;
  out.width = swap ? sourceCanvas.height : sourceCanvas.width;
  out.height = swap ? sourceCanvas.width : sourceCanvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return out;
}

/** Returns a new canvas holding the given source rectangle. */
export function cropCanvas(sourceCanvas, x, y, width, height) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.floor(width));
  out.height = Math.max(1, Math.floor(height));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, out.width, out.height);
  return out;
}

/** Returns a nearest-neighbour upscaled copy (keeps barcode edges crisp). */
export function scaleCanvas(sourceCanvas, factor = 2) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * factor));
  out.height = Math.max(1, Math.round(sourceCanvas.height * factor));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

/** Returns a black/white binarized copy using a fixed luminance threshold. */
export function thresholdCanvas(sourceCanvas, threshold = BINARY_THRESHOLD_DEFAULT) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const grey = img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
    const v = grey < threshold ? 0 : 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Returns a smoothly-upscaled, unsharp-masked grayscale copy. Used as an extra decode
 * variant to recover crisp bar edges on blurry or low-resolution barcode crops. This
 * copy is only ever fed to the decoder; the original canvas still backs every evidence
 * crop, so the report image stays true to the source document.
 */
export function sharpenCanvas(sourceCanvas, factor = 2, amount = 1.0) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * factor));
  out.height = Math.max(1, Math.round(sourceCanvas.height * factor));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  const w = out.width;
  const h = out.height;
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    gray[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
  }
  // Separable 3x3 box blur, then amplify (original - blur) to crisp the edges.
  const tmp = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const l = x > 0 ? gray[i - 1] : gray[i];
      const r = x < w - 1 ? gray[i + 1] : gray[i];
      tmp[i] = (l + gray[i] + r) / 3;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const u = y > 0 ? tmp[i - w] : tmp[i];
      const d = y < h - 1 ? tmp[i + w] : tmp[i];
      const blur = (u + tmp[i] + d) / 3;
      const v = Math.max(0, Math.min(255, gray[i] + amount * (gray[i] - blur)));
      const o = i * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/**
 * Gentle, colour-preserving contrast stretch (2nd-98th luminance percentile),
 * applied in place. Only stretches when the dynamic range is compressed, so a clean
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
 * decode or OCR, so downstream operations work from the most readable copy possible
 * instead of being limited by the raw file's presentation.
 *
 * It deliberately does NOT resize: smoothly upscaling the shared canvas blurs barcode
 * bars and can drop an otherwise-decodable symbol, while nearest-neighbour upscaling
 * hurts OCR. Resolution is therefore handled per operation - crisp nearest-neighbour
 * variants when decoding, smooth upscale + sharpen when running OCR. The one globally
 * safe lift is a gentle, monotonic contrast stretch that rescues faded/low-contrast
 * scans for both decode and OCR without altering geometry or values.
 *
 * Returns `{ canvas, factor }`; `factor` is always 1 (no resize) and is kept so callers
 * can report the true source resolution unconditionally.
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

/** Returns a copy with a white quiet-zone border added on all sides. */
export function addWhiteBorder(sourceCanvas, borderRatio = 0.1) {
  const border = Math.max(12, Math.round(Math.min(sourceCanvas.width, sourceCanvas.height) * borderRatio));
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width + border * 2;
  out.height = sourceCanvas.height + border * 2;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(sourceCanvas, border, border);
  return out;
}

// Tuning knobs for content trimming and binarization, shared by scan variants.
export const TRIM_DARK_PADDING_PX = 14;
export const TRIM_DARK_INK_THRESHOLD = 205;
export const BINARY_THRESHOLD_DEFAULT = 150;

/** Crops the canvas to its dark-content bounding box plus padding. */
export function trimDarkBounds(sourceCanvas, padding = TRIM_DARK_PADDING_PX, threshold = TRIM_DARK_INK_THRESHOLD) {
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = sourceCanvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 600));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const grey = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (grey < threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) return sourceCanvas;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width, maxX + padding);
  maxY = Math.min(height, maxY + padding);
  return cropCanvas(sourceCanvas, minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
}

/** Returns the image centred on a white square canvas (helps 2D decoders). */
export function squareCanvas(sourceCanvas, paddingRatio = 0.08) {
  const size = Math.max(sourceCanvas.width, sourceCanvas.height);
  const pad = Math.round(size * paddingRatio);
  const out = document.createElement('canvas');
  out.width = size + pad * 2;
  out.height = size + pad * 2;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(sourceCanvas, pad + (size - sourceCanvas.width) / 2, pad + (size - sourceCanvas.height) / 2);
  return out;
}

/** Returns a smoothly downscaled copy capped at maxDim on the long edge. */
export function downscaleCanvasSmooth(sourceCanvas, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(sourceCanvas.width, sourceCanvas.height));
  if (scale >= 1) return sourceCanvas;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

export const SEGMENT_LUMINANCE_MAX_DIM = 360;

/** Returns a downscaled row-major Uint8 luminance array for segmentation. */
export function canvasLuminanceSample(canvas, maxDim = SEGMENT_LUMINANCE_MAX_DIM) {
  const sample = downscaleCanvasSmooth(canvas, maxDim);
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, sample.width, sample.height);
  const lum = new Uint8Array(sample.width * sample.height);
  for (let i = 0; i < lum.length; i += 1) {
    const o = i * 4;
    lum[i] = Math.round(data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114);
  }
  return { lum, width: sample.width, height: sample.height };
}

// A Code 128 symbol's bar count is fixed by its encodation (3 bars per symbol
// character + 4 stop bars), so counting the bars of a decoded crop verifies
// the spec-mandated subset compression without access to the codeword stream.
const BAR_COUNT_SCANLINE_FRACTIONS = [0.35, 0.5, 0.65];
const BAR_COUNT_MIN_CONTRAST = 60;
const BAR_COUNT_MAX_SPREAD = 2;

/** Counts dark runs along a luminance scanline using the given threshold. Pure; exported for tests. */
export function countBarRuns(luminances, threshold) {
  let bars = 0;
  let inBar = false;
  for (const value of luminances) {
    const dark = value < threshold;
    if (dark && !inBar) bars += 1;
    inBar = dark;
  }
  return bars;
}

/**
 * Counts the bars of a linear barcode inside `box` on `canvas` by sampling
 * three scanlines and taking the median. Returns null when the measurement is
 * unreliable (low contrast or scanline disagreement) so callers skip the
 * check instead of reporting a wrong count.
 */
export function countLinearBars(canvas, box) {
  if (!canvas || !box || !(box.width >= 20) || !(box.height >= 4)) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const x = Math.max(0, Math.floor(box.x));
  const width = Math.min(canvas.width - x, Math.ceil(box.width));
  if (width < 20) return null;
  const counts = [];
  for (const fraction of BAR_COUNT_SCANLINE_FRACTIONS) {
    const y = Math.min(canvas.height - 1, Math.max(0, Math.round(box.y + box.height * fraction)));
    const row = ctx.getImageData(x, y, width, 1).data;
    const luminances = new Array(width);
    let min = 255;
    let max = 0;
    for (let i = 0; i < width; i += 1) {
      const p = i * 4;
      const value = row[p] * 0.299 + row[p + 1] * 0.587 + row[p + 2] * 0.114;
      luminances[i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (max - min < BAR_COUNT_MIN_CONTRAST) continue;
    counts.push(countBarRuns(luminances, (min + max) / 2));
  }
  if (counts.length < 2) return null;
  counts.sort((a, b) => a - b);
  if (counts[counts.length - 1] - counts[0] > BAR_COUNT_MAX_SPREAD) return null;
  return counts[Math.floor(counts.length / 2)];
}

/** Encodes the canvas as a bounded-width JPEG/PNG data URL for report embedding. */
export const CROP_MAX_DISPLAY_UPSCALE = 4;

export function canvasToDataUrl(sourceCanvas, maxWidth = 700, mime = 'image/jpeg', quality = 0.86) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return '';
  // Scale evidence crops up to fill the display width so low-resolution barcodes/text stay
  // legible. Upscaling uses nearest-neighbour: an honest, content-preserving magnification
  // that invents no detail (capped to avoid extreme blockiness). Downscaling stays smooth
  // to avoid aliasing. The source pixels are untouched - this only affects the report image.
  const scale = Math.min(CROP_MAX_DISPLAY_UPSCALE, maxWidth / sourceCanvas.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = scale < 1;
  if (scale < 1) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  try {
    return out.toDataURL(mime, quality);
  } catch (_error) {
    return '';
  }
}
