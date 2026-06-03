Australia Post - eCommerce Integration Label Auditor v1.7.0
======================

Purpose
-------
Local-only internal web app for verifying Australia Post eParcel and StarTrack digital label samples.

Input: one or more PDF/image label samples.
Output: tabbed on-screen audit results plus downloadable single-label or consolidated HTML audit reports.

Audit mode selection
--------------------
Before uploading labels, choose the audit mode that matches the label being reviewed:

- Carrier: eParcel or StarTrack.
- Label format: Standard article format or SSCC article identifier.

The selected audit mode determines which specification rule set is applied. If a label is uploaded under the wrong carrier or format toggle, the audit mode check fails while the full report continues so the mismatch can be reviewed.

SSCC validation fields
----------------------
For SSCC labels, the optional extension digit and GS1 company prefix fields can be used to confirm that the decoded SSCC aligns with the expected account details.

If these fields are not provided, the app still performs the normal barcode decode, format, and checksum checks where possible.

Important behaviour in v1.7.0
-----------------------------
This version adds an explicit audit workflow for eParcel and StarTrack labels while preserving the local-only security hardening from the v1.6.8 and v1.6.9 security releases.

Common behaviour:
- Each PDF page or image is audited as an individual label.
- Barcode compliance is based on barcode strings decoded from the uploaded file.
- Visible text is displayed for context and label-content checks, but it is not accepted as a replacement for barcode decoding.
- SSCC / AI 00 labels are detected and treated separately from standard eParcel or StarTrack article formats.
- Raw barcode data and collapsible JSON payload evidence are retained for review.
- Additional decoded barcodes are retained as evidence only and are not used to satisfy required checks.

Australia Post eParcel checks include:
- GS1 DataMatrix barcode decode.
- GS1-128 / Code128 linear barcode decode.
- Standard eParcel article structure, product code, service code and check digit.
- eParcel SSCC handling where product/service is not embedded in the SSCC article identifier.
- Delivery/sender text, weight and Dangerous Goods declaration where extractable.

StarTrack checks include:
- StarTrack 2D QR barcode decode and fixed-width field parsing.
- StarTrack 20-character Code128 freight item barcode parsing.
- StarTrack routing barcode parsing.
- GS1 AI 00 SSCC validation for StarTrack SSCC labels.
- Product-code and label-code reference highlighting.
- Receiver/sender text, weight, unit type and Dangerous Goods indicators where extractable.

Additional/internal barcode handling
------------------------------------
Some labels include internal barcodes below the required article barcode area. These are outside the eParcel and StarTrack specifications and are not subject to validation.

The app only shows the additional barcode evidence section when more decoded barcodes are present than the selected specification requires:

- StarTrack: more than 3 decoded barcodes.
- eParcel: more than 2 decoded barcodes.

Known limits
------------
Some StarTrack rules require external data or physical measurement equipment and are therefore reported as review-context rather than fully automated pass/fail:
- Location Master File depot/port validation.
- Barcode verifier grade.
- Quiet-zone, bar-width and print-grade measurement from a real thermal label.
- Physical stock colour, gloss and printer calibration.

Security / UAC Design
---------------------
- Runs as a normal Windows user.
- Does not require administrator privileges.
- Does not install a Windows service.
- Does not modify the Windows registry.
- Does not write to Program Files.
- Does not use Docker or WSL.
- Binds to 127.0.0.1 only by default.
- Uses port 3000 by default.
- Processes files locally.
- Does not send label files to external services.

How to Run Without a BAT File
-----------------------------
1. Extract this ZIP into a normal user-writable folder, such as:
   C:\Users\<you>\Documents\BarcodeAuditer

2. Run BarcodeAuditer.exe, or open Command Prompt/PowerShell in the extracted folder and start the local server:
   node server.mjs

3. Open this address in Microsoft Edge or Chrome:
   http://127.0.0.1:3000

4. Keep the command window open while using the app if you started it with node server.mjs. Close the command window to stop the local server.

Requirements
------------
- Microsoft Edge or Chrome recommended.
- The portable release includes its own Node runtime for BarcodeAuditer.exe.
- If running manually with node server.mjs, Node.js LTS must be installed for the user from the company portal.

First-run / npm note
--------------------
Normal users do not need to run npm install. The ZIP includes the prebuilt dist folder, local server, and launcher runtime.

If a developer changes the React source code, they can run build-dev-only.bat to install npm packages and rebuild the frontend.

Recommended runtime for locked-down Windows machines: the bundled portable runtime, Node.js 20 LTS, or the already-installed Node 21.x if that is what IT provides.
