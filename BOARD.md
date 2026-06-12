# Board — BarcodeAuditer

Curated lane plan for the Mission Control board (mission-control repo).
Tag items with #security #feature #marketing #logging #infra for colored chips.

## Planned - future build requirements
- [ ] Capture the next batch of build requirements here #feature

## Done — senior review readiness (shipped as v1.7.6)
One commit per item. Source: review-prep assessment 2026-06-12.
- [x] R01 README corrections: drop stale TypeScript + HTML-report-export claims, refresh project file map #infra
- [x] R02 Pin GitHub Actions to commit SHAs (supply-chain hardening) #security
- [x] R03 Adversarial input hardening + tests: fixed quadratic regex backtracking (line caps) and a payload deep-nesting stack overflow (iterative flatten); hostile markup, ReDoS and payload tests #security
- [x] R04 Threat model + data-handling statement (docs/security/threat-model.md) #security
- [x] R05 security-assessment-v1.7.6.md with disposition of every v1.6.8 finding #security
- [x] R06 SBOM: npm run sbom script + committed CycloneDX for the release #security
- [x] R07 Resources/ example-label PII sweep: synthetic throughout; flagged PP.pdf recipient name + EXP.pdf mobile number for owner confirmation #security
- [x] R08 Close out: version 1.7.6 + release notes + rebuilt dist #infra
- [x] Bonus: launcher PowerShell ExecutionPolicy bypass removed (curl.exe health checks); S12 regex regression fixed (first CI failure) #security

Out of scope for the repo (owner decisions): code-signing the launcher EXE,
repo visibility / carrier-spec redistribution rights confirmation.

## Done — coding standards uplift (shipped as v1.7.5)
One commit per item. Source: code-standards evaluation 2026-06-12.

### P1 — Tooling
- [x] S01 Add .gitattributes, normalize line endings (index was already LF-clean) #infra
- [x] S02 Add ESLint flat config + npm run lint; remove orphan eslint-disable #infra
- [x] S03 Add Prettier, format src/tests/server.mjs once #infra
- [x] S04 GitHub Actions CI: test + build + dist-drift gate #infra
- [x] S05 package.json engines field (Node >= 20.10) + README note #infra

### P2 — Structure
- [x] S06 Split main.jsx scanner/canvas/pipeline code into src/scanner/ modules #infra
- [x] S07 Split auditEngine.js into parser/ruleFunction/payload modules behind a facade #infra
- [x] S08 App component: consolidate workflow state with useReducer (panel extraction deferred - component is readable at current size) #feature

### P3 — Consistency
- [x] S09 Stable React keys in barcode/QR list renders #feature
- [x] S10 Route stray console.* through gated debug logging #logging
- [x] S11 Name remaining magic numbers in the scan pipeline #infra
- [x] S12 Single-source the AU state list shared by auditEngine and rule JSON #infra
- [x] S13 JSDoc all exported functions (ts-check deferred: needs a tsc-verified annotation pass to be honest) #infra

### P4 — Hygiene
- [x] S14 server.mjs: drop sync fs calls from the request path #infra
- [x] S15 README dependency assessment covers tesseract.js; note security-doc drift #security
- [x] S16 Migrate smoke tests to node:test runner (zero new deps) #infra
- [x] S17 Close out: version bump + release notes + rebuilt dist #infra

## Done
- [x] JSON rule sets + rule-by-rule report UI (v1.7.1) #feature
- [x] Issues #2-#6: DPI guidance, article extraction, compression rule, SSCC fixes (v1.7.2) #feature
- [x] Issue #7: auto-orientation + multi-label segmentation (v1.7.3) #feature
- [x] Security hardening: DNS rebinding, COOP/CORP, pdf.js eval off, report CSP (v1.7.4) #security
- [x] Dead code removal: 493 lines of unreachable export/report code #infra
