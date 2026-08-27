import { flattenGrayPlane } from './scanner/inputPrep.js';

const OCR_MIN_LONG_EDGE = 1900;
const OCR_MAX_LONG_EDGE = 3000;
const OCR_MIN_USEFUL_CHARS = 12;
// Small label scans need to be magnified more than barcode decoding would tolerate;
// this only governs the OCR copy, so a generous zoom is safe here.
const OCR_MAX_UPSCALE = 3.5;
// Unsharp-mask strength for the FULL-LABEL text pass. Deliberately gentle: heavy
// sharpening fractures thin glyph strokes and hurts general text recognition.
const OCR_SHARPEN_AMOUNT = 0.5;

// Barcode-crop OCR profile: the human-readable digits printed with a barcode are
// small, high-contrast machine print, so they tolerate - and benefit from - a much
// stronger local contrast stretch, heavier sharpening and greater magnification
// than the label's general text.
const CROP_OCR_PROFILE = {
  minLongEdge: 1400,
  maxLongEdge: 2600,
  maxUpscale: 6,
  sharpenAmount: 1.4,
  lowFrac: 0.01,
  highFrac: 0.99,
  flatten: false
};
// HRI lines are uppercase alphanumerics (plus GS1 AI parentheses); constraining the
// engine to that set sharply reduces digit/letter confusions on barcode crops.
const CROP_OCR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789() ';
const CROP_OCR_MIN_USEFUL_CHARS = 6;

let ocrWorkerPromise = null;
let createOcrWorkerPromise = null;

// Resolve OCR assets against this bundle's own URL (dist/assets/ -> one level up)
// rather than the page URL, so they load from any host sub-path even when the page
// URL lacks a trailing slash. In dev this module lives at /src/, so ../ is the root
// too. The indirection through BUNDLE_URL is load-bearing: writing
// `new URL(dynamic, import.meta.url)` inline triggers Vite's build-time asset-map
// transform, which returns undefined for public/ paths and breaks the OCR worker.
const BUNDLE_URL = import.meta.url;

export function appAssetUrl(path) {
  return new URL(`../${path}`, BUNDLE_URL).href;
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
        // The OCR copy is upscaled to roughly 300 DPI equivalent; telling the
        // engine so stops it guessing (canvas input carries no DPI metadata).
        await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
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
function enhanceTextForOcr(ctx, width, height, profile = {}) {
  const sharpenAmount = profile.sharpenAmount ?? OCR_SHARPEN_AMOUNT;
  const lowFrac = profile.lowFrac ?? 0.02;
  const highFrac = profile.highFrac ?? 0.98;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const n = width * height;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    gray[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
  }
  // Camera photos light the label unevenly; flatten the background before the
  // GLOBAL stretch so one dim corner no longer decides the whole page's mapping.
  // A no-op on evenly lit scans, and skipped entirely for small barcode crops.
  if (profile.flatten !== false) flattenGrayPlane(gray, width, height);
  const { lo, hi } = percentileBounds(gray, lowFrac, highFrac);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < n; i += 1) {
    gray[i] = Math.max(0, Math.min(255, ((gray[i] - lo) / range) * 255));
  }
  const blurred = boxBlur3(gray, width, height);
  for (let i = 0; i < n; i += 1) {
    const sharp = Math.max(0, Math.min(255, gray[i] + sharpenAmount * (gray[i] - blurred[i])));
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = sharp;
    data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Builds the magnified, sharpened grayscale copy OCR runs on (never used for
 * barcode decoding). `maskBoxes` (source-canvas coordinates) are painted white
 * before enhancement: located barcode symbols are pure noise to text layout
 * analysis, and their HRI digits are recovered by the dedicated crop pass.
 */
function prepareOcrCanvas(sourceCanvas, profile = {}, maskBoxes = []) {
  const minLongEdge = profile.minLongEdge ?? OCR_MIN_LONG_EDGE;
  const maxLongEdge = profile.maxLongEdge ?? OCR_MAX_LONG_EDGE;
  const maxUpscale = profile.maxUpscale ?? OCR_MAX_UPSCALE;
  const longEdge = Math.max(sourceCanvas.width, sourceCanvas.height);
  const upscale = longEdge < minLongEdge ? minLongEdge / Math.max(1, longEdge) : 1;
  const downscale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const scale = Math.min(maxUpscale, upscale) * Math.min(1, downscale);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  if (maskBoxes?.length) {
    ctx.fillStyle = 'white';
    for (const box of maskBoxes) {
      if (!box || !(box.width > 0) || !(box.height > 0)) continue;
      const pad = 3;
      ctx.fillRect(
        (box.x - pad) * scale,
        (box.y - pad) * scale,
        (box.width + pad * 2) * scale,
        (box.height + pad * 2) * scale
      );
    }
  }
  enhanceTextForOcr(ctx, out.width, out.height, profile);
  return out;
}

// Words the engine is less confident about than this are dropped from the
// grouped output: they are overwhelmingly barcode remnants and paper noise.
const OCR_MIN_WORD_CONFIDENCE = 20;

/**
 * Splits one recognized line's words into runs wherever the horizontal gap is
 * too wide to be word spacing. Each run is one column cell. Pure; exported for tests.
 */
export function splitLineIntoRuns(words, gapThreshold) {
  const runs = [];
  let current = null;
  for (const word of words) {
    if (current && word.x0 - current.x1 > gapThreshold) {
      runs.push(current);
      current = null;
    }
    if (!current) {
      current = { text: word.text, x0: word.x0, x1: word.x1 };
    } else {
      current.text += ` ${word.text}`;
      current.x1 = Math.max(current.x1, word.x1);
    }
  }
  if (current) runs.push(current);
  return runs;
}

/**
 * Regroups one layout block's lines into columns so side-by-side content (the
 * address block next to the DG declaration, for example) comes out as separate
 * contiguous line groups instead of interleaved half-lines the fact extractors
 * cannot safely un-merge. Lines whose runs overlap a column's x-range join that
 * column; columns are emitted left-to-right, each top-to-bottom. Single-column
 * blocks pass through unchanged. Pure; exported for tests.
 */
export function groupBlockLinesIntoColumnText(lines) {
  const heights = lines
    .map(l => l.height)
    .filter(h => h > 0)
    .sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 24;
  const gapThreshold = Math.max(30, medianHeight * 2.4);
  const lineRuns = lines.map(line => splitLineIntoRuns(line.words, gapThreshold));
  if (!lineRuns.some(runs => runs.length > 1)) {
    return lineRuns.map(runs => runs.map(r => r.text).join(' ')).filter(Boolean);
  }
  const columns = [];
  lineRuns.forEach((runs, lineIndex) => {
    for (const run of runs) {
      let column = columns.find(c => {
        const overlap = Math.min(c.x1, run.x1) - Math.max(c.x0, run.x0);
        return overlap > 0.25 * Math.min(c.x1 - c.x0, Math.max(1, run.x1 - run.x0));
      });
      if (!column) {
        column = { x0: run.x0, x1: run.x1, cells: [] };
        columns.push(column);
      }
      column.x0 = Math.min(column.x0, run.x0);
      column.x1 = Math.max(column.x1, run.x1);
      column.cells.push({ lineIndex, text: run.text });
    }
  });
  columns.sort((a, b) => a.x0 - b.x0);
  const out = [];
  for (const column of columns) {
    column.cells.sort((a, b) => a.lineIndex - b.lineIndex);
    for (const cell of column.cells) if (cell.text) out.push(cell.text);
  }
  return out;
}

/**
 * Rebuilds the recognized text from Tesseract's block/word geometry instead of
 * its flat text string: low-confidence noise words are dropped and side-by-side
 * columns are emitted as separate contiguous groups. Returns '' when no usable
 * block data came back (caller falls back to the flat text). Pure; exported for tests.
 */
export function textFromTesseractBlocks(blocks, minWordConfidence = OCR_MIN_WORD_CONFIDENCE) {
  const outLines = [];
  for (const block of blocks || []) {
    for (const paragraph of block?.paragraphs || []) {
      const lines = [];
      for (const line of paragraph?.lines || []) {
        const words = (line?.words || [])
          .filter(w => w?.text?.trim() && (w.confidence == null || w.confidence >= minWordConfidence))
          .map(w => ({ text: w.text.trim(), x0: w.bbox?.x0 ?? 0, x1: w.bbox?.x1 ?? 0 }));
        if (words.length) {
          lines.push({ words, height: Math.abs((line.bbox?.y1 ?? 0) - (line.bbox?.y0 ?? 0)) });
        }
      }
      outLines.push(...groupBlockLinesIntoColumnText(lines));
    }
  }
  return outLines.join('\n');
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
 * `{ text, status, charCount, detail, confidence }` where status is one of:
 *   'ok'     - usable text recognized (>= OCR_MIN_USEFUL_CHARS)
 *   'low'    - text recognized but below the usefulness threshold, so discarded
 *   'empty'  - engine ran but found no readable characters
 *   'failed' - the OCR engine could not load or run (detail carries the error)
 * `opts.maskBoxes` (source-canvas coordinates) white out located barcode symbols
 * before recognition. Text is rebuilt from word geometry (column-aware, noise
 * words dropped) whenever the engine returns block data.
 */
export async function recognizeCanvasText(canvas, mark, label, opts = {}) {
  const ocrStart = performance.now();
  try {
    const worker = await getOcrWorker();
    const ocrCanvas = prepareOcrCanvas(canvas, {}, opts.maskBoxes || []);
    const result = await worker.recognize(ocrCanvas, {}, { text: true, blocks: true });
    const structured = textFromTesseractBlocks(result?.data?.blocks);
    const text = normaliseOcrText(structured || result?.data?.text || '');
    const confidence = Number.isFinite(result?.data?.confidence) ? Math.round(result.data.confidence) : null;
    const charCount = text.length;
    if (charCount >= OCR_MIN_USEFUL_CHARS) {
      mark?.(`OCR read ${charCount} character${charCount === 1 ? '' : 's'} from ${label}`, ocrStart);
      return { text, status: 'ok', charCount, detail: '', confidence };
    }
    if (charCount > 0) {
      mark?.(
        `OCR read only ${charCount} character${charCount === 1 ? '' : 's'} from ${label}; below the ${OCR_MIN_USEFUL_CHARS}-character usefulness threshold, so it was treated as no text`,
        ocrStart
      );
      return { text: '', status: 'low', charCount, detail: '', confidence };
    }
    mark?.(`OCR ran on ${label} but found no readable text`, ocrStart);
    return { text: '', status: 'empty', charCount: 0, detail: '', confidence };
  } catch (error) {
    const detail = error?.message || String(error);
    mark?.(`OCR engine failed for ${label}: ${detail}`, ocrStart);
    return { text: '', status: 'failed', charCount: 0, detail, confidence: null };
  }
}

/**
 * Runs a targeted OCR pass over one barcode evidence crop using the aggressive
 * CROP_OCR_PROFILE (strong local contrast stretch, heavy unsharp mask, large
 * magnification, alphanumeric whitelist). This recovers the human-readable digits
 * printed with a barcode far more reliably than the gentle full-label pass, without
 * risking the label's general text - the two passes are independent. The crop text
 * is only ever merged into the label's extracted TEXT (a one-way cross-check);
 * barcode values themselves always come from the decoders.
 */
export async function recognizeBarcodeCropText(cropCanvas, mark, label) {
  const ocrStart = performance.now();
  try {
    const worker = await getOcrWorker();
    const ocrCanvas = prepareOcrCanvas(cropCanvas, CROP_OCR_PROFILE);
    await worker.setParameters({ tessedit_char_whitelist: CROP_OCR_WHITELIST });
    let result;
    try {
      result = await worker.recognize(ocrCanvas);
    } finally {
      // The worker is shared with the full-label pass; always restore the full charset.
      await worker.setParameters({ tessedit_char_whitelist: '' }).catch(() => {});
    }
    const text = normaliseOcrText(result?.data?.text || '');
    if (text.length >= CROP_OCR_MIN_USEFUL_CHARS) {
      mark?.(`Barcode-crop OCR read ${text.length} characters from ${label}`, ocrStart);
      return { text, status: 'ok', charCount: text.length, detail: '' };
    }
    return { text: '', status: text.length ? 'low' : 'empty', charCount: text.length, detail: '' };
  } catch (error) {
    const detail = error?.message || String(error);
    mark?.(`Barcode-crop OCR failed for ${label}: ${detail}`, ocrStart);
    return { text: '', status: 'failed', charCount: 0, detail };
  }
}
