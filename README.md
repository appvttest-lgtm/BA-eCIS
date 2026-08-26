# eCommerce Integration Label Auditor

A web app that checks Australia Post **eParcel** and **StarTrack** shipping labels. You upload label files (PDF or image), the app reads the barcodes on them, checks everything against the carrier specifications, and shows a pass/fail report with the evidence for each check.

It runs entirely on your own machine. No label data ever leaves the workstation.

It does not replace formal carrier certification, physical barcode grading, or production print testing — it is a fast digital check before those steps.

---

## How it works, step by step

1. **Upload** — you drop one or more label files into either the eParcel section or the StarTrack section. The two are kept separate so a label is always judged against the right rules.
2. **Render** — each PDF page or image is drawn in the browser. If a label is sideways it gets rotated, and a sheet with several labels on it is cut into individual labels.
3. **Read** — the app scans each label for barcodes (linear, Data Matrix, QR) using three decoders, and runs OCR to read the printed text.
4. **Check** — the audit engine works out which product the label is for (from the codes it just read), loads the matching rule set, and runs every rule: format, check digits, identity, routing, product/service combination, and printed text.
5. **Report** — you get an overall PASS / REVIEW / FAIL verdict, a list per label, and one row per rule. Each row shows the value that was read, the rule it was checked against, and the result. Each barcode is also split into its individual fields so you can see exactly which part passed or failed.

One rule to remember: **the barcode is the source of truth.** Whatever the barcode decodes to is the real value. OCR text is only used to confirm that the printed label agrees with it — never the other way around.

---

## What it checks

| Area | What it does |
| --- | --- |
| Barcode reading | Finds and decodes every barcode on the label: linear, Data Matrix, QR |
| Barcode parsing | Splits raw barcode strings into their fields — GTIN, article ID, SSCC, despatch ID, postcode, DPID, dates |
| Field checks | Each field is checked for position, length, allowed values and check digit, and shown with its own status |
| Rule checks | Regex, equality, ranges, date formats, cross-field comparisons, check-digit maths, product/service matrix |
| Reference data | Built-in tables of eParcel products and services, and StarTrack products, label codes and unit types |
| Evidence | Full-label previews, a cropped image of every barcode, and a badge on every value showing where it came from (barcode, OCR, or derived) |

---

## Supported products and service codes

These tables mirror the app's built-in reference data (`src/audit/referenceData.js`), which every rule check resolves against.

### eParcel products

| Product code | Product |
| --- | --- |
| 00091 | Parcel Post (Non-Signature) |
| 00093 | Parcel Post + Signature |
| 00087 | Express Post (Non-Signature) |
| 00096 | Express Post + Signature |
| 00065 | Parcel Post Return |
| 00068 | Express Post Return |
| 00120 | Metro + Signature |
| 00121 | Metro (Non-Signature) |

### eParcel service codes

| Service code | Service | Valid with products |
| --- | --- | --- |
| 03 | Signature Required | 00093, 00096, 00065, 00068 |
| 08 | Authority To Leave | 00093, 00096, 00065, 00068 |
| 09 | Non-Signature + ATL | 00091, 00087, 00121, 00120 |
| 15 | ATL + Partial Delivery | 00093, 00096 |
| 45 | Partial Delivery Allowed | 00093, 00096, 00121, 00120 |
| 50 | Safe Drop Enabled | 00093, 00096 |
| 51 | Safe Drop + Partial Delivery | 00093, 00096, 00121, 00120 |
| 49 | Wine Delivery – Addressee Only | 00093 |
| 81 | Wine Delivery – Signature | 00093 |
| 82 | Wine Delivery – ATL | 00093 |
| 83 | Wine Delivery – Safe Drop | 00093 |

A label whose service and product codes both decode correctly but are not a valid pair fails the service/product matrix check.

### StarTrack products

| Product code | Product | Group | Routing label code |
| --- | --- | --- | --- |
| EXP | Express | Express services | EXP |
| PRM | Premium | Premium services | PRM |
| FPP | 1, 3 & 5Kg Fixed Price Premium | Premium services | PRM |
| ARL | Airlock | Premium services | ARL |
| FPA | 1, 3 & 5Kg Fixed Price Airlock | Premium services | ARL |
| RET | Express Tail-Lift | Special Services | RET |
| RE2 | Express Tail-Lift 2 man | Special Services | RE2 |
| TSE | Tradeshow Express | Special Services | TSE |
| APT | Premium Tail-Lift | Special Services | APT |

The routing barcode's label code must match the product's expected label code. Unit types (BAG, CTN, ITM, JIF, PAL, SAT, SKI) are checked per product family; TSE and APT labels with unit data surface as manual review because the spec defines their units by arrangement only.

---

## Layout of the repo

```
src/                  The app itself
  main.jsx            React UI: upload flow and audit orchestration
  auditEngine.js      Parses barcodes, gathers evidence, picks the rule set
  ruleEngine.js       Runs the JSON rules (generic — knows nothing about carriers)
  reportView.jsx      The rule-by-rule report (value / rule / result panes)
  preprocess.js       Rotates sideways labels, splits multi-label sheets
  ocrText.js          OCR of the printed label text
  styles.css          All styling
  assets/             Images used in the UI
  audit/
    referenceData.js       Carrier tables: products, services, label codes, unit types
    ruleSource.js          Spec citation line for the report (document title, version, page)
  scanner/
    pipeline.js       File in → pages → labels → decoded barcodes out
    scanPlan.js       Decides which regions to scan and maps coordinates back
    decoders.js       The three decode engines (BarcodeDetector, ZXing-WASM, ZXing-JS)
    labelImages.js    Label previews and per-barcode evidence crops
    canvasUtils.js    Shared canvas and geometry helpers
    barcodeTypes.js   Shared names for barcode kinds
    debugLog.js       Extra logging, off unless you opt in (localStorage 'ba-debug')

rules/                The validation rules — JSON, one folder per carrier
  index.js            Loads rule files and merges each variant over its base
  eparcel/            base, parcel-post, express-post, returns, metro, sscc
  startrack/          base, express, premium, fpp, sscc
                      (base files also hold the documents registry: short source
                      code, e.g. "PP&EP v1.4", → full document title/version/date)

tests/                Node test suite (npm test): rule evaluator, barcode parsers,
                      preprocessing, scan planning, and a rules catalogue lint

scripts/              Build tooling
  build-portable.mjs      Rebuilds portable/ from dist/ (the pre-commit hook runs this)
  sync-ocr-assets.mjs     Re-copies OCR runtime files from node_modules after an upgrade

public/               OCR runtime files bundled into the build (tesseract worker, WASM, language data)
dist/                 The built app — committed on purpose, see note below
portable/             Ready-to-run copy: dist/ + server.mjs + a README (rebuilt on every commit)
share/README.md       End-user "run it with Node" guide, bundled into portable/
Resources/            The carrier spec PDFs and example labels the rules were written from

server.mjs            Small local web server for the built app (npm start → 127.0.0.1:3000)
index.html            Vite entry point
vite.config.js        Build config
start-auditer.bat     Windows launcher: starts the server and opens the browser
run-server.bat        Bare-bones alternative: just runs node server.mjs
.githooks/pre-commit  Rebuilds and stages portable/ on every commit
```

**Why is `dist/` committed?** The machine this tool ships to cannot run a build. It runs the prebuilt app straight from the repo with `node server.mjs`. After changing `src/`, run `npm run build` and commit the regenerated `dist/` with the source change so the two never drift apart.

---

## Commands

```bash
npm install          # once
npm run dev          # dev server with hot reload on 127.0.0.1:5173
npm run build        # build dist/ (commit it together with the source change)
npm start            # serve the built app on 127.0.0.1:3000
npm run build:portable   # rebuild portable/ from dist/
npm run sync:ocr     # re-copy OCR runtime files after a tesseract.js upgrade
npm test             # Node test suite: evaluator, parsers, preprocessing, rules lint
npm run lint         # ESLint over the whole repo
npm run format       # Prettier --write (format:check verifies without writing)
```

Needs Node 20.10 or newer.

---

## What is (and isn't) in the repo

The repo tracks what is needed to build, run, ship and verify the app: the source, the prebuilt `dist/` and `portable/`, this README, the `Resources/` folder of carrier specs and example labels, and (since v1.15.0) the Node test suite in `tests/` plus the ESLint/Prettier configs — so any clone can run `npm test` and `npm run lint` before shipping. Authoring docs, CI pipeline config, release tooling, working notes and generated reports stay on the dev machine and are git-ignored (see `.gitignore`).
