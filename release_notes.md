
BarcodeAuditer v1.7.4 Release Notes
===================================

Release focus
-------------
The v1.7.1 to v1.7.4 line replaces hard-coded validation logic with external JSON rule sets, adds a rule-by-rule report UI, introduces input preprocessing for rotated and multi-label uploads, and hardens the local server and exported reports. The local-only security design is unchanged.

v1.7.4 - security hardening
---------------------------
- DNS rebinding protection: server.mjs now rejects requests whose Host header is not a loopback hostname (127.0.0.1, localhost, [::1]), blocking malicious websites from driving a victim's browser at the local server via rebound DNS.
- Added Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Resource-Policy: same-origin and X-Permitted-Cross-Domain-Policies: none response headers.
- The HTML report builders now emit a Content-Security-Policy meta tag (default-src 'none'; img-src data:; style-src 'unsafe-inline') so no script can execute in a downloaded or shared report document. Review finding: the report download functions are currently not wired to any UI control (the in-browser rule report replaced them), so they are tree-shaken from the shipped bundle; the CSP protects them if reinstated.
- pdf.js document loading sets isEvalSupported: false, closing the font/PostScript eval path (CVE-2024-4367 class) as defense in depth for untrusted PDF uploads.
- Review confirmed: path-traversal containment (plain, percent-encoded and backslash vectors all serve the app shell), GET/HEAD-only methods, comprehensive HTML escaping in all three report builders, no dangerouslySetInnerHTML, guarded JSON parsing of pasted payloads, and npm audit --omit=dev reporting 0 production vulnerabilities. Two moderate advisories remain in dev-only tooling (esbuild via Vite 5 dev server); they do not affect the shipped app and the pinned-dependency policy defers the breaking Vite major bump.

v1.7.3 - input preprocessing (issue #7)
---------------------------------------
- Auto-orientation: rotated or upside-down uploads are detected from decoded barcode symbol orientation and corrected before validation. Each rotation candidate is verified by re-decoding a downscaled probe before the full-resolution page is rotated.
- Multi-label sheets: pages larger than any single label format (A4 and up) are scanned for white gutters; each detected label region is cropped with a small margin and audited as an individual label with proportional physical dimensions. Aspect-ratio and ink-share guards prevent single labels from being split.
- Rotated or segmented PDF pages fall back to per-label OCR because the page-level PDF text layer cannot be trusted after those transforms.
- New tests/smoke-preprocess.mjs covers orientation selection and segmentation; verified against rotated and composited real label samples.

v1.7.2 - image input guidance and rule review corrections (issues #2-#6)
------------------------------------------------------------------------
- Low-resolution raster uploads now produce an explicit warning (EP-IMG-01 / ST-IMG-01) with estimated DPI and guidance to upload the original PDF or a 300 DPI export, instead of opaque decode failures.
- Visible article ID extraction tightened against watermark interference; visible-text vs barcode mismatches report as manual review rather than hard fails (issue #4).
- ST-FRT-04 added: validates the freight barcode character structure implied by the Code 128 B/C/B/C compression pattern (issue #5).
- SSCC parsing anchored to the start of the payload so zero-padded digit runs inside StarTrack QR data can no longer produce false SSCC check-digit failures (issue #6).
- StarTrack unit-type map confirmed spec-exact against MOS v9 Appendix A.
- App version is injected from package.json at build time, so the page version always matches the release (issue #3).

v1.7.1 - JSON rule sets and rule-by-rule report
-----------------------------------------------
- Validation rules externalised to declarative JSON rule sets under rules/ (eParcel and StarTrack, base plus per-product variants) evaluated by a generic rule engine.
- New report UI shows each rule with its input data, plain-English logic, expandable JSON definition, and outcome; tags are reserved for failures and review items.
- Spec-derived audit checklists added under docs/checklists/ for both carriers.
- Prebuilt dist/ committed so the target environment only needs node server.mjs.

---

BarcodeAuditer v1.7.0 Release Notes
===================================

Release focus
-------------
This release introduces the explicit audit mode workflow for eParcel and StarTrack label review while preserving the security hardening delivered in the v1.6.8 and v1.6.9 release line.

Security assurance
------------------
- Preserves the local-only desktop wrapper security design.
- The local server continues to bind to 127.0.0.1 only.
- No administrator install, Windows service, registry write, Program Files write, external API call, or telemetry path is introduced.
- Security headers remain enabled in server.mjs:
  - X-Content-Type-Options: nosniff.
  - X-Frame-Options: DENY.
  - Referrer-Policy: no-referrer.
  - Restrictive Permissions-Policy.
  - Restrictive Content-Security-Policy.
- The Content-Security-Policy remains locked down with a targeted wasm-unsafe-eval allowance for ZXing barcode decoding compatibility.
- Runtime safety limits remain in place for batch file count, label file size, PDF pages, image pixel count, and optional payload size.
- Temporary object URLs are still revoked after image decode.
- npm.cmd audit --omit=dev was checked before this release draft and reported 0 production vulnerabilities.

UI and audit workflow updates
-----------------------------
- Adds explicit audit mode controls for eParcel and StarTrack.
- Adds explicit label format controls for Standard article format and SSCC article identifier.
- Replaces the old carrier-specific upload boxes with one compact upload/drop zone.
- Wrong carrier or format selection now fails the audit mode check while still running the full report.
- Adds optional SSCC extension digit and GS1 company prefix inputs for SSCC account validation.
- Keeps raw barcode data visible in the audit detail.
- Keeps the collapsible JSON payload evidence for later review.
- Improves the report table around required fields, decoded values, Get Shipments values, and result state.
- Retains the existing cropped barcode preview placement and right-side audit report layout.

Barcode evidence updates
------------------------
- Fixes additional barcode classification so required StarTrack QR/DataMatrix content is not incorrectly flagged as an internal barcode.
- Additional decoded barcodes are retained as evidence only and are not used to satisfy required checks.
- The additional barcode section now appears only when decoded barcode count exceeds the selected specification expectation:
  - StarTrack: more than 3 decoded barcodes.
  - eParcel: more than 2 decoded barcodes.

Known review limits
-------------------
Some checks still require external data or physical measurement and remain review-context rather than fully automated pass/fail:
- StarTrack Location Master File depot/port validation.
- Barcode verifier grade.
- Quiet-zone, bar-width and print-grade measurement from a real thermal label.
- Physical label stock colour, gloss, and printer calibration.

Verification completed for release pack
---------------------------------------
- npm.cmd audit --omit=dev: 0 production vulnerabilities.
- npm.cmd run build: passed.
- build-portable-release.bat: passed.
- Portable ZIP: release\BarcodeAuditer-v1.7.0-windows-x64-portable.zip.
- SHA256: 2B09BC1D6069D74823FE8B986A5E1A18DCCF4B444BDE2BEE2B603090700B87D8.
