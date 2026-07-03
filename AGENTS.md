# AGENTS.md

Guidance for coding agents working in the **eCommerce Integration S Label Auditor**
(BarcodeAuditer) repository.

A **local-only** web application for auditing Australia Post **eParcel** and
**StarTrack** digital shipping labels: barcode decoding, format/identity/routing
validation, visible-text checks, and identity-gated Get Shipments payload comparison.
It runs entirely on the user's workstation — it is **not** a hosted SaaS product and
must stay that way. This project is standalone (no relation to other repos on this
machine).

---

## 1. Critical Rule: `dist/` is COMMITTED

The prebuilt app in `dist/` is committed so end users can run the tool with nothing
but Node installed (`node server.mjs` serves `dist/` directly).

**After ANY change under `src/` or `rules/`, run `npm run build` and commit the
regenerated `dist/` together with the source change.** Otherwise the shipped app
silently diverges from source. This is the most common way to break the repo.

**Bump the version on every shipped change.** Any change that rebuilds `dist/` (i.e. any
`src/` or `rules/` edit) must also increment `version` in `package.json` (patch for
fixes/tweaks, minor for features) and add a matching one-line entry to `release_notes.md`.
The version is injected at build time and renders in the app footer (`Application version
vX.Y.Z`), so it is the user-visible signal that the updated build actually shipped — if the
footer version did not change, the change did not reach the user. Bump first, then
`npm run build` (and `npm run build:portable`) so the footer reflects the new version.
Docs-only changes that do not touch `src/`/`rules/` do not need a bump.

---

## 2. Stack

- **React 18 + Vite 5** single-page app (JSX; ESLint + Prettier for lint/format)
- `pdfjs-dist` — in-browser PDF rendering
- `@zxing/library` + `zxing-wasm` — barcode decoding (GS1 DataMatrix, GS1-128/Code 128, QR)
- `tesseract.js` — OCR for visible-text checks. LSTM_ONLY (OEM 1): only the `*-lstm`
  WASM cores are shipped in `public/tesseract-core/`; never request the legacy engine
  (it will throw). Refresh assets with `npm run sync:ocr` (see `scripts/sync-ocr-assets.mjs`)
- `server.mjs` — minimal Node static server (binds localhost, serves `dist/`)
- `wrapper/windows/` + `build-portable-release.bat` — native Windows launcher and
  portable release packaging; `start-auditer.bat` is the end-user launcher

All processing happens in the browser. No database, no remote upload, no telemetry —
preserve this by design, it is the product's security posture.

---

## 3. Commands

```bash
npm install
npm run dev        # Vite dev server, http://127.0.0.1:5173
npm run build      # production build into dist/  (REQUIRED before committing src/rules changes)
npm test           # node --test: runs every tests/*.test.mjs via the built-in Node test runner
npm run checklist  # diff the intended checklist (docs/checklists/intended-checklist.json) vs the live rule sets; CI-gated, fails on drift
npm run golden:update    # re-capture the golden baselines after an intended outcome change; review the diff
npm run golden:fixtures  # re-seed the synthetic starter fixtures (add -- --force to overwrite)
npm start          # node server.mjs — serves committed dist/ at http://127.0.0.1:3000
```

The golden suite (`tests/golden.test.mjs`, run by `npm test`) snapshots `auditLabel()` outcomes per quadrant under `tests/fixtures/<carrier>-<format>/` so a parser that stops firing or a re-bucketed barcode is caught. Drop a real label's decoded input in as a new `*.input.json` and run `npm run golden:update` to baseline it — see `tests/fixtures/README.md`.

When you add, remove or rename a rule in `/rules`, update `docs/checklists/intended-checklist.json` so `npm run checklist` reports no drift (CI enforces this).

---

## 4. Repository Layout

```text
src/
  main.jsx          # React UI and audit orchestration
  auditEngine.js    # barcode parsing, evidence extraction, rule-set selection (facade for audit/)
  audit/            # referenceData.js (carrier maps) + payloadComparison.js (identity-gated)
  ruleEngine.js     # generic evaluator for the declarative JSON rule sets
  reportView.jsx    # rule-by-rule report rows (rule definition + input data + outcome)
  preprocess.js     # input preprocessing: orientation normalization + multi-label sheet segmentation
  ocrText.js        # OCR text extraction
  scanner/          # decode engines, canvas utils, label preview images, file pipeline
rules/
  index.js
  eparcel/          # base.json + parcel-post / express-post / returns / sscc variants
  startrack/        # base.json + express / premium / fpp / sscc variants
docs/checklists/    # spec-derived audit checklists the rule sets implement
tests/              # node smoke tests + golden-corpus harness (fixtures/ + golden.test.mjs)
Resources/          # reference PDFs and example labels for manual checking
dist/               # COMMITTED production build (see §1)
release/            # packaged releases
```

---

## 5. Audit Logic Rules

The rule sets encode the Australia Post eParcel and StarTrack **carrier
specifications**. Treat them like clinical logic — do not invent or "fix" rules from
intuition.

- Rules are **declarative JSON** under `rules/`: each carrier has a `base.json` plus
  per-product variants that merge over the base. `src/ruleEngine.js` resolves rule
  inputs against extracted evidence (page geometry, text layer, decoded barcodes) and
  applies asserts (regex, equality, ranges, date formats, cross-field comparisons)
  plus named functions for algorithmic checks (check digits, product/service matrix).
- The audit engine selects the variant automatically from decoded product codes and
  the selected audit mode.
- Any rule change must trace back to the carrier spec or the checklists in
  `docs/checklists/` — update the checklist alongside the rule when behavior changes.
- Every result must keep carrying the rule definition, the input data, and the outcome
  so the report can show all three side by side.

Behavior that must be preserved:

- **Separate eParcel vs StarTrack upload paths** — they exist to guarantee the right
  rule set is applied; never merge them or auto-detect across carriers.
- **SSCC handling** — SSCC labels must not be required to carry product/service
  barcode fields they don't encode.
- **Identity-gated payload comparison** — a pasted Get Shipments payload must first
  match the label on identity fields (article ID, freight item ID, SSCC, consignment
  ID, connote ID); on mismatch, secondary comparisons report as *not applicable*,
  never as matches. Identity values come from **decoded barcode data only** — OCR/text
  facts must never arm the identity gate.
- **OCR is one-way** — barcode decode is authoritative for barcode values; OCR/text is
  only ever compared *against* decoded data, never used as a value source.
- **Printed-vs-decoded checks use print-only facts** — StarTrack visible-text rules
  (`text.visible*`, `derived.receiverEvidence`) read the pre-enrichment facts;
  decoded-data backfill must never satisfy a "printed on the label" check.
- **Undetected states stay visible** — gated mandatory rules use `reportWhenSkipped` /
  `onEmpty` so a check whose input is missing emits a manual-review / not-assessed row
  instead of silently vanishing from the report.
- StarTrack barcode roles stay separate: 2D QR, routing, freight item, ATL
  (`C999999999` format), SSCC.
- Check-digit and product/service-matrix validation functions.

Run `npm test` after touching `rules/`, `ruleEngine.js`, or `auditEngine.js`.

---

## 6. Data Sensitivity

Labels and generated reports contain **customer data**: names, addresses, article IDs,
SSCC values, account references.

- Never commit real customer labels, reports, or logs. `Resources/` holds reference
  examples only — keep it that way.
- Never add features that send label data off the machine (uploads, analytics,
  crash reporting with payloads). Local-only is a product requirement.
- Keep `server.mjs` bound to localhost by default.

---

## 7. Releases

- Version lives in `package.json` (`version`), renders in the app footer
  (`Application version vX.Y.Z`), and is documented in `release_notes.md` — update all
  together and bump it on every change (see section 1).
- Per-release security docs follow the existing pattern
  (`security-assessment-vX.Y.Z.md`, `security-release-log-vX.Y.Z.md`).
- Dependency versions are deliberately pinned with documented CVE assessments in
  `README.md` — do not bump dependencies casually; if you do, refresh the
  "Dependency Vulnerability Assessment" section.
- Regenerate the SBOM with every release: `npm run sbom` rewrites
  `docs/security/sbom.cyclonedx.json` from the lockfile.
- Portable Windows release: `build-portable-release.bat` (uses `wrapper/windows/`).
  No admin rights, services, Docker, WSL, or registry changes — keep that true.

---

## 8. Reporting Back

After changes, report:

1. Files changed (source AND whether `dist/` was rebuilt/committed).
2. Which carrier/rule sets are affected.
3. Smoke test results (`npm test`) — do not claim verification without running them.
4. Any checklist (`docs/checklists/`) updates made alongside rule changes.
