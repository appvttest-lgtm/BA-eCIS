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
6. Results are shown on-screen with full-label previews, barcode crop evidence, pass/fail tables and a rule-by-rule report pane.

The report uses a command-rail layout: a sticky left sidebar carries the overall PASS/REVIEW/FAIL verdict with rule counters, a file navigator for multi-label uploads (article number, detected consignment ID and shipping service per label), section navigation with status dots, and the needs-review bookmarks; a "New audit" button opens the upload panel in a dismissable overlay that keeps the current report until a new label is processed. Each decoded barcode renders as its raw string colour-segmented by field, with a QR-style field table beneath it: one expandable line per field with a colour swatch matched to the raw string, the field's specification, its raw value and a pass/review/fail status icon (char position and length in the expandable drawer). Structured payloads break down to the element level — for example an eParcel GS1-128 splits into AI 01 GTIN and the AI 91 article, and the article itself into MLID, consignment serial, article count, product code, service code, postage-paid indicator and check digit, plus any trailing AusPost AIs (420 postcode, 92 DPID, 8008 date/time). Field statuses re-use the audit engine's own reference maps and check-digit functions; rule verdicts stay with the rule tables. Every rule field carries a provenance badge marking whether its value came from a decoded barcode/QR, visible text/OCR, or was derived, and each barcode value has a one-click copy control.

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

> **Note (v1.12.4):** the "Additional provided data" inputs (Get Shipments payload and SSCC extension/prefix) are temporarily greyed out in the upload screen while the comparison logic is reviewed. The code paths remain in place and re-enable by removing the disabled state.

## Key Libraries

- `React` and `React DOM` for the single-page application UI
- `Vite` for local development and production builds
- `pdfjs-dist` for browser-based PDF rendering
- `@zxing/library` and `zxing-wasm` for barcode decoding workflows
- `tesseract.js` for in-browser OCR of visible label text
- Node.js built-in modules in `server.mjs` for the lightweight local static server

## Local Runtime

The prebuilt app is committed in the `dist/` folder, so no client-side build, batch file or script is required. With Node.js installed (**Node 20.10 or later** — the rule-set loader uses `with { type: 'json' }` import attributes), clone or download the repository and run:

```bash
node server.mjs
```

`server.mjs` serves the committed `dist/` build directly. After changing anything under `src/` or `rules/`, regenerate the committed build with `npm run build` before committing.

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
- pdfjs-dist version 4.10.38 has no known direct vulnerabilities and is well above the patched threshold for the critical CVE-2024-4367 arbitrary code execution vulnerability.
- @zxing/library version 0.21.3 has no known direct vulnerabilities; the project is in maintenance mode, but this specific version has no reported CVEs.
- react and react-dom version 18.3.1 have no known direct vulnerabilities and are unaffected by the critical CVE-2025-55182 ("React2Shell") because the application does not use React Server Components.
- vite version 5.4.21 is mitigated (patched) and successfully fixes the important security advisory CVE-2025-62522 related to directory traversal bypass.
- zxing-wasm version 3.0.3 has no known direct vulnerabilities, with no issues found in the direct dependency or Snyk database for this version.
- tesseract.js version 7.0.0 and @tesseract.js-data/eng version 1.0.0 (in-browser OCR engine and English training data, both pinned exact and served from local assets) have no known direct vulnerabilities.
- Development-only tooling (eslint, prettier and plugins, pinned exact) never ships in dist/. Two moderate advisories exist in Vite 5's dev-server esbuild; they affect npm run dev only and the fix is deferred because it requires a breaking Vite major upgrade (see release notes v1.7.4).
- A CycloneDX SBOM covering the full build-time dependency tree is committed at `docs/security/sbom.cyclonedx.json` and regenerated each release with `npm run sbom`.

## Rule Sets

Validation rules are declarative JSON files under `rules/`, derived from the two carrier specifications and the checklists in `docs/checklists/`. Each carrier has a base file plus per-product variant files that extend it:

- `rules/eparcel/` - `base.json`, `parcel-post.json`, `express-post.json`, `returns.json`, `sscc.json`
- `rules/startrack/` - `base.json`, `express.json`, `premium.json`, `fpp.json`, `sscc.json`

`src/ruleEngine.js` is the generic evaluator: it merges a variant over its base, resolves rule inputs against the evidence extracted from the label (page geometry, text layer, decoded barcodes), applies the declarative asserts (regex, equality, ranges, date formats, cross-field comparisons) and named functions for algorithmic checks (check digits, service/product matrix). Every result carries the rule definition, the input data and the outcome so the report can show all three side by side. The audit engine selects the variant automatically from the decoded product codes and the selected audit mode.

Run `npm test` for the rule-set and end-to-end audit smoke tests.

## Project Files

- `src/main.jsx` - React UI, upload flow and audit orchestration
- `src/auditEngine.js` - barcode parsing, evidence extraction and rule-set selection (facade over `src/audit/`)
- `src/audit/` - carrier reference data and identity-gated Get Shipments payload comparison
- `src/scanner/` - decode engines, canvas utilities, label preview images and the file-processing pipeline
- `src/preprocess.js` - input preprocessing: orientation normalization and multi-label sheet segmentation
- `src/ocrText.js` - OCR text extraction for visible-text checks
- `src/ruleEngine.js` - generic evaluator for the declarative JSON rule sets
- `src/reportView.jsx` - rule-by-rule report rows with input data, rule logic and outcome panes
- `rules/` - executable JSON rule sets per carrier and product family
- `docs/checklists/` - spec-derived audit checklists that the rule sets implement
- `src/styles.css` - application and report styling
- `server.mjs` - local static server for the built app
- `start-auditer.bat` - end-user launcher
- `tests/` - node smoke tests for the rule engine and audit pipeline
- `Resources/` - reference PDFs and example labels used when checking audit behaviour

## Known Limits

This tool assists with digital label validation. It does not replace formal Australia Post or StarTrack certification, physical barcode verifier grading, thermal printer calibration, calibrated quiet-zone measurement, label stock checks or production print testing.
