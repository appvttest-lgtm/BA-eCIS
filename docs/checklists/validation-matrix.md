# Validation matrix — intended checklist by label type

This is the captured **intended** validation checklist for the four auditable label types, by
barcode element. It is the human-readable companion to the machine-readable source of truth,
[`intended-checklist.json`](intended-checklist.json).

**Compare intended vs actual:** run `npm run checklist` (or `npm run checklist -- --json` to write
[`coverage-report.json`](coverage-report.json)). The script loads the live rule sets in `/rules`,
diffs them against the intended manifest, and reports `implemented / partial / gap` per label type.
CI fails if the engine ships a rule the manifest doesn't declare, so this checklist cannot silently
drift behind the code.

**Conventions:** `M` mandatory · `C` conditional · `A` advisory · `O` optional. Entries are
`RULE-ID — criterion`. "—" = not applicable. Two audit-mode checks run for *every* label and sit
above the matrix: `AUDIT_MODE_CARRIER` and `AUDIT_MODE_FORMAT` (selected carrier/format vs decoded
evidence). "Standard" columns are the union of their product variants (Parcel Post / Express Post /
Returns / Metro; Premium / Express / FPP); variant-only rules are noted inline.

| Barcode element | eParcel Standard | eParcel SSCC | StarTrack Standard | StarTrack SSCC |
|---|---|---|---|---|
| **GS1-128 linear article** | `EP-LIN-01` decoded · `EP-LIN-07` AI(01)=`0199312650999998` · `EP-LIN-08` AI(91) present · `EP-LIN-09` linear=DataMatrix article · `EP-ART-01..05` ID/MLID/serial/count/postage-paid · `EP-ART-06` check digit · `EP-ART-07/08` visible=barcode · `EP-SVC-01/02/03` service/product known+compatible · `EP-SVC-07` product in audited family · *Returns:* `EP-RET-01/02` | `EP-LIN-01` decoded · `EP-ART-01` parse *(article/product structure suppressed for SSCC)* | — | — |
| **GS1 DataMatrix (2D)** | `EP-DM-01` decoded · `EP-DM-04` no literal FNC1 · `EP-DM-05` AI(420) postcode · `EP-TO-08` AI(420)=TO postcode · `EP-DM-06`/`-NA` AI(92) DPID · `EP-DM-07` AI(8008) datetime | same as eParcel Standard | — | — |
| **AI (00) SSCC barcode** | — *(Returns: `EP-RET-03` SSCC not permitted)* | `EP-SS-01` decoded · `EP-SS-02` check digit · `EP-SS-05` embedded checks suppressed · `SSCC_EXPECTED_*` prefix match | — | `ST-SSC-01` decoded · `ST-SSC-02` check digit · `ST-SSC-06` despatch-only · `ST-SSC-07` product from QR/routing · `ST_SSCC_EXPECTED_*` |
| **StarTrack freight item (Code 128)** | — | — | `ST-FRT-01` decoded · `ST-FRT-02A/B/C` despatch ID/connote seq/item seq · `ST-FRT-03` product known · `ST-FRT-04` B/C structure · `ST-FRT-08` visible connote=barcode · `ST-FRT-09` 61-bar evidence · `ST-PRD-01` product in audited family | — *(no freight item barcode on SSCC labels)* |
| **StarTrack routing barcode** | — | — | `ST-RTE-01` decoded · `ST-RTE-02A/B` label code/postcode · `ST-RTE-03` routing↔product · `ST-RTE-04` postcode=QR · `ST-RTE-09` B/C structure · `ST-LOC-01`/`ST-LOC-02` location codes (Premium/Express) | `ST-RTE-01/02A/02B/03/04/09` (GS1-421 form exempt from `ST-RTE-09`) |
| **StarTrack ATL barcode** (conditional) | — | — | `ST-ATL-EXPECTED` present when ATL applies · `ST-ATL-01` counter ≥1 · `ST-ATL-05` =QR/visible · `ST-ATL-06` `C`+9 structure | same as StarTrack Standard |
| **StarTrack 2D QR** | — | — | `ST-QR-01` decoded · `ST-QR-03` length ≥290 · `ST-QR-MAND` aggregate · `ST-QR-F01..F24` field-by-field (suburb, postcode, connote, freight item, product, payer/sender, qty, weight, cube, date, name, unit, depot, address, phone, DG, movement, book-in, ATL, RA) · `ST-PRD-02` product in family · `ST-X-01/02` QR=freight · *FPP:* `ST-FPP-01` | same, **minus** `ST-QR-F04`, `ST-X-01`, `ST-X-02` (no freight item barcode to cross-check) |
| **Text & visible-content** | `TEXT_EXTRACTED` · `LABEL_TYPE` · `VISIBLE_ARTICLE_ID` · `VISIBLE_CONS_NO` · `WEIGHT_PRESENT` · `EP-LAY-01` size · `EP-LAY-05(-PP)` branding · `EP-LAY-06` gen date · `EP-LAY-07` DG decl · `EP-TO-01/06` TO block · `EP-FR-01/05` FROM block · `EP-IMG-01` resolution | same, minus header-branding rule | `ST_TEXT_EXTRACTED` · `ST-LAY-01` dimensions · `ST-HDR-01/02/04` logo/code/connote · `ST-HDR-06` return/transfer · `ST-RCV-01` receiver · `ST-SND-01` sender · `ST-ITM-04/05` weight/cube · `ST-IMG-01` resolution | same as StarTrack Standard |

## Known gaps (intended but not implemented)

Run `npm run checklist` for the live list. As at the last sync the gaps fall into:

- **Physical / print geometry** (verifier/MANUAL): symbol dimensions, quiet zones, QR 26 mm + EC level L, ANSI/Axicon grades — `EP-LIN-02/03/04`, `EP-DM-02/03`, `ST-FRT-05/06`, `ST-RTE-07/08`, `ST-ATL-04`, `ST-QR-02`, all `*-PHY-*`.
- **Colour / stock / font / position**: `EP-LAY-02/03`, `EP-TO-02..05`, `EP-FR-02..04`, `ST-LAY-03`, `ST-HDR-03`.
- **Location Master File**: depot/port validity, NZ/intl location codes — `ST-RTE-05`, `ST-LOC-03..06`, `ST-CON-06`.
- **NZ / International flows**: `ST-RCV-04/05`, `EP-INT-01`.
- **Numbering / consolidation / batch**: `ST-CON-02/04/05`, `EP-ART-09`.
- **Remaining cross-checks**: `ST-X-05/06/07`, and the visible-text legs of `ST-X-03/04`, `EP-DM-08`.

See [`startrack-label-audit-checklist.md`](startrack-label-audit-checklist.md) and
[`eparcel-label-audit-checklist.md`](eparcel-label-audit-checklist.md) for the full per-requirement
spec references; the `intended-checklist.json` manifest is authoritative for `implementedBy` mappings.
