// Regenerates the committed OCR runtime assets in public/ from the pinned
// node_modules packages, so they cannot silently drift from the tesseract.js
// version in package.json.
//
// This drift is exactly what broke OCR once: tesseract.js 7 began requesting a
// `relaxedsimd` core variant that the hand-copied public/tesseract-core/ folder
// did not contain, so the worker's importScripts failed and OCR returned nothing.
//
// Run after bumping tesseract.js / tesseract.js-core:
//   node scripts/sync-ocr-assets.mjs   (or: npm run sync:ocr)
// then `npm run build` to refresh dist/, and commit both.
//
// Scope: the worker and WASM core variants ONLY. The language data
// (public/tessdata/eng.traineddata.gz) is deliberately the smaller "fast" model
// and is NOT sourced from @tesseract.js-data/eng (whose 4.0.0 model is ~10 MB vs
// ~3 MB); it is stable and managed separately, so this script never touches it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromPkg = (...p) => path.join(root, 'node_modules', ...p);
const toPublic = (...p) => path.join(root, 'public', ...p);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copy(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return fs.statSync(dest).size;
}

let copied = 0;
let bytes = 0;
const note = (label, size) => {
  copied += 1;
  bytes += size;
  console.log(`  ${label} (${(size / 1024).toFixed(0)} KB)`);
};

// 1. Tesseract worker (main-thread entry the app loads as a Web Worker).
console.log('worker:');
note('tesseract/worker.min.js', copy(fromPkg('tesseract.js', 'dist', 'worker.min.js'), toPublic('tesseract', 'worker.min.js')));

// 2. Every WASM core variant. tesseract.js feature-detects the browser's SIMD
//    support at runtime and requests one of these by name, so ALL must be present
//    (plain / simd / relaxedsimd, each with and without the LSTM model).
console.log('core (all wasm variants):');
const coreDir = fromPkg('tesseract.js-core');
for (const file of fs.readdirSync(coreDir).sort()) {
  if (file.endsWith('.wasm') || file.endsWith('.wasm.js')) {
    note(`tesseract-core/${file}`, copy(path.join(coreDir, file), toPublic('tesseract-core', file)));
  }
}

console.log(`\nSynced ${copied} OCR asset(s), ${(bytes / 1024 / 1024).toFixed(1)} MB total.`);
console.log('Language data (public/tessdata) left untouched by design. Run `npm run build` next.');
