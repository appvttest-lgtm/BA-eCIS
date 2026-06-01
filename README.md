# eCommerce Integration S Label Auditor

A local-only web application for auditing Australia Post eParcel and StarTrack digital label output. It is intended for integration, QA, and implementation teams who need to check that generated labels contain the expected barcode data, visible text, service indicators, article or freight identifiers, routing details, and optional Get Shipments payload alignment.

The app runs on the user's workstation and is not a hosted SaaS product.

## Purpose

The auditor helps validate digital shipping labels before production use. It gives teams a repeatable way to inspect PDF or image labels, decode their barcodes, compare the decoded values against known eParcel and StarTrack label rules, and export evidence for review.

It supports separate upload paths for:

- eParcel, Parcel Post, Express Post and fixed-price premium labels
- StarTrack labels

Keeping the upload paths separate ensures the correct audit rule set is applied and avoids accidentally evaluating StarTrack labels with eParcel rules, or the reverse.

## How It Works

1. The user uploads one or more PDF or image labels into the correct carrier section.
2. The app renders each page or image locally in the browser.
3. Barcode scanners attempt to decode all visible barcode regions.
4. Decoded values are classified against the expected eParcel or StarTrack barcode specifications.
5. The audit engine applies format, identity, routing, product/service, visible-text and optional payload comparison checks.
6. Results are shown on-screen with full-label previews, barcode crop evidence, pass/fail tables and downloadable HTML reports.

## Audit Logic

### eParcel

The eParcel audit path focuses on Australia Post Parcel Post, Express Post and related eParcel label formats. Current checks include:

- GS1 DataMatrix and GS1-128 / Code 128 barcode decoding
- Article ID parsing and check digit validation where applicable
- Product and service code extraction
- Product/service matrix validation
- SSCC detection and SSCC-specific handling
- Delivery postcode, DPID, date/time, weight and Dangerous Goods context where available
- Visible article ID, consignment, sender and receiver text checks
- Optional Get Shipments payload comparison gated by matching identity fields

When an SSCC label is detected, the app avoids requiring product/service barcode fields that are not encoded in that label type and instead focuses on SSCC, readability and visible evidence.

### StarTrack

The StarTrack audit path treats each expected barcode role separately:

- 2D QR barcode for fixed-width shipment data
- Routing barcode for route, product and destination information
- Freight item barcode for the primary freight item or consignment identity
- ATL barcode for Authority to Leave references in the `C999999999` format
- SSCC barcode evidence where SSCC-based labels are used

The StarTrack logic validates decoded barcode content against known role-specific formats, including routing-prefix expectations and ATL barcode rules. QR payload fields are used as structured evidence where they can be decoded.

### Payload Comparison

Users can optionally paste a Get Shipments API response or relevant JSON/plain-text excerpt. Payload comparison is identity-gated: the payload must first match the uploaded label using fields such as article ID, freight item ID, SSCC, consignment ID or connote ID. If the identity does not match, secondary comparisons are reported as not applicable rather than creating false matches.

## Key Libraries

- `React` and `React DOM` for the single-page application UI
- `Vite` for local development and production builds
- `pdfjs-dist` for browser-based PDF rendering
- `@zxing/library` and `zxing-wasm` for barcode decoding workflows
- `TypeScript`, currently included as a project dependency for tooling compatibility
- Node.js built-in modules in `server.mjs` for the lightweight local static server

## Local Runtime

Normal users can start the packaged app with:

```bat
start-auditer.bat
```

The local app is served at:

```text
http://127.0.0.1:3000
```

Developer commands:

```bash
npm run dev
npm run build
npm start
npm run preview
```

The local HTTP server is used so browser modules, PDF workers, WebAssembly assets and static paths behave consistently. It serves the built app from `dist/` and exposes a small health check.

## Security Summary

- Labels are processed locally in the browser.
- The local server binds to localhost by default.
- The app does not upload labels to a remote service by design.
- The app does not use a database or store server-side label files.
- No admin rights, Windows service, Docker, WSL or registry changes are required.
- Uploaded labels and generated reports can contain customer names, addresses, article IDs, SSCC values, account references and barcode data, so reports should be handled as internal/customer data.

## Dependency Vulnerability Assessment
Package	Version	Vulnerability Status	Critical Notes
pdfjs-dist	4.10.38	No known direct vulnerabilities	Version is well above the patched threshold for the critical CVE-2024-4367 arbitrary code execution vulnerability.
@zxing/library	0.21.3	No known direct vulnerabilities	The project is in maintenance mode, but the specific version has no reported CVEs.
react / react-dom	18.3.1	No known direct vulnerabilities	Unaffected by the critical CVE-2025-55182 ("React2Shell") as the app does not use React Server Components.
vite	5.4.21	Mitigated (Patched)	The version successfully patches an important security advisory (CVE-2025-62522) related to directory traversal bypass.
typescript	5.6.3	No known direct vulnerabilities	The dependency is pinned to an exact version, which is a secure practice.
zxing-wasm	3.0.3	No known direct vulnerabilities	No issues found in the direct dependency or Snyk database for this version.

## Project Files

- `src/main.jsx` - React UI, upload flow, rendering, scan orchestration and report export
- `src/auditEngine.js` - barcode parsing, carrier-specific validation and payload comparison logic
- `src/styles.css` - application and report styling
- `server.mjs` - local static server for the built app
- `start-auditer.bat` - end-user launcher
- `Resources/` - reference PDFs and example labels used when checking audit behaviour

## Known Limits

This tool assists with digital label validation. It does not replace formal Australia Post or StarTrack certification, physical barcode verifier grading, thermal printer calibration, calibrated quiet-zone measurement, label stock checks or production print testing.
