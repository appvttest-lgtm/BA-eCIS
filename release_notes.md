
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
