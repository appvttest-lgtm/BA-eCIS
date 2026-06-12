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

/** Encodes the canvas as a bounded-width JPEG/PNG data URL for report embedding. */
export function canvasToDataUrl(sourceCanvas, maxWidth = 700, mime = 'image/jpeg', quality = 0.86) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return '';
  const scale = Math.min(1, maxWidth / sourceCanvas.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  try {
    return out.toDataURL(mime, quality);
  } catch (_error) {
    return '';
  }
}
