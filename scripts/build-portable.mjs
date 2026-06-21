// Assembles the committed `portable/` folder: the launch-ready app plus the
// "run with Node.js" README. Runs on plain Node (no .bat, no compiler), so it works
// on a locked-down workstation and inside the git pre-commit hook.
//
// portable/ contents:
//   dist/        - the prebuilt web app (mirrors the committed dist/)
//   server.mjs   - the local-only static server (`node server.mjs`)
//   README.md    - how to install Node from the portal and launch on 127.0.0.1:3000
//
// It copies the already-built dist/, so run `npm run build` first if you changed src.

import { cp, rm, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portable = path.join(root, 'portable');
const distIndex = path.join(root, 'dist', 'index.html');

if (!existsSync(distIndex)) {
  console.error('[build:portable] dist/index.html not found — run "npm run build" first.');
  process.exit(1);
}

await rm(portable, { recursive: true, force: true });
await mkdir(portable, { recursive: true });
await cp(path.join(root, 'dist'), path.join(portable, 'dist'), { recursive: true });
await copyFile(path.join(root, 'server.mjs'), path.join(portable, 'server.mjs'));
await copyFile(path.join(root, 'share', 'README.md'), path.join(portable, 'README.md'));

console.log('[build:portable] portable/ refreshed (dist + server.mjs + README.md).');
