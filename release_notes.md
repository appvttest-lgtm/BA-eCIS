
BarcodeAuditer v1.7.5 Release Notes
===================================

Release focus
-------------
The v1.7.1 to v1.7.6 line replaces hard-coded validation logic with external JSON rule sets, adds a rule-by-rule report UI, introduces input preprocessing for rotated and multi-label uploads, and hardens the local server, the launcher and all attacker-controlled input paths. The local-only security design is unchanged.

v1.7.8 - freight barcode bar count (compression evidence)
---------------------------------------------------------
A Code 128 symbol's bar count is fixed by its encodation: the 20-character StarTrack freight item barcode with the mandated Code B/C compression always prints exactly 61 bars (19 symbol characters x 3 bars + 4 stop bars), while an uncompressed all-Code-B symbol prints 70. This is the first symbol-level compression check - the v1.7.7 rules validate the decoded text, which is identical either way.
- The scan pipeline now measures the bar count of every decoded Code 128 symbol from three scanlines across its bounding box (median, with contrast and agreement guards; unreliable measurements are discarded rather than guessed).
- New rule ST-FRT-09 compares the measured count against 61. Per the warning-only design: a mismatch reports a WARNING for manual verification, never a label fail, because image quality affects the count. Labels where no reliable count could be measured skip the check silently.
- Verified against generated symbols: the compressed freight value measures exactly 61 bars (routing 40, ATL 31 for reference).
- 9 new tests (106 total) covering the pure scanline counter, warning-not-fail behavior, skip-when-unmeasured and the end-to-end ride from detected barcode to rule result.

v1.7.7 - compression rules for all StarTrack Code 128 barcodes (issue #8)
-------------------------------------------------------------------------
MOS v9 defines a Code B/C compression pattern for every StarTrack Code 128 barcode, but only the freight item barcode was checked (ST-FRT-04). Two new rules close the gap:
- ST-RTE-09: routing barcode compression (3 chars Code B label code + 4 Code C postcode + remaining Code B depot/port). The GS1 421 routing form used on SSCC labels has its own structure and is exempt.
- ST-ATL-06: ATL barcode compression (2 chars Code B + 8 Code C, i.e. literal C + 9 digits).
- The SSCC barcode's pure-Code-C requirement was already enforced by the digits-only SSCC format rules.
As with ST-FRT-04, the rules assert the character-class consequence of the subset pattern visible after decoding; physical subset switching inside the symbol still needs a print-time verifier. Checklist rows ST-RTE-09 and ST-ATL-06 added (and the stale ST-RTE-04 row corrected); 7 new tests (97 total).

v1.7.6 - senior review readiness
--------------------------------
Prepares the repository for senior application and security review (board items R01-R08 in BOARD.md):
- Adversarial input hardening, found by probing and fixed: extracted-text lines are now capped in length and count (the postcode regex backtracked quadratically - a crafted 40k-character line took about a second); pasted payload flattening is iterative with a 20k-entry cap (a JSON payload nested 5k deep previously crashed with an uncaught RangeError). Both behaviors are pinned by the new tests/adversarial.test.mjs (90 tests total).
- Fixed an S12 regression where the dangerous-goods prefix-stripping regex lost its escape characters when converted to a template string; this was also the cause of the first CI failure on main.
- start-auditer.bat no longer invokes PowerShell with -ExecutionPolicy Bypass: health checks use curl.exe (Windows 10 1803+) with a plain batch retry loop, and the stale hardcoded version banner is gone.
- Supply chain: GitHub Actions pinned to commit SHAs; a CycloneDX SBOM for the full build-time tree is committed at docs/security/sbom.cyclonedx.json and regenerated each release via npm run sbom.
- Documentation: docs/security/threat-model.md (data flow, trust boundaries, data-handling statement, accepted risks) and security-assessment-v1.7.6.md with a disposition of every v1.6.8 finding. README corrections: stale TypeScript and HTML-report-export claims removed, project file map updated to the current module layout.
- Resources/ example labels swept for customer data: synthetic test data throughout; two low-risk items flagged for owner confirmation (a real-looking recipient name in PP.pdf and a mobile number in EXP.pdf, both consistent with internal test accounts).

v1.7.5 - coding standards uplift
--------------------------------
No behavior changes for end users; this release is engineering hygiene (board items S01-S17 in BOARD.md):
- Tooling: ESLint flat config + Prettier (one-time format), .gitattributes line-ending policy, GitHub Actions CI with lint/format/test/build and a dist-drift gate enforcing the committed-build rule, and an engines requirement of Node 20.10+.
- Structure: main.jsx split into src/scanner/ modules (canvas utils, decode engines, label preview images, file pipeline); auditEngine's reference data and identity-gated payload comparison moved to src/audit/; App workflow state consolidated into a single reducer.
- Consistency: stable React list keys, gated scanner debug logging, named tuning constants, the AU state list single-sourced between rule JSON and text extraction ({{constant}} template support in the rule engine), and JSDoc on all exported functions.
- Hygiene: async-only file serving in server.mjs, README dependency assessment refreshed (stale TypeScript entries removed; tesseract.js 7.0.0 and @tesseract.js-data/eng 1.0.0 documented and pinned exact), and the smoke tests migrated to the built-in node:test runner (80 tests, including a previously unwired parser test file).

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
