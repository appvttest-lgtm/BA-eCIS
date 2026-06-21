// Compliance harness: renders/decodes every example label with the REAL canvasUtils
// enhancement code + the REAL audit engine, and reports decode + audit compliance.
// Node-only; the browser pipeline's orchestration is mirrored here. OCR (tesseract)
// is browser-only, so image labels are decode-checked; PDFs use their text layer.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { readBarcodes } from 'zxing-wasm/reader';
import { createWorker } from 'tesseract.js';

globalThis.document = { createElement: () => createCanvas(1, 1) };
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

const cu = await import('../src/scanner/canvasUtils.js');
const { auditLabel } = await import('../src/auditEngine.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

// OCR mirrors the app (final text grab); browser worker paths differ, so a Node
// worker runs over the SAME enhanced canvas to exercise text-dependent checks.
const ocrWorker = await createWorker('eng', 1, { langPath: path.resolve('public/tessdata'), cachePath: path.resolve('public/tessdata'), gzip: true });
async function ocr(canvas) {
  const { data: { text } } = await ocrWorker.recognize(canvas.toBuffer('image/png'));
  return text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
function mergeText(...texts) {
  const seen = new Set(), out = [];
  for (const t of texts) for (const l of String(t || '').split(/\r?\n/)) {
    const c = l.replace(/\s+/g, ' ').trim(); if (!c || seen.has(c.toUpperCase())) continue;
    seen.add(c.toUpperCase()); out.push(c);
  }
  return out.join('\n');
}

const DIR = 'Resources/Example labels';
const LABELS = [
  { file: `${DIR}/EXP.pdf`, family: 'eparcel' },
  { file: `${DIR}/PP.pdf`, family: 'eparcel' },
  { file: `${DIR}/Express Post - Australia Post.pdf`, family: 'eparcel' },
  { file: 'Resources/Australia Post Parcel Post Example.pdf', family: 'eparcel' },
  { file: `${DIR}/PRM.pdf`, family: 'startrack' },
  { file: `${DIR}/PRM image sample.png`, family: 'startrack' },
  { file: `${DIR}/Screenshot 2026-06-19 130215.png`, family: 'startrack' },
  { file: `${DIR}/image eparcel.png`, family: 'eparcel' }
];
const canvasFactory = {
  create: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; },
  reset: (ci, w, h) => { ci.canvas.width = w; ci.canvas.height = h; },
  destroy: ci => { ci.canvas.width = 0; ci.canvas.height = 0; }
};

async function renderPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 4 });
  const ci = canvasFactory.create(Math.floor(vp.width), Math.floor(vp.height));
  await page.render({ canvasContext: ci.context, viewport: vp, canvasFactory }).promise;
  const tc = await page.getTextContent().catch(() => ({ items: [] }));
  const rows = new Map();
  for (const it of tc.items || []) {
    const s = String(it.str || '').trim(); if (!s) continue;
    const y = Math.round((it.transform?.[5] || 0) / 4);
    rows.set(y, [...(rows.get(y) || []), [it.transform?.[4] || 0, s]]);
  }
  const text = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, arr]) => arr.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ')).join('\n');
  return { canvas: ci.canvas, text, widthMm: (vp1.width * 25.4) / 72, heightMm: (vp1.height * 25.4) / 72 };
}
async function renderImage(file) {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return { canvas: c, text: '', widthMm: null, heightMm: null };
}

function variants(base) {
  const trimmed = cu.trimDarkBounds(base, 18, 210);
  const bordered = cu.addWhiteBorder(trimmed, 0.08);
  const x2 = cu.scaleCanvas(bordered, 2);
  return [
    base, bordered, x2, cu.scaleCanvas(bordered, 4),
    cu.thresholdCanvas(x2, 150), cu.thresholdCanvas(x2, 185),
    cu.sharpenCanvas(bordered, 2, 1.0),
    // DataMatrix/QR square-pure variants (mirror makeScanVariants for 2D symbols).
    cu.scaleCanvas(cu.squareCanvas(trimmed, 0.2), 2),
    cu.scaleCanvas(cu.squareCanvas(trimmed, 0.16), 4)
  ];
}
async function decode(canvas, formats) {
  const ctx = canvas.getContext('2d');
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const res = await readBarcodes({ data: new Uint8ClampedArray(im.data), width: canvas.width, height: canvas.height },
    { formats, tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 0, returnErrors: false });
  return (res || []).filter(r => r && r.text && r.isValid !== false)
    .map(r => ({ rawValue: r.text, format: /matrix/i.test(r.format) ? 'data_matrix' : /qr/i.test(r.format) ? 'qr_code' : 'code_128' }));
}
async function scanAll(base, formats) {
  const map = new Map();
  for (const v of variants(base)) for (const b of await decode(v, formats)) map.set(b.format + ':' + b.rawValue.replace(/\s/g, ''), b);
  return [...map.values()];
}

const ISSUE = new Set(['fail', 'warning', 'manual_review']);
let totalChecks = 0, totalIssues = 0;
for (const L of LABELS) {
  const isPdf = L.file.toLowerCase().endsWith('.pdf');
  const r = isPdf ? await renderPdf(L.file) : await renderImage(L.file);
  const enhanced = cu.enhanceInputForQuality(r.canvas).canvas;
  const formats = L.family === 'startrack' ? ['Code128', 'QRCode', 'DataMatrix'] : ['Code128', 'DataMatrix', 'QRCode'];
  const detectedBarcodes = await scanAll(enhanced, formats);
  const extractedText = mergeText(r.text, await ocr(enhanced));
  const audit = auditLabel({
    labelFamily: L.family, labelFormat: 'standard', detectedBarcodes, extractedText,
    fileInfo: { pixelWidth: enhanced.width, pixelHeight: enhanced.height, widthMm: r.widthMm, heightMm: r.heightMm, fileType: isPdf ? 'application/pdf' : 'image/png', pageCount: 1 }
  });
  const v = audit.validations || [];
  const issues = v.filter(x => ISSUE.has(x.status));
  totalChecks += v.length; totalIssues += issues.length;
  const name = L.file.split('/').pop();
  console.log(`\n${name}  [${L.family}]  decoded ${detectedBarcodes.length}: ${detectedBarcodes.map(b => b.rawValue.slice(0, 18)).join(', ') || '—'}`);
  console.log(`  checks ${v.length}, issues ${issues.length}${issues.length ? ':' : ' -> 100% PASS'}`);
  for (const x of issues) console.log(`    [${String(x.status).padEnd(13)}] ${(x.id || '').padEnd(16)} ${x.message}`.slice(0, 160));
}
await ocrWorker.terminate();
console.log(`\n==== TOTAL: ${totalChecks - totalIssues}/${totalChecks} checks clean (${totalIssues} issues) ====`);
