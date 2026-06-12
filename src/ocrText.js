const OCR_MIN_LONG_EDGE = 1800;
const OCR_MAX_LONG_EDGE = 2800;
const OCR_MIN_USEFUL_CHARS = 12;

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

function prepareOcrCanvas(sourceCanvas) {
  const longEdge = Math.max(sourceCanvas.width, sourceCanvas.height);
  const upscale = longEdge < OCR_MIN_LONG_EDGE ? OCR_MIN_LONG_EDGE / Math.max(1, longEdge) : 1;
  const downscale = longEdge > OCR_MAX_LONG_EDGE ? OCR_MAX_LONG_EDGE / longEdge : 1;
  const scale = Math.min(2, upscale) * Math.min(1, downscale);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

function normaliseOcrText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

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

export async function recognizeCanvasText(canvas, mark, label) {
  const ocrStart = performance.now();
  try {
    const worker = await getOcrWorker();
    const ocrCanvas = prepareOcrCanvas(canvas);
    const result = await worker.recognize(ocrCanvas);
    const text = normaliseOcrText(result?.data?.text || '');
    mark?.(`OCR extracted text from ${label} (${text.length} character${text.length === 1 ? '' : 's'})`, ocrStart);
    return text.length >= OCR_MIN_USEFUL_CHARS ? text : '';
  } catch (error) {
    mark?.(`OCR unavailable for ${label}: ${error.message || String(error)}`, ocrStart);
    return '';
  }
}
