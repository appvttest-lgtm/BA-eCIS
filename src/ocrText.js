const OCR_MIN_LONG_EDGE = 1900;
const OCR_MAX_LONG_EDGE = 3000;
const OCR_MIN_USEFUL_CHARS = 12;
// Small label scans need to be magnified more than barcode decoding would tolerate;
// this only governs the OCR copy, so a generous zoom is safe here.
const OCR_MAX_UPSCALE = 3.5;
// Unsharp-mask strength. Higher crisps edges more but can amplify scan noise.
const OCR_SHARPEN_AMOUNT = 0.8;

let ocrWorkerPromise = null;
let createOcrWorkerPromise = null;

function appAssetUrl(path) {
  return new URL(path, window.location.href).href;
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    if (!createOcrWorkerPromise) {
      createOcrWorkerPromise = import('tesseract.js').then(module => module.createWorker);
    }
    ocrWorkerPromise = createOcrWorkerPromise
      .then(createOcrWorker =>
        createOcrWorker('eng', 1, {
          workerPath: appAssetUrl('tesseract/worker.min.js'),
          corePath: appAssetUrl('tesseract-core'),
          langPath: appAssetUrl('tessdata'),
          gzip: true,
          cacheMethod: 'write'
        })
      )
      .then(async worker => {
        await worker.setParameters({ preserve_interword_spaces: '1' });
        return worker;
      })
      .catch(error => {
        ocrWorkerPromise = null;
        throw error;
      });
  }
  return ocrWorkerPromise;
}

/** Black/white box-blur (separable 3x3) over a grayscale plane; used by the unsharp mask. */
function boxBlur3(src, width, height) {
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const l = x > 0 ? src[i - 1] : src[i];
      const r = x < width - 1 ? src[i + 1] : src[i];
      tmp[i] = (l + src[i] + r) / 3;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const u = y > 0 ? tmp[i - width] : tmp[i];
      const d = y < height - 1 ? tmp[i + width] : tmp[i];
      out[i] = (u + tmp[i] + d) / 3;
    }
  }
  return out;
}

/** Finds the low/high luminance bounds at the given percentiles for a contrast stretch. */
function percentileBounds(gray, lowFrac, highFrac) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i] | 0] += 1;
  const total = gray.length;
  let lo = 0;
  let hi = 255;
  let cum = 0;
  for (let v = 0; v < 256; v += 1) {
    cum += hist[v];
    if (cum >= total * lowFrac) {
      lo = v;
      break;
    }
  }
  cum = 0;
  for (let v = 0; v < 256; v += 1) {
    cum += hist[v];
    if (cum >= total * highFrac) {
      hi = v;
      break;
    }
  }
  return hi > lo ? { lo, hi } : { lo: 0, hi: 255 };
}

/**
 * Text-only enhancement applied to the OCR copy: grayscale, a percentile contrast
 * stretch (fights flat/low-contrast scans), and an unsharp mask (crisps glyph edges).
 * Barcodes are decoded earlier from the untouched canvas, so sharpening here cannot
 * distort a barcode read - it only improves visible-text recognition.
 */
function enhanceTextForOcr(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const n = width * height;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    gray[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
  }
  const { lo, hi } = percentileBounds(gray, 0.02, 0.98);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < n; i += 1) {
    gray[i] = Math.max(0, Math.min(255, ((gray[i] - lo) / range) * 255));
  }
  const blurred = boxBlur3(gray, width, height);
  for (let i = 0; i < n; i += 1) {
    const sharp = Math.max(0, Math.min(255, gray[i] + OCR_SHARPEN_AMOUNT * (gray[i] - blurred[i])));
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = sharp;
    data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Builds the magnified, sharpened grayscale copy OCR runs on (never used for barcode decoding). */
function prepareOcrCanvas(sourceCanvas) {
  const longEdge = Math.max(sourceCanvas.width, sourceCanvas.height);
  const upscale = longEdge < OCR_MIN_LONG_EDGE ? OCR_MIN_LONG_EDGE / Math.max(1, longEdge) : 1;
  const downscale = longEdge > OCR_MAX_LONG_EDGE ? OCR_MAX_LONG_EDGE / longEdge : 1;
  const scale = Math.min(OCR_MAX_UPSCALE, upscale) * Math.min(1, downscale);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  enhanceTextForOcr(ctx, out.width, out.height);
  return out;
}

function normaliseOcrText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Merges text from multiple extraction sources, deduplicating repeated lines. */
export function mergeExtractedText(...texts) {
  const lines = [];
  const seen = new Set();
  for (const text of texts) {
    for (const line of String(text || '').split(/\r?\n/)) {
      const clean = line.replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      const key = clean.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(clean);
    }
  }
  return lines.join('\n');
}

/**
 * Runs Tesseract OCR over a rendered canvas and reports both the recognized text
 * and an explicit status so callers (and the report) can distinguish an engine
 * that failed to load from one that simply read nothing. Returns
 * `{ text, status, charCount, detail }` where status is one of:
 *   'ok'     - usable text recognized (>= OCR_MIN_USEFUL_CHARS)
 *   'low'    - text recognized but below the usefulness threshold, so discarded
 *   'empty'  - engine ran but found no readable characters
 *   'failed' - the OCR engine could not load or run (detail carries the error)
 */
export async function recognizeCanvasText(canvas, mark, label) {
  const ocrStart = performance.now();
  try {
    const worker = await getOcrWorker();
    const ocrCanvas = prepareOcrCanvas(canvas);
    const result = await worker.recognize(ocrCanvas);
    const text = normaliseOcrText(result?.data?.text || '');
    const charCount = text.length;
    if (charCount >= OCR_MIN_USEFUL_CHARS) {
      mark?.(`OCR read ${charCount} character${charCount === 1 ? '' : 's'} from ${label}`, ocrStart);
      return { text, status: 'ok', charCount, detail: '' };
    }
    if (charCount > 0) {
      mark?.(
        `OCR read only ${charCount} character${charCount === 1 ? '' : 's'} from ${label}; below the ${OCR_MIN_USEFUL_CHARS}-character usefulness threshold, so it was treated as no text`,
        ocrStart
      );
      return { text: '', status: 'low', charCount, detail: '' };
    }
    mark?.(`OCR ran on ${label} but found no readable text`, ocrStart);
    return { text: '', status: 'empty', charCount: 0, detail: '' };
  } catch (error) {
    const detail = error?.message || String(error);
    mark?.(`OCR engine failed for ${label}: ${detail}`, ocrStart);
    return { text: '', status: 'failed', charCount: 0, detail };
  }
}
