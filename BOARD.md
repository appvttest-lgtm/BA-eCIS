# Board — BarcodeAuditer

Curated lane plan for the Mission Control board (mission-control repo).
Tag items with #security #feature #marketing #logging #infra for colored chips.

## Planned - future build requirements
- [ ] Capture the next batch of build requirements here #feature

## In progress — coding standards uplift (v1.7.5 line)
One commit per item. Source: code-standards evaluation 2026-06-12.

### P1 — Tooling
- [x] S01 Add .gitattributes, normalize line endings (index was already LF-clean) #infra
- [x] S02 Add ESLint flat config + npm run lint; remove orphan eslint-disable #infra
- [ ] S03 Add Prettier, format src/tests/server.mjs once #infra
- [ ] S04 GitHub Actions CI: test + build + dist-drift gate #infra
- [ ] S05 package.json engines field (Node >= 20.10) + README note #infra

### P2 — Structure
- [ ] S06 Split main.jsx scanner/canvas/pipeline code into src/scanner/ modules #infra
- [ ] S07 Split auditEngine.js into parser/ruleFunction/payload modules behind a facade #infra
- [ ] S08 App component: consolidate workflow state with useReducer, extract panels #feature

### P3 — Consistency
- [ ] S09 Stable React keys in barcode/QR list renders #feature
- [ ] S10 Route stray console.* through gated debug logging #logging
- [ ] S11 Name remaining magic numbers in the scan pipeline #infra
- [ ] S12 Single-source the AU state list shared by auditEngine and rule JSON #infra
- [ ] S13 JSDoc all exported functions; @ts-check pure engine modules (covers type-safety item) #infra

### P4 — Hygiene
- [ ] S14 server.mjs: drop sync fs calls from the request path #infra
- [ ] S15 README dependency assessment covers tesseract.js; note security-doc drift #security
- [ ] S16 Migrate smoke tests to node:test runner (zero new deps) #infra
- [ ] S17 Close out: version bump + release notes + rebuilt dist #infra

## Done
- [x] JSON rule sets + rule-by-rule report UI (v1.7.1) #feature
- [x] Issues #2-#6: DPI guidance, article extraction, compression rule, SSCC fixes (v1.7.2) #feature
- [x] Issue #7: auto-orientation + multi-label segmentation (v1.7.3) #feature
- [x] Security hardening: DNS rebinding, COOP/CORP, pdf.js eval off, report CSP (v1.7.4) #security
- [x] Dead code removal: 493 lines of unreachable export/report code #infra
