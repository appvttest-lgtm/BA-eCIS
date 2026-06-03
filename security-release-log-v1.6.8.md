# Security Release Log - BarcodeAuditer v1.6.8

Branch: `codex/barcode-auditer-v1.6.8-wrapper`

Release target: `BarcodeAuditer-v1.6.8-windows-x64-portable`

Date: 2026-06-03

## Purpose

This release packages the local Australia Post eCommerce Integration Label
Auditor as a no-install Windows portable application and applies the security
hardening identified during the v1.6.8 assessment.

The intended runtime model is:

- no admin installation
- no Windows service
- no registry writes
- no external API or telemetry
- bundled portable `node.exe`
- localhost-only static server
- browser-based PDF/image/barcode processing

## Security Assessment

Detailed assessment:

```text
security-assessment-v1.6.8.md
```

Primary risk categories reviewed:

- npm supply-chain and dependency surface
- static local server exposure
- path traversal
- browser XSS and generated HTML report safety
- file upload and oversized-file denial of service
- PDF/image parser exposure
- local process/wrapper behavior
- portable binary integrity

## Security Commit

Commit:

```text
b74700d Harden barcode auditor security controls
```

Files changed by the security commit:

```text
package.json
package-lock.json
security-assessment-v1.6.8.md
server.mjs
src/main.jsx
```

## Security Changes Made

### Dependency Surface Reduction

- Removed unused direct dependency `typescript`.
- Moved frontend/build packages from `dependencies` to `devDependencies`.
- Rationale: the portable release ships compiled `dist/` assets and a bundled
  Node runtime; it does not ship or execute `node_modules`.

Result:

- `npm audit --omit=dev` reports `0 vulnerabilities`.
- Dev-inclusive audit still reports the known Vite/esbuild moderate advisories,
  which affect development-server exposure rather than packaged runtime.

### Static Server Hardening

File:

```text
server.mjs
```

Controls added:

- host hard-locked to `127.0.0.1`
- port value validation
- `GET` and `HEAD` only
- safer static path validation using `path.relative`
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- restrictive `Permissions-Policy`
- preserved `X-Content-Type-Options: nosniff`

Validated packaged response headers:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
X-Frame-Options: DENY
```

### Upload and Payload Limits

File:

```text
src/main.jsx
```

Controls added:

- max 20 files per batch
- max 50 MB per selected file
- max 40 PDF pages per file
- max 50 megapixels per image
- max 500 KB optional API payload text

Purpose:

- reduce browser memory exhaustion risk
- reduce CPU-heavy scan denial of service
- reduce risk from huge pasted JSON payloads

### Object URL Cleanup

File:

```text
src/main.jsx
```

Change:

- image object URLs are revoked on image `load` or `error`.

Purpose:

- reduce lingering in-memory references to uploaded image files
- reduce browser memory pressure during repeated scan sessions

## Portable Wrapper Additions

Files:

```text
wrapper/windows/BarcodeAuditerLauncher.cpp
build-portable-release.bat
```

Wrapper behavior:

- locates files relative to `BarcodeAuditer.exe`
- requires `node/node.exe`
- requires `server.mjs`
- requires `dist/index.html`
- starts the bundled Node server
- opens `http://127.0.0.1:3000`

Build script behavior:

- runs `npm ci`
- runs `npm run build`
- compiles `BarcodeAuditer.exe` with Visual Studio Build Tools
- copies `dist/`, `server.mjs`, docs, and bundled `node.exe`
- creates the portable ZIP
- writes SHA-256 checksum output

## Verification Performed

Commands:

```text
npm.cmd ls --depth=0
npm.cmd audit --omit=dev
npm.cmd audit --audit-level=moderate
npm.cmd run build
.\build-portable-release.bat
```

Results:

- dependency tree has no extraneous `typescript`
- production/runtime audit: `0 vulnerabilities`
- dev-inclusive audit: 2 known moderate Vite/esbuild dev-server advisories
- Vite production build passed
- portable ZIP rebuilt successfully
- packaged server health check passed
- packaged server CSP and frame-protection headers verified

Packaged health response:

```json
{"status":"ok","mode":"local-only"}
```

Current ZIP checksum:

```text
F96A8D6E7074B3B1CBA54FC49248977FEF2A1DC0DB4ABF94FCC91A4F0BCE443A  BarcodeAuditer-v1.6.8-windows-x64-portable.zip
```

## Known Residual Risks

The following were intentionally not fixed in this release commit:

- Vite/esbuild dev-server moderate advisories, because npm proposes a semver
  major Vite upgrade. This should be handled as a separate compatibility task.
- Code signing is not configured.
- The wrapper does not yet own server lifecycle after launching the browser.
- The wrapper uses a fixed short wait before opening the browser rather than a
  native health-check loop.
- Old release artifacts and IDE file changes were already dirty in the working
  tree and were not included in the security patch commit.

## Release Handling Guidance

- Distribute the ZIP and checksum together.
- Prefer code signing before enterprise deployment.
- Do not distribute `node_modules`.
- Do not run the development server in production.
- Treat generated HTML audit reports as sensitive customer/internal data.
