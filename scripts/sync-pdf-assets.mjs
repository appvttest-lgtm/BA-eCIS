// Regenerates the committed pdf.js standard-font files in public/standard_fonts/
// from the pinned pdfjs-dist package, so they cannot drift from the pdfjs-dist
// version in package.json.
//
// These are pdf.js's fallbacks for the standard 14 PDF fonts (Helvetica, Courier,
// Times...) that a PDF may use without embedding. Without a reachable
// standardFontDataUrl, pdf.js warns and falls back to approximate metrics, and a
// blocked font fetch is one more way a page render can fail on a locked-down
// machine. Bundling them keeps PDF rendering fully offline.
//
// Run after bumping pdfjs-dist:
//   node scripts/sync-pdf-assets.mjs   (or: npm run sync:pdf)
// then `npm run build` to refresh dist/, and commit both.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromDir = path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts');
const toDir = path.join(root, 'public', 'standard_fonts');

fs.rmSync(toDir, { recursive: true, force: true });
fs.mkdirSync(toDir, { recursive: true });

let copied = 0;
let bytes = 0;
console.log('standard fonts:');
for (const file of fs.readdirSync(fromDir).sort()) {
  fs.copyFileSync(path.join(fromDir, file), path.join(toDir, file));
  const size = fs.statSync(path.join(toDir, file)).size;
  copied += 1;
  bytes += size;
  console.log(`  standard_fonts/${file} (${(size / 1024).toFixed(0)} KB)`);
}

console.log(`\nSynced ${copied} standard font file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB total.`);
console.log('Run `npm run build` next.');
