# Threat Model and Data Handling — BarcodeAuditer

Scope: the local-only label audit application as shipped (committed `dist/`
served by `server.mjs`) and its development/build pipeline.
Status: current as of v1.7.6. Review alongside `security-assessment-v1.7.6.md`.

## 1. System overview and data flow

```text
Operator workstation (single trust domain, no network egress by design)

  [Label PDF / image files]            [Pasted Get Shipments JSON]
            |                                     |
            v                                     v
  +---------------------------------------------------------+
  |  Browser tab (http://127.0.0.1:3000)                    |
  |  pdf.js render -> canvas -> zxing decode -> tesseract   |
  |  OCR -> audit engine + JSON rule sets -> report UI      |
  +---------------------------------------------------------+
            ^ static assets only (GET/HEAD)
            |
  +---------------------+
  |  server.mjs (Node)  |  binds 127.0.0.1, serves dist/ only
  +---------------------+
```

All label processing happens in the browser tab. The Node server is a static
file server: it never receives, stores, or logs label content. There is no
database, no remote API call, no telemetry, and no service worker.

## 2. Assets

- **Customer personal data on labels**: names, addresses, article IDs, SSCC
  values, consignment/connote IDs, account references. Highest-value asset.
- **Audit integrity**: the tool's pass/fail/review verdicts are relied on by
  the ECIS team; silently wrong verdicts are a business risk (see the
  identity-gating rule below).
- **The operator's workstation**: the app must not become a foothold
  (local server reachable from the browser, WASM execution, file parsing).

## 3. Trust boundaries and attacker-controlled inputs

The operator and their machine are trusted. Everything that crosses into the
app is untrusted:

| Input | Threat | Mitigation |
| --- | --- | --- |
| Uploaded PDF | Malicious PDF exploiting the renderer; eval via crafted fonts (CVE-2024-4367 class); resource exhaustion | pdf.js with `isEvalSupported: false`; page-count cap (`MAX_PDF_PAGES`); pixel cap (`MAX_IMAGE_PIXELS`); per-file size and batch count limits; browser sandbox |
| Uploaded image | Decompression bombs; malformed encodings | Pixel/size caps; decoding delegated to the browser's hardened image stack; object URLs revoked after decode |
| PDF text layer / OCR output | Crafted text triggering pathological regex backtracking (ReDoS) in fact extraction | `textLines()` caps line length (1000) and count (2000); adversarial time-budget tests in `tests/adversarial.test.mjs` |
| Decoded barcode payloads | Hostile strings (markup, control characters) flowing into the report UI | All rendering is React JSX (auto-escaped); no `dangerouslySetInnerHTML`; GS1 separator handling is explicit; adversarial markup tests |
| Pasted Get Shipments JSON | Stack overflow via deep nesting; memory exhaustion via huge/wide payloads; spoofed payload making a wrong label look correct | Guarded `JSON.parse`; iterative flattening with a 20k-entry cap; payload size limit in the UI; **identity gating** — secondary comparisons report *not applicable*, never *match*, unless identity fields match the label |
| HTTP requests to the local server | DNS rebinding (a malicious website pointing its domain at 127.0.0.1); path traversal; non-idempotent methods | Host-header allowlist (127.0.0.1 / localhost / [::1] → 403 otherwise); `path.relative` containment check; GET/HEAD only; binds 127.0.0.1 |
| Served responses | XSS/clickjacking against the app origin | CSP (`default-src 'none'` baseline with targeted allowances, `wasm-unsafe-eval` only for zxing), `X-Frame-Options: DENY`, COOP/CORP, `nosniff`, no-referrer |
| Build/supply chain | Compromised dependency or CI action | All dependencies pinned exact with per-release CVE disposition in README; `npm audit` gate per release; GitHub Actions pinned to commit SHAs; CodeQL scanning; dist-drift CI gate ensures shipped `dist/` matches source |

## 4. Threats explicitly out of scope

- A compromised operator workstation or browser (the app runs inside the
  user's session; OS-level malware defeats any in-app control).
- Malicious operator (the tool's user is its trust anchor).
- Physical label fraud that requires verifier-grade hardware measurement
  (documented in "Known Limits" in the README).

## 5. Data handling statement

- **What is processed**: label PDFs/images and optionally a pasted Get
  Shipments response. Both can contain customer personal data.
- **Where it lives**: browser tab memory only, for the duration of the
  session. Nothing is written server-side; the Node process serves static
  files and keeps no request bodies (none are accepted) and no content logs.
- **Persistence**: none. The only browser storage used is the optional
  `localStorage` key `ba-debug` (a `'1'` flag enabling diagnostic console
  output); no label data is ever stored. Closing the tab discards all data.
- **Egress**: none. The CSP `connect-src 'self'` and the absence of any
  fetch/XHR/WebSocket code paths mean label data cannot leave the machine.
- **Exports**: any evidence leaving the app (screenshots, saved reports) is an
  explicit operator action; handle exports as internal/customer data per team
  policy. The repository must never contain real customer labels
  (`Resources/` holds reference examples only).

## 6. Residual / accepted risks

| Risk | Status | Rationale |
| --- | --- | --- |
| Launcher EXE is not code-signed | Open (owner decision) | Compensating control: SHA-256 checksum published with each portable release |
| Two moderate advisories in dev-only esbuild (via Vite 5 dev server) | Accepted, tracked | Affects `npm run dev` on developer machines only; fix requires a breaking Vite major bump; never ships in `dist/` |
| `wasm-unsafe-eval` in CSP | Accepted | Required by the zxing WASM decoder; scoped allowance, no `unsafe-eval` |
| Browser/OS zero-days during file parsing | Accepted | Delegated to browser sandbox; caps reduce exposure |
