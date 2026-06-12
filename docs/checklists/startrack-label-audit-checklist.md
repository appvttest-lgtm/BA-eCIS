# StarTrack (Modify Your Own System) Label Audit Checklist

**Source of truth:** *StarTrack Label Specifications — Modify Your Own System (MOS)*, Version 9, 14/10/2020 (`Resources/StarTrackInterface_Version 9.pdf`).

This checklist enumerates every label conformance rule in the specification. Each rule has a stable ID intended to become the `id` of a rule in the executable JSON rule set, and is mapped to the check (if any) that `src/auditEngine.js` performs today. It is the StarTrack baseline for the rule-set uplift and code review. Spec requirement IDs (e.g. `1.004`, `3.001`, `4.002`) are cited where the document defines them.

## Legend

| Column | Values |
| --- | --- |
| **Obligation** | `M` Mandatory · `O` Optional · `COND` Conditional (mandatory when the condition applies) |
| **Audit** | `AUTO` deterministically checkable from the digital label · `PARTIAL` checkable via heuristics (OCR/text layer, raster sampling, geometry) · `MANUAL` physical/print check, present in the report as a manual-review item only |
| **Coverage** | ✅ implemented (engine check ID) · 🟡 partially implemented · ❌ gap · ⛔ documented out-of-scope |

---

## 1. Label formats & stock

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-LAY-01 | Despatch label is 10 cm × 15 cm; an optional extra 5 cm (total 20 cm height) may be added for warehouse use, with the **top** 15 cm reserved for StarTrack content | M | AUTO (page dims) | ✅ `ST_LABEL_SIZE` (accepts 100×150, 100×200, 150×100; "StarTrack content in top 15 cm" not asserted) | 1.001, p19 |
| ST-LAY-02 | Controlled Returns / Transfer Movements label is 15 cm × 10 cm | M | AUTO | ✅ `ST_LABEL_SIZE` (landscape acceptance) | 3.001 |
| ST-LAY-03 | Label stock is white (no colour background) and matt (non-glossy) | M | PARTIAL (raster sampling) / MANUAL (texture) | ❌ gap (background); ⛔ texture | p11, p19, p30 |
| ST-LAY-04 | Printers re-calibrated regularly for print quality | REC | MANUAL | ⛔ physical | p11, p19 |

## 2. Label header

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-HDR-01 | `P-StarTrack` logo on the left side of the header | M | PARTIAL (logo is image; text heuristic) | 🟡 `ST_LOGO_HEADER` (text heuristic only) | 1.002 |
| ST-HDR-02 | 3-character Label Code printed above the logo; Arial Bold 22pt | M | PARTIAL (text) | 🟡 `ST_LABEL_CODE_VISIBLE` (presence; position/font not asserted) | 1.003 |
| ST-HDR-03 | Label Code contrast: Premium products = white text on black; Express/Special Services = black text on white | M | PARTIAL (raster sampling) | ❌ gap | 1.003 |
| ST-HDR-04 | Consignment number centred in the header under a `CONNOTE:` heading, catering for up to 20 characters; Arial Bold 22pt | M | PARTIAL (text) | 🟡 `ST_CONNOTE_VISIBLE` (presence; heading/position/font not asserted) | 1.004 |
| ST-HDR-05 | Right side of header carries the optional ATL section: `AUTHORITY TO LEAVE` heading (Arial Bold 8pt) + ATL barcode, when ATL applies | COND | AUTO (barcode) + PARTIAL (heading) | ✅ `ST_ATL_BARCODE` (expectation-aware) | 1.005 |
| ST-HDR-06 | Returns/Transfers: header centre displays a `*RETURN*` or `*TRANSFER*` indicator; Arial Bold 22pt | M (returns/transfers) | PARTIAL (text) | ❌ gap — could cross-check against QR movement type `C`/`T` | 3.002–3.003 |

## 3. Receiver details

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-RCV-01 | AU domestic: receiver full name, business name, address, suburb, state, postcode beneath the logo; Arial Bold 12pt | M | PARTIAL (text) | ✅ `ST_RECEIVER_BLOCK` (presence; fonts/positions not asserted) | 1.006 |
| ST-RCV-02 | Large-format receiver suburb + postcode repeated at Arial Bold 18pt; phone at 10pt | M | PARTIAL | ❌ gap (not separately asserted) | 1.006 |
| ST-RCV-03 | Suburb truncation rules: after 24 characters (12pt block) / ~14 characters (18pt block) | COND | PARTIAL | ❌ gap | 1.006 |
| ST-RCV-04 | NZ Premium: receiver details beneath the routing barcode; receiver state shown as `NZ` (12pt); city/postcode at 18pt | M (NZ) | PARTIAL | ❌ gap (NZ flow untested) | 1.007 |
| ST-RCV-05 | International outbound: receiver suburb/state/postcode as defined in the Locations Master File | M (intl) | PARTIAL | ❌ gap | 1.008 |

## 4. Receiver location codes (RC / R1 / R2)

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-LOC-01 | Premium (AU domestic): `RC=AU`, `R1=Primary Port`, `R2=Secondary Port` (from LMF); Arial Bold 22pt | M | PARTIAL (text) + AUTO (consistency vs routing barcode/QR depot) | ❌ gap | 1.009 |
| ST-LOC-02 | Express & Special Services (AU domestic): `RC=AU`, `R1=blank`, `R2=Nearest Depot` (from LMF) | M | PARTIAL + AUTO (consistency) | ❌ gap | 1.010 |
| ST-LOC-03 | NZ Premium: `RC=NZ`, `R1=SYD`, `R2=ZNA` | M (NZ) | AUTO (fixed values) | ❌ gap | 1.011.1 |
| ST-LOC-04 | International outbound: `RC=IATA country code`, `R1=blank`, `R2=blank` | M (intl) | PARTIAL | ❌ gap | 1.011.2 |
| ST-LOC-05 | Home Delivery products: delivery window `12-3` or `N-W` displayed, white on black, Arial Bold 16pt; blank for all other products | COND | PARTIAL | ❌ gap | 1.012 |
| ST-LOC-06 | Route field left blank (reserved); Arial Bold 10pt | M | PARTIAL | ❌ gap (informational) | 1.013 |

## 5. Sender details, references & delivery instructions

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-SND-01 | Sender name, phone, address/suburb/postcode beneath the routing barcode; Arial 7pt; sender IATA country code `AU` when destined overseas | M | PARTIAL (text) | ✅ `ST_SENDER_BLOCK` (presence) | 1.016 |
| ST-SND-02 | Up to three custom sender references; Calibri Bold 7pt | O | PARTIAL | ❌ gap (informational) | 1.017 |
| ST-INS-01 | Special delivery instructions displayed beneath sender references | COND | PARTIAL | ❌ gap | 1.018 |
| ST-INS-02 | Book-in dates printed only when provided, in format `BOOK IN NOT BEFORE: DD/MM/YY, NOT AFTER: DD/MM/YY`; Arial Bold 7pt | COND | PARTIAL (text format) + AUTO (consistency vs QR fields 21/22) | ❌ gap | 1.019 |
| ST-INS-03 | Deliver-on-date (commercial agreement) printed in the book-in section as `DELIVER ON DATE: DD/MM/YY` | COND | PARTIAL | ❌ gap | 1.020 |

## 6. Item details block

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-ITM-01 | Label print date under heading `DATE`, format `DD/MM/YYYY`; Arial Bold 7pt | M | PARTIAL (text) | ❌ gap | 1.021 |
| ST-ITM-02 | 3-character article unit type under heading `UNIT` | M | PARTIAL + AUTO (vs QR field 14) | 🟡 unit type validated from QR (`ST_QR_UNIT`); visible text not cross-checked | 1.021 |
| ST-ITM-03 | Article count shown as `ITEM 1 OF 2` (item N of consignment quantity) | M | PARTIAL + AUTO (vs QR fields 4/8) | ❌ gap | 1.021 |
| ST-ITM-04 | Consignment weight (kg) under heading `WEIGHT` | M | PARTIAL | 🟡 `ST_WEIGHT_PRESENT` (presence; not cross-checked vs QR field 9) | 1.021 |
| ST-ITM-05 | Consignment cubic volume (m³) under heading `CUBE` | M | PARTIAL | 🟡 `ST_CUBE_PRESENT` (presence; not cross-checked vs QR field 10) | 1.021 |

## 7. Freight item barcode (StarTrack Code 128)

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-FRT-01 | Freight item barcode present on every article (mandatory element) | M | AUTO | ✅ `ST_FREIGHT_BARCODE_PRESENT` | p11, 1.022 |
| ST-FRT-02 | 20-character format `XXXZ99999999AAA99999`: 4-char alphanumeric Despatch ID + 8-digit consignment sequence + 3-char product code + 5-digit item sequence | M | AUTO | ✅ `parseStarTrackFreightItemBarcode`, `ST_CONNOTE_STRUCTURE`, `ST_ITEM_SEQUENCE` | p12 |
| ST-FRT-03 | Product code segment is a valid StarTrack product (TSE, RET, RE2, APT, PRM, FPP, ARL, FPA, EXP) | M | AUTO | ✅ `ST_PRODUCT_KNOWN` | p7, p12 |
| ST-FRT-04 | Code 128 subset pattern: 4 chars Code B + 8 Code C + 4 Code B + 4 Code C | M | PARTIAL (decoder abstracts) | 🟡 `ST-FRT-04` asserts the character-class consequence (4 alnum + 8 digits + 3 alnum + 5 digits); physical subset switching needs a print-time verifier | p12 |
| ST-FRT-05 | Symbol: picket-fence orientation; min bar width 0.38 mm; min height 25 mm; min length 83 mm; quiet zone 5 mm each side; resolution 6 dots/mm | M | PARTIAL (crop geometry vs page mm) | ❌ gap | p12 |
| ST-FRT-06 | ANSI print grade A–B preferred, C minimum, D–F fail | M | MANUAL (verifier) | ⛔ physical | p12 |
| ST-FRT-07 | Human-readable 20-char Article ID beneath the barcode under heading `Article ID`; Arial Bold 8pt | M | PARTIAL (text) | ❌ gap — visible article ID not compared with decoded value | 1.022 |
| ST-FRT-08 | Visible CONNOTE value matches the connote embedded in the freight barcode | M (implied) | AUTO | ✅ `ST_CONNOTE_MATCH` (manual-review on mismatch) | p10, p12 |
| ST-FRT-09 | Compression-encoded symbol prints exactly 61 bars (19 symbol characters × 3 + 4 stop bars; all-Code-B prints 70) | M (derived) | AUTO (scanline measurement) | 🟡 `ST-FRT-09` counts bars across the decoded symbol; mismatch reports a warning, not a fail, because image quality affects the count | p12 |

## 8. SSCC freight barcode variant (UCC/EAN-128)

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-SSC-01 | AI (00) + 20-digit SSCC: extension digit (typically 3) + GS1 company prefix (93…) + serial reference + check digit | M (SSCC customers) | AUTO | ✅ `parseSsccBarcode`, `ST_SSCC_*` | p12–13 |
| ST-SSC-02 | SSCC mod-10 check digit valid | M | AUTO | ✅ `ST_SSCC_INVALID` on failure | p13 |
| ST-SSC-03 | Code set C with FNC1 prefix | M | PARTIAL (decoder abstracts) | ⛔ decoder-level | p13 |
| ST-SSC-04 | Symbol: min bar width 0.3 mm; min height 25 mm; min length 78 mm; quiet zone 5 mm | M | PARTIAL | ❌ gap | p13 |
| ST-SSC-05 | GS1 company prefix matches the prefix registered with StarTrack | M | AUTO (when expected prefix supplied) | ✅ `ST_SSCC_EXPECTED_*` | p13 |
| ST-SSC-06 | SSCC labels used for despatch movements only (not returns/transfers); mandatory for NZ Premium with StarTrack-issued prefix/range | M | AUTO (vs QR movement type) | ❌ gap | p13, p34 |
| ST-SSC-07 | Product/service not embedded in SSCC — embedded-field checks suppressed, product context from QR/routing | M | AUTO | ✅ `ST_SSCC_PRODUCT_RULE` | p13 |

## 9. Sortation (routing) barcodes

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-RTE-01 | An approved sortation barcode is present: StarTrack Routing Barcode (AU domestic + NZ) or GS1 421 Routing Barcode (AU domestic SSCC labels only) | M | AUTO | ✅ `ST_ROUTING_BARCODE_PRESENT` | p13–14, 1.014, 4.001 |
| ST-RTE-02 | StarTrack routing format `SSS9999DDD`: 3-char Label Code + 4-digit receiver postcode (or `9901` for NZ) + 3-char Depot Code (EXP-type) or Primary Port (PRM-type, `SYD` for NZ) | M | AUTO | ✅ `parseStarTrackRoutingBarcode`, `ST_ROUTE_LABEL_CODE`, `ST_ROUTE_POSTCODE` | p14 |
| ST-RTE-03 | Routing label code corresponds to the product on the freight barcode/QR (e.g. FPP→PRM, FPA→ARL) | M | AUTO | ✅ `ST_ROUTE_PRODUCT_MATCH` | p7, p14 |
| ST-RTE-04 | Routing postcode equals the QR receiver postcode and the visible receiver postcode | M (implied) | AUTO | 🟡 `ST-RTE-04` cross-checks the QR postcode; the visible receiver postcode is not cross-checked | p14, p16 |
| ST-RTE-05 | Depot/port segment is valid for the receiver postcode+suburb per the Location Master File | M | AUTO (requires LMF data) | ❌ gap — no LMF reference data in the app | p8, p14 |
| ST-RTE-06 | GS1 421 format: AI 421 + 3-digit ISO country (`036`) + 4-digit postcode + AI 403 + 3-char label code | M (SSCC) | AUTO | 🟡 verify parser handles AI 421/403 paths | p14–15 |
| ST-RTE-07 | StarTrack routing symbol: min bar width 0.38 mm; height 25 mm; length 54 mm; quiet zone 5 mm; 6 dots/mm. GS1 421: 0.35 mm / 30 mm / 54 mm / 5 mm | M | PARTIAL | ❌ gap | p14–15 |
| ST-RTE-08 | ANSI print grade A–B preferred, C minimum | M | MANUAL | ⛔ physical | p14 |
| ST-RTE-09 | Code 128 subset pattern: 3 chars Code B + 4 Code C + remaining Code B | M | PARTIAL (decoder abstracts) | 🟡 `ST-RTE-09` asserts the character-class consequence (3 alnum + 4 digits + 2–3 alnum); physical subset switching needs a print-time verifier; GS1 421 routing exempt | p14 |

## 10. StarTrack 2D QR barcode

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-QR-01 | QR barcode present on **all** labels | M | AUTO | ✅ `ST_QR_PRESENT` | p15–16, 1.015 |
| ST-QR-02 | Symbol 26 mm × 26 mm; error correction level L | M | PARTIAL (crop geometry; EC level from decoder metadata if exposed) | ❌ gap | p16 |
| ST-QR-03 | Payload is fixed-width; spaces pad blank optional fields (field positions below) | M | AUTO | ✅ `parseStarTrackQrBarcode` (fixed-slice parsing) | p16 |

### QR payload fields (fixed positions)

| # | Field | Pos | Len | Required | Format rule | Coverage |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Receiver Suburb | 1 | 30 | M | non-blank | ✅ `ST_QR_MANDATORY` |
| 02 | Receiver Postcode | 31 | 4 | M | 4 digits; `9901` for NZ Premium | ✅ `ST_QR_POSTCODE` |
| 03 | Consignment Number | 35 | 12 | M | `XXXZ99999999` | 🟡 presence only; format/equality vs freight barcode not asserted |
| 04 | Freight Item Number | 47 | 20 | M | 20-char freight item ID | 🟡 presence only; equality vs freight barcode not asserted |
| 05 | Product Code | 67 | 3 | M | valid product code | ✅ `ST_QR_PRODUCT` |
| 06 | Payer Account | 70 | 8 | COND | required for controlled return/transfer, or third-party-paid despatch | ❌ conditional logic absent |
| 07 | Sender Account | 78 | 8 | COND | required for despatch movements; left-justified | ❌ conditional logic absent |
| 08 | Consignment Quantity | 86 | 4 | M | numeric, left-justified | 🟡 presence only |
| 09 | Consignment Weight | 90 | 5 | M | total kg rounded up; numeric | 🟡 presence only |
| 10 | Consignment Cube | 95 | 5 | COND | m³ × 1000; `*****` when overflow; required when not a satchel | ❌ conditional/overflow logic absent |
| 11 | Despatch Date | 100 | 8 | M | `YYYYMMDD`, valid calendar date | 🟡 presence only; format/validity unchecked |
| 12 | Receiver Name 1 | 108 | 40 | M | non-blank | ✅ `ST_QR_MANDATORY` |
| 13 | Receiver Name 2 | 148 | 40 | O | — | n/a |
| 14 | Unit Type | 188 | 3 | M | Appendix A value permitted for the product | ✅ `ST_QR_UNIT` |
| 15 | Destination Depot | 191 | 4 | M | Nearest Depot (EXP) / Secondary Port (PRM) / `ZNA` (NZ) | 🟡 presence only; LMF validity unchecked |
| 16 | Receiver Address 1 | 195 | 40 | M | non-blank, left justified | ✅ `ST_QR_MANDATORY` |
| 17 | Receiver Address 2 | 235 | 40 | O | — | n/a |
| 18 | Receiver Phone | 275 | 14 | O | numeric | ❌ format unchecked |
| 19 | Dangerous Goods Indicator | 289 | 1 | M | `Y` or `N` | ✅ `ST_QR_DG` |
| 20 | Movement Type Indicator | 290 | 1 | M | `N` despatch / `C` controlled return / `T` transfer | ✅ `ST_QR_MOVEMENT` |
| 21 | Not Before Date | 291 | 12 | O | `YYYYMMDDHHMM`; must be ≤ Not After Date | ❌ format & cross-field rule absent |
| 22 | Not After Date | 303 | 12 | O | `YYYYMMDDHHMM`; must be ≥ Not Before Date | ❌ format & cross-field rule absent |
| 23 | ATL Number | 315 | 10 | COND | `C999999999`; required when ATL selected | ✅ `ST_QR_ATL` (format when populated; requiredness heuristic) |
| 24 | RA Number | 325 | 10 | COND | mandatory for Controlled Returns & Transfer Movements | ❌ conditional rule absent (movement type C/T ⇒ RA required) |

## 11. Authority To Leave (ATL) barcode

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-ATL-01 | Format `C999999999`: literal `C` + 9-digit sequential counter starting `000000001` | COND | AUTO | ✅ `parseStarTrackAtlBarcode`, `ST_ATL_COUNTER` | p17–18 |
| ST-ATL-02 | Printed when ATL selected under a product that supports ATL | COND | AUTO (product feature matrix) | 🟡 expectation inferred from text/QR; product-level ATL support matrix not consulted | p7, 1.005 |
| ST-ATL-03 | One ATL code per consignment, repeated on every label in the consignment | M (when ATL) | AUTO (multi-label batch) | ❌ gap — no cross-label consistency check | p18 |
| ST-ATL-04 | Symbol: picket fence; min height 10 mm; min length 28 mm; quiet zone 5 mm; 6 dots/mm | M | PARTIAL | ❌ gap | p18 |
| ST-ATL-05 | ATL barcode value matches the QR ATL field and any visible ATL number | M (implied) | AUTO | 🟡 expected-number set built from QR/text; explicit equality result not reported per source | p16–18 |
| ST-ATL-06 | Code 128 subset pattern: 2 chars Code B + 8 Code C | COND | PARTIAL (decoder abstracts) | 🟡 `ST-ATL-06` asserts the character-class consequence (literal `C` + 9 digits); physical subset switching needs a print-time verifier | p18 |

## 12. Consignment numbering & consolidation

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-CON-01 | Consignment note number is exactly 12 characters: 4-char Despatch ID + 8-digit incrementing sequence | M | AUTO | ✅ `ST_CONNOTE_STRUCTURE` | p10 |
| ST-CON-02 | Consignment numbers never duplicated (per customer or across customers) | M (process) | PARTIAL (batch duplicate detection) | ⛔ single-label; batch enhancement | p10 |
| ST-CON-03 | Satchel unit type / fixed-weight services (FPP, FPA): single item per consignment | M | AUTO (QR unit type + quantity) | ❌ gap | p10 |
| ST-CON-04 | Max 12 different unit types per connote | M | AUTO (multi-label batch) | ❌ gap | p10 |
| ST-CON-05 | Consolidation only when receiver, service, payer, insurance, DG class, special instructions and ATL all match | M (manifest) | PARTIAL | ⛔ manifest-level, out of label scope | p10 |
| ST-CON-06 | Delivery postcode + suburb validated as serviceable via the Location Master File before label generation | M | AUTO (requires LMF data) | ❌ gap — no LMF data in app | p8 |

## 13. Cross-element consistency (label-internal)

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| ST-X-01 | QR consignment number = freight barcode connote = visible `CONNOTE:` value | M (implied) | AUTO | 🟡 visible-vs-freight covered (`ST_CONNOTE_MATCH`); QR-vs-freight equality not explicitly reported | p12, p16 |
| ST-X-02 | QR freight item number = freight barcode 20-char ID = visible Article ID | M (implied) | AUTO | ❌ gap | p12, p16, 1.022 |
| ST-X-03 | QR product code = freight barcode product segment = routing label-code mapping | M (implied) | AUTO | 🟡 routing-vs-product covered (`ST_ROUTE_PRODUCT_MATCH`); QR-vs-freight equality not explicit | p7, p12–16 |
| ST-X-04 | QR receiver postcode = routing barcode postcode = visible receiver postcode | M (implied) | AUTO | ❌ gap | p14, p16 |
| ST-X-05 | QR consignment quantity consistent with visible `ITEM n OF m` and item sequence in the freight barcode | M (implied) | AUTO | ❌ gap | p12, p16, 1.021 |
| ST-X-06 | QR weight/cube consistent with visible WEIGHT/CUBE values | M (implied) | AUTO | 🟡 facts enriched from QR; equality not reported as a distinct rule | p16, 1.021 |
| ST-X-07 | QR movement type consistent with the label format (despatch vs `*RETURN*`/`*TRANSFER*` label, RA number presence) | M (implied) | AUTO | ❌ gap | p16, 3.003 |

## 14. Physical & process checks (manual-review items in the report)

| ID | Requirement | Obligation | Audit | Spec ref |
| --- | --- | --- | --- | --- |
| ST-PHY-01 | Sample barcodes tested and approved by StarTrack before full-scale production | M (process) | MANUAL | p11 |
| ST-PHY-02 | Barcodes readable at speed across field depths (scanned from 1000–1700 mm) — print grade A–C | M | MANUAL (verifier) | p11–12 |
| ST-PHY-03 | Label stock matt texture (non-glossy) | M | MANUAL | p11 |
| ST-PHY-04 | Despatch Summary / Returns–Transfer Summary documents produced per DS.001–DS.015 (separate Express vs Premium summaries, DG itemisation, driver name field, sender declaration) | M (despatch paperwork) | MANUAL / out of label scope | p36–41 |
| ST-PHY-05 | DG consignments accompanied by compliant Dangerous Goods Transport Document (road: ADG Code 7.3; air: IATA DGR) | COND | MANUAL | p42–44 |

---

## Reference data the rule set needs

| Data set | Used by | Source |
| --- | --- | --- |
| Product codes → label codes & features (TSE, RET, RE2, APT, PRM→PRM, FPP→PRM, ARL→ARL, FPA→ARL, EXP→EXP; ATL support, DG support, connote consolidation, single/multi item) | ST-FRT-03, ST-RTE-03, ST-ATL-02, ST-CON-03 | Spec p7 (already partially in `STARTRACK_PRODUCT_CODE_MAP`) |
| Unit types → permitted products (BAG, CTN, ITM, JIF all products; PAL/SKI not FPP/FPA; SAT only FPP/FPA/EXP) | ST-QR field 14, ST-CON-03 | Appendix A (already in `STARTRACK_UNIT_TYPE_MAP` — verify SAT/PAL/SKI restrictions) |
| Location Master File (postcode/suburb → depot, ports, state code, AP delivery/lodgement flags) | ST-RTE-05, ST-CON-06, ST-LOC-01/02 | Customer-supplied `LOCATIONS.DAT` (fixed-width, fields per p8–9) — consider optional upload |
| LMF state codes (0=NT, 2=NSW, 3=VIC, 4=QLD, 5=SA, 6=WA, 7=TAS, A=ACT, 9=Intl) | LMF parsing | p8 |

## Engine deviations to resolve in the code review

- QR fields 3, 4, 8, 9, 11, 15 are checked for presence only; format rules (connote pattern, 20-char freight ID, numeric weight/quantity, `YYYYMMDD` validity) are not asserted (ST-QR table).
- Conditional QR rules absent: RA number required for movement types `C`/`T` (field 24), payer/sender account conditions (fields 6–7), cube overflow `*****` handling (field 10), Not Before ≤ Not After (fields 21–22).
- Cross-element equality (QR ↔ freight barcode ↔ routing ↔ visible text) is mostly implicit via fact enrichment rather than reported as named rules — ST-X-01..07 should each surface as a visible report row with both raw values.
- Returns/transfer flow unhandled: `*RETURN*`/`*TRANSFER*` indicator (ST-HDR-06), movement-type consistency (ST-X-07), SSCC-on-returns prohibition (ST-SSC-06).
- No Location Master File support, so depot/port validity (ST-RTE-05, ST-CON-06) and RC/R1/R2 checks (ST-LOC-01..03) cannot run — consider optional LOCATIONS.DAT upload.
- Physical symbol geometry (bar height/length/quiet zones, QR 26 mm, EC level L) unmeasured despite crop bounding boxes + page dimensions being available (ST-FRT-05, ST-RTE-07, ST-ATL-04, ST-QR-02).
