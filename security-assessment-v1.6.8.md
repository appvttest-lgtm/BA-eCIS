# BarcodeAuditer v1.6.8 Security and Dependency Assessment

Scope: `C:\Users\chris\OneDrive\Documents\GitHub\BarcodeAuditer`

Assessment date: 2026-06-03

Branch at assessment: `codex/barcode-auditer-v1.6.8-wrapper`

## Executive Summary

BarcodeAuditer is a local-only React/Vite application served by a small Node.js
static server and launched by a portable Windows wrapper. The architecture is
appropriate for a high-security environment because the server is localhost-only,
the runtime package does not need `node_modules`, and label processing stays in
the browser session.

The main risks are not classic backend risks such as auth bypass or SQL
injection. The highest-priority risks are supply-chain exposure during builds,
unsafe generated HTML reports, malformed PDF/image processing, oversized-file
denial of service, missing browser hardening headers, unsigned executable
distribution, and package metadata that currently treats build-only libraries as
production dependencies.

## Commands Run

- `npm.cmd ls --all --depth=0`
- `npm.cmd audit --audit-level=moderate` with `NODE_OPTIONS=--use-system-ca`
- `npm.cmd audit --json` with `NODE_OPTIONS=--use-system-ca`
- `npm.cmd outdated --long` with `NODE_OPTIONS=--use-system-ca`
- Source searches for imports, network sinks, browser storage, dynamic code
  execution, report generation, filesystem serving, process spawning, and
  wrapper behavior.

## Dependency Inventory

Direct packages currently declared in `dependencies`:

| Package | Current | Latest Observed | Source Usage | Recommendation |
| --- | --- | --- | --- | --- |
| `react` | `18.3.1` | `19.2.7` | Used by `src/main.jsx` hooks/components. | Keep. Move to `devDependencies` for this project packaging model. |
| `react-dom` | `18.3.1` | `19.2.7` | Used by `createRoot`. | Keep. Move to `devDependencies`. |
| `pdfjs-dist` | `4.10.38` | `6.0.227` | Used for browser PDF rendering and worker URL. | Keep. Consider upgrade testing separately. Move to `devDependencies`. |
| `@zxing/library` | `0.21.3` | `0.23.0` | Used as JS fallback decoder. | Keep unless fallback is intentionally removed after test coverage. Move to `devDependencies`. |
| `zxing-wasm` | `3.0.3` | `3.1.0` | Used as primary WASM decoder. | Keep. Move to `devDependencies`. |
| `vite` | `5.4.21` | `8.0.16` | Build/dev server only. | Keep as build tool. Move to `devDependencies`. Upgrade carefully. |
| `typescript` | `5.6.3` | `6.0.3` | No source usage found; no `.ts` files or `tsconfig`. | Remove direct dependency. |

Runtime package note: the portable ZIP contains `BarcodeAuditer.exe`, bundled
`node.exe`, `server.mjs`, `dist/`, and docs. It does not need `node_modules`.
Therefore, every frontend/build library should be treated as a build-time
dependency, not a production runtime dependency.

## npm Audit Findings

`npm audit` reports 2 moderate vulnerabilities:

1. `esbuild <=0.24.2`: GHSA-67mh-4wv8-2f99
   - Issue: any website can send requests to the development server and read
     responses.
   - Path: transitive dependency through `vite`.
   - Impact here: development-server exposure, not portable runtime exposure,
     because the release ZIP does not use Vite or esbuild.

2. `vite <=6.4.1`: GHSA-4w7w-66w2-5vf9
   - Issue: path traversal/information exposure in optimized dependency source
     map handling.
   - Impact here: development-server exposure, not portable runtime exposure.

Do not blindly run `npm audit fix --force`; npm indicates that would install
`vite@8.0.16`, a semver-major upgrade. Upgrade Vite deliberately, rebuild, and
regression-test PDF rendering, worker URLs, WASM asset paths, and report export.

## High Priority Code Risks

### 1. Missing Content Security Policy

Location: `server.mjs`

The local server sets `X-Content-Type-Options` and cache headers, but no CSP,
frame protection, or referrer policy. A CSP is valuable because reports and UI
render data derived from attacker-controlled PDFs/images/barcodes.

Recommended headers:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

### 2. Generated HTML Report Safety

Location: `src/main.jsx`

The report generator uses explicit `esc()` helpers in the high-risk report
sections reviewed. This is good. However, the generated report is a large manual
template and should be treated as a standing XSS risk because label text,
barcode values, filenames, extracted PDF text, and pasted API payloads are
attacker-controlled.

Recommended:

- Keep all user/file-derived values escaped.
- Add tests for report export with strings containing `<script>`, quotes,
  event handlers, `javascript:` strings, and malformed barcode text.
- Review any future report-template edits specifically for unescaped
  interpolation.

### 3. Uploaded File Denial of Service

Location: `src/main.jsx`

The app accepts PDFs and images and performs CPU/memory-heavy rendering,
cropping, decoding, rotation, thresholding, and WASM scanning. There is no clear
central limit on file size, PDF page count, image dimensions, number of files,
or scan time per batch.

Recommended:

- Limit file size, for example 25-50 MB per file.
- Limit PDF page count per file.
- Limit total files per batch.
- Limit rendered canvas dimensions.
- Abort scans after a configurable time budget.
- Show a controlled error rather than allowing browser lockups.

### 4. Browser Object URL Cleanup

Location: `src/main.jsx`

The app uses `URL.createObjectURL` for uploaded images and generated report
downloads. Downloads revoke URLs after click, but uploaded image preview object
URLs should be checked for `URL.revokeObjectURL` cleanup after image load or
after processing.

Recommended:

- Revoke image object URLs after use.
- Clear large in-memory canvas/data URL references when a new batch starts.

### 5. Local Static Server Surface

Location: `server.mjs`

Current wrapper branch has already improved this area:

- Host is hard-coded to `127.0.0.1`.
- Static path guard uses `path.relative`.
- Server only serves files from `dist`.

Remaining improvements:

- Add security headers.
- Reject non-GET/HEAD methods.
- Validate `PORT` is a safe localhost port number.
- Consider random high port or single-instance health validation if port 3000
  collisions are common.

### 6. Portable Wrapper Process Lifecycle

Location: `wrapper/windows/BarcodeAuditerLauncher.cpp`

The EXE starts a Node server and opens the browser. It does not own server
lifetime after launch. This is acceptable for a simple portable wrapper, but it
may leave a background Node process running after the browser closes.

Recommended:

- Add a `/shutdown` endpoint guarded to localhost and a tray/console stop flow,
  or document that the minimized server window must be closed.
- Add a health-check wait loop before opening the browser rather than a fixed
  sleep.
- If an existing service is on port 3000, verify `/healthz` returns the expected
  app marker before opening the browser.

### 7. Unsigned Binary and ZIP Integrity

Location: release process

The build creates SHA-256 output, which is good. The EXE is not code-signed.

Recommended:

- Code-sign `BarcodeAuditer.exe` when possible.
- Publish checksum separately from the ZIP.
- Include an SBOM and dependency versions in the release folder.
- Avoid distributing from user-writable shared folders without integrity checks.

## Medium Priority Risks

### Regex and Text Parsing Robustness

Location: `src/auditEngine.js`

The audit engine contains many regexes over attacker-controlled extracted text,
barcode data, and pasted payload strings. Most reviewed patterns are bounded and
simple, but the amount of regex parsing means ReDoS should be included in test
coverage.

Recommended:

- Add adversarial tests for very long text lines and repeated characters.
- Avoid nested quantifiers in new regexes.
- Consider max length normalization before regex parsing.

### JSON Payload Parsing

Location: `src/auditEngine.js`

The optional API payload comparison parses pasted text with `JSON.parse`.
Risk is primarily resource exhaustion from huge payloads or deeply nested data.

Recommended:

- Enforce max payload length.
- Fail closed with a concise validation message.
- Avoid recursive traversal without depth limits.

### Release Script Uses PowerShell Bypass

Location: `build-portable-release.bat`, `start-auditer.bat`

The release script uses PowerShell with `ExecutionPolicy Bypass` to ZIP and hash,
and the old BAT launcher uses PowerShell for health checks. This may be
operationally sensitive in high-security environments.

Recommended:

- Keep PowerShell out of end-user launcher.
- For build-time use, this is acceptable if only developers run it.
- If necessary, replace ZIP/hash generation with signed enterprise tooling.

### Development Server Exposure

Location: `package.json`

The Vite dev server binds to `127.0.0.1`, which is good. The reported Vite and
esbuild advisories are still relevant to developer machines.

Recommended:

- Do not run dev server while browsing untrusted sites.
- Upgrade Vite/esbuild in a controlled task.
- Keep dev server host pinned to `127.0.0.1`.

## Low / Informational

- `mailto:` feedback link exists. This is acceptable but can leak user email
  metadata if used.
- The app does not appear to use `fetch`, `XMLHttpRequest`, `localStorage`,
  `sessionStorage`, `indexedDB`, `eval`, `new Function`, or
  `dangerouslySetInnerHTML` in the reviewed source.
- Direct dependency versions are exact, which is preferable for reproducible
  builds.
- The current bundled Node runtime is Node `v24.16.0`, a supported current/LTS
  line at assessment time. Track Node release status for future ZIPs.

## Libraries That Can Be Removed or Changed

### Remove

1. `typescript`
   - Reason: no `.ts` or `.tsx` files, no `tsconfig`, no source import, and no
     package script that invokes `tsc`.
   - Expected impact: reduces direct dependency count and audit surface.
   - Validation after removal: `npm ci`, `npm run build`, portable release build.

### Move to `devDependencies`

All remaining direct packages should be moved from `dependencies` to
`devDependencies`:

- `@zxing/library`
- `pdfjs-dist`
- `react`
- `react-dom`
- `vite`
- `zxing-wasm`

Reason: the Node runtime server uses only built-in Node modules. The release ZIP
ships the compiled `dist/` assets and bundled `node.exe`; it does not need
runtime `node_modules`.

### Keep

1. `pdfjs-dist`
   - Required for browser PDF rendering.

2. `zxing-wasm`
   - Required for the primary barcode scanning path.

3. `@zxing/library`
   - Currently used as pure-JS fallback. It can only be removed if product
     testing confirms native BarcodeDetector + zxing-wasm is sufficient for all
     required eParcel/StarTrack labels.

4. `react` and `react-dom`
   - Required for the UI.

5. `vite`
   - Required to build `dist/`.

## Recommended Remediation Order

1. Remove `typescript`.
2. Move remaining direct packages to `devDependencies`.
3. Add security headers to `server.mjs`.
4. Add upload/payload size and page-count limits.
5. Add report XSS regression tests.
6. Add object URL cleanup for uploaded image processing.
7. Add SBOM generation to release process.
8. Add launcher health-check wait loop and existing-service validation.
9. Plan a controlled Vite upgrade to resolve current moderate dev-server
   advisories.
10. Code-sign the launcher executable for enterprise distribution.

## Sources Consulted

- OWASP Top 10: https://owasp.org/Top10/2021/
- OWASP npm Security Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html
- OWASP XSS Prevention Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Content Security Policy Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- OWASP File Upload Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- Node.js EOL guidance: https://nodejs.org/en/about/eol
- Node.js releases: https://nodejs.org/en/about/releases/
- npm audit docs: https://docs.npmjs.com/cli/v8/commands/npm-audit/
- GitHub Advisory GHSA-67mh-4wv8-2f99:
  https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99
- npm/GitHub Advisory GHSA-4w7w-66w2-5vf9:
  https://github.com/advisories/GHSA-4w7w-66w2-5vf9
