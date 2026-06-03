Australia Post - eCommerce Integration Label Auditor v1.6.9
======================

Purpose
-------
Local-only internal web app for verifying Australia Post eParcel and StarTrack digital label samples.

Input: one or more PDF/image label samples.
Output: tabbed on-screen audit results plus downloadable single-label or consolidated HTML audit reports.

Carrier-specific upload paths
-----------------------------
Use the red eParcel upload box for Australia Post Parcel Post / Express Post labels.
Use the light-blue StarTrack upload box for StarTrack labels.

The separate upload boxes intentionally avoid guessing which specification applies to the label. The selected upload path determines which audit rule set is used.

Important behaviour in v1.6.6
-----------------------------
This version adds a StarTrack audit path while keeping the existing eParcel audit path.

Common behaviour:
- Each PDF page or image is audited as an individual label.
- Barcode compliance is based on barcode strings decoded from the uploaded file.
- Visible text is displayed for context and label-content checks, but it is not accepted as a replacement for barcode decoding.
- SSCC / AI 00 labels are detected and treated separately from standard eParcel or StarTrack article formats.

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

How to Run Without a BAT File
-----------------------------
1. Extract this ZIP into a normal user-writable folder, such as:
   C:\Users\<you>\Documents\eParcelAuditorLocal

2. Install Node.js from the company portal if it is not already installed.

3. Open Command Prompt or PowerShell in the extracted folder.

4. Start the local server:
   node server.mjs

5. Open this address in Microsoft Edge or Chrome:
   http://127.0.0.1:3000

6. Keep the command window open while using the app. Close the command window to stop the local server.

Requirements
------------
- Node.js LTS installed for the user from the company portal.
- Microsoft Edge or Chrome recommended.

First-run / npm note
--------------------
Normal users do not need to run npm install. The ZIP includes the prebuilt dist folder, and node server.mjs launches a dependency-free local Node server.

If a developer changes the React source code, they can run build-dev-only.bat to install npm packages and rebuild the frontend.

Recommended runtime for locked-down Windows machines: Node.js 20 LTS, or the already-installed Node 21.x if that is what IT provides.
