# BarcodeAuditer v1.7.6 Security and Dependency Assessment

Scope: full repository at tag/release v1.7.6.
Assessment date: 2026-06-12.
Branch at assessment: `main`.
Predecessor: `security-assessment-v1.6.8.md` (2026-06-03). Every finding from
that assessment is dispositioned in section 3.
Companion: `docs/security/threat-model.md` (data flow, trust boundaries,
data-handling statement, accepted-risk register).

## 1. Executive summary

BarcodeAuditer remains a local-only React/Vite application served by a small
Node.js static server. Since the v1.6.8 assessment, the v1.7.x line has closed
every high-priority code finding: security headers including a restrictive CSP,
DNS-rebinding protection via a Host-header allowlist, upload and payload
resource limits, removal of the unused HTML report export path, pdf.js font
eval disabled, adversarial-input hardening with regression tests, supply-chain
controls (exact-pinned dependencies, SHA-pinned CI actions, CodeQL, a CI gate
proving the committed `dist/` matches source), and a PowerShell-free end-user
launcher.

Open items are organisational rather than code-level: code-signing the
portable launcher EXE and the deliberate, deferred Vite major upgrade that
would clear two dev-only moderate advisories.

## 2. Verification performed for this assessment

- `npm audit --omit=dev`: **0 vulnerabilities** in the production tree.
- `npm audit` (full tree): 2 moderate, both in dev-only tooling
  (esbuild via the Vite 5 dev server); they never ship in `dist/`.
- `npm test`: 90 node:test cases passing, including
  `tests/adversarial.test.mjs` (hostile markup, ReDoS time budgets,
  malformed/deeply nested/oversized payloads).
- `npm run lint` and `npm run format:check`: clean.
- CI on `main`: lint, format, tests, build, and the dist-drift gate; CodeQL
  scanning enabled and passing.
- Live checks during the v1.7.4–v1.7.6 work: path traversal vectors (plain,
  percent-encoded, backslash) all contained; non-loopback Host header
  rejected with 403; launcher health check verified against a running and a
  stopped server.

## 3. Disposition of v1.6.8 findings

| # | v1.6.8 finding | Severity | Status | Disposition |
| --- | --- | --- | --- | --- |
| H1 | Missing CSP / security headers | High | **Closed** (v1.7.0, v1.7.4) | `server.mjs` sends CSP (`default-src 'none'` baseline, `wasm-unsafe-eval` scoped to the zxing decoder), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP, CORP, `X-Permitted-Cross-Domain-Policies: none`, `nosniff` |
| H2 | Generated HTML report XSS surface | High | **Closed by removal** (post-v1.7.4) | The report download path was unreachable from the UI and was deleted; the in-app report is React JSX (auto-escaped, no `dangerouslySetInnerHTML`). Hostile-markup regression tests added in v1.7.6 |
| H3 | Uploaded file denial of service | High | **Closed** (v1.7.0, v1.7.6) | Limits on batch file count, file size, PDF page count, and image pixel count; v1.7.6 adds extracted-text line length/count caps after probing found quadratic regex backtracking |
| H4 | Object URL cleanup | High | **Closed** (v1.7.0) | Temporary object URLs revoked after image decode |
| H5 | Local static server surface | High | **Closed** (v1.7.0–v1.7.5) | GET/HEAD only; PORT validated; `path.relative` containment; Host-header loopback allowlist (DNS-rebinding protection, v1.7.4); fully async request path (v1.7.5) |
| H6 | Wrapper process lifecycle | High | **Partially closed / accepted** | `/healthz` exists and the launcher polls it before opening the browser; the server window must be closed to stop the process and says so on startup. A tray/shutdown flow remains future work |
| H7 | Unsigned EXE / ZIP integrity | High | **Open — owner decision** | SHA-256 checksum published per release; SBOM added in v1.7.6. Code signing requires an organisational certificate |
| M1 | Regex/ReDoS robustness | Medium | **Closed** (v1.7.6) | Probing confirmed the risk was real (a 40k-char pathological line took ~1s in the postcode regex). Line caps added; time-budget tests pin the behavior |
| M2 | JSON payload parsing robustness | Medium | **Closed** (v1.7.6) | Probing found an uncaught stack overflow on deeply nested pasted JSON. Flattening is now iterative with a 20k-entry cap; `JSON.parse` failures fail closed with a parse error |
| M3 | PowerShell `ExecutionPolicy Bypass` in launcher | Medium | **Closed for end users** (v1.7.6) | `start-auditer.bat` now uses `curl.exe` and plain batch; PowerShell remains only in the developer-run release packaging script, which is accepted |
| M4 | Dev server advisory exposure (Vite/esbuild) | Medium | **Accepted, tracked** | Dev-machine only; `npm run dev` binds 127.0.0.1; fix requires a breaking Vite major bump, deferred deliberately under the pinned-dependency policy |
| L1 | Remove unused `typescript` dependency | Low | **Closed** | Removed from `package.json`; stale README references cleaned up in v1.7.6 |
| L2 | Move build libraries to `devDependencies` | Low | **Closed** | All direct packages are `devDependencies`; the runtime needs only Node built-ins |
| L3 | SBOM in the release process | Low | **Closed** (v1.7.6) | `npm run sbom` generates CycloneDX; the release SBOM is committed alongside the release |

## 4. Controls added since v1.6.8 (not in the original findings)

- **DNS rebinding protection** — Host-header allowlist in `server.mjs` (v1.7.4).
- **pdf.js `isEvalSupported: false`** — closes the crafted-font eval class
  (CVE-2024-4367) as defense in depth (v1.7.4).
- **CI dist-drift gate** — proves the committed `dist/` was built from the
  committed source on every push (v1.7.5).
- **CodeQL scanning** enabled on the repository.
- **GitHub Actions pinned to commit SHAs** (v1.7.6) so retargeted tags cannot
  change what runs in CI.
- **Adversarial regression tests** (v1.7.6) keeping the hostile-input
  guarantees enforced rather than asserted.
- **Threat model and data-handling statement** (v1.7.6) at
  `docs/security/threat-model.md`.

## 5. Current dependency posture

All direct dependencies are pinned exact and individually dispositioned in the
README "Dependency Vulnerability Assessment" section (react/react-dom 18.3.1,
pdfjs-dist 4.10.38, @zxing/library 0.21.3, zxing-wasm 3.0.3, vite 5.4.21,
tesseract.js 7.0.0, @tesseract.js-data/eng 1.0.0, plus exact-pinned lint/format
tooling). Production tree: 0 known vulnerabilities. The committed SBOM
enumerates the full build-time tree.

## 6. Remaining recommendations (priority order)

1. Code-sign `BarcodeAuditer.exe` when an organisational signing certificate
   is available (H7); continue publishing SHA-256 checksums until then.
2. Plan the controlled Vite major upgrade to clear the two dev-only moderate
   advisories (M4); regression-test PDF rendering, worker URLs, and WASM asset
   paths when it happens.
3. Consider a guarded shutdown flow for the wrapper (H6) if operators report
   orphaned server windows.
4. Optional engineering uplift, not security-blocking: a `tsc`-verified
   `@ts-check` annotation pass over the JSDoc added in v1.7.5.
