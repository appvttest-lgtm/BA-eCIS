# eParcel (Parcel Post & Express Post) Label Audit Checklist

**Source of truth:** *Parcel Post and Express Post — Label & Barcode Specification*, Version 1.4, 05/06/2025 (`Resources/Parcel Post and Express Post v1.4.pdf`).

This checklist enumerates every label conformance rule in the specification. Each rule has a stable ID intended to become the `id` of a rule in the executable JSON rule set, and is mapped to the check (if any) that `src/auditEngine.js` performs today. It is the eParcel baseline for the rule-set uplift and code review.

## Legend

| Column | Values |
| --- | --- |
| **Obligation** | `M` Mandatory · `HD` Highly Desirable · `REC` Recommended · `COND` Conditional (mandatory when the condition applies) |
| **Audit** | `AUTO` deterministically checkable from the digital label · `PARTIAL` checkable via heuristics (OCR/text layer, raster sampling, geometry) · `MANUAL` physical/print check, present in the report as a manual-review item only |
| **Coverage** | ✅ implemented (engine check ID) · 🟡 partially implemented · ❌ gap · ⛔ documented out-of-scope |

---

## 1. Label layout & presentation

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-LAY-01 | Label size is 15 cm × 10 cm (both Parcel Post and Express Post, either layout) | M | AUTO (page dims) | 🟡 `A6_SIZE` — accepts A6 105×148 mm and 100×150 mm with tolerance; expected-size wording and tolerances need aligning to the spec's 150×100 mm | p10–12 |
| EP-LAY-02 | Layout follows a standard template: Traditional (horizontal linear barcode) or Contemporary (vertical linear barcode) | M | PARTIAL (barcode crop orientation) | ❌ gap | p8, p14 |
| EP-LAY-03 | White label, black font — no colour background in the address or barcode sections | M | PARTIAL (raster sampling of regions) | ❌ gap | p14 |
| EP-LAY-04 | Label is on one flat surface, not wrapped across multiple faces of the parcel | M | MANUAL | ⛔ physical | p14 |
| EP-LAY-05 | Express Post labels use the yellow Express Post header for product identification (acceptable alternative: B&W label + Express Post tape applied at lodgement) | M | PARTIAL (header text + colour sampling of header band) | 🟡 `LABEL_TYPE` detects header text only; no colour verification | p8, p10 |
| EP-LAY-06 | Label generation date (MMDD) is printed at the expected position on the label | M | PARTIAL (text presence + position heuristic) | ❌ gap — only the barcode AI 8008 value is validated today | p9–10, p14 |
| EP-LAY-07 | Dangerous Goods declaration present; when small DG quantities are permitted by contract, the declaration changes to "FOR ROAD TRANSPORT ONLY" (plus DG stickers on the carton) | M | PARTIAL (text) | ✅ `DG_DECLARATION` (presence only; road-only variant not distinguished) | p14 |

## 2. Delivery ("TO") address block

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-TO-01 | Keyword `TO` or `DELIVER TO` at the top of the address block | M | PARTIAL (text) | ✅ `ADDR_TO_PRESENT` (presence; keyword position not asserted) | p14 |
| EP-TO-02 | Address block sits in the top-left section of the label | M (template) | PARTIAL (text coordinates) | ❌ gap | p14 |
| EP-TO-03 | Single block of text, left justified, no blank lines or excessive spacing within the block | M / HD | PARTIAL (line geometry) | ❌ gap | p14 |
| EP-TO-04 | Font is consistent within the block, ~Arial 12 (regular 12–14 acceptable, below 10 degrades ORS); keyword line in normal weight (not bold/italic) | M | PARTIAL (PDF text layer exposes font name/size) | ❌ gap | p14 |
| EP-TO-05 | No truncation of address information (shrink text rather than truncate) | M | PARTIAL | ❌ gap | p14 |
| EP-TO-06 | Suburb, state and postcode on one line, capitalised, no commas | M | AUTO (regex over text) | 🟡 `ADDR_SUBURB_STATE_POSTCODE` — detects the line but matches case-insensitively and does not assert capitalisation or absence of commas | p14 |
| EP-TO-07 | Address is a valid address complying with Australian addressing standards | M | PARTIAL (state/postcode-range pairing sanity check) | ❌ gap | p14 |
| EP-TO-08 | DataMatrix AI 420 postcode equals the visible TO-address postcode | M (implied consistency) | AUTO | ❌ gap — cross-check not performed | p14, p19 |

## 3. Sender ("FROM") address block

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-FR-01 | Keyword `FROM` or `SENDER` at the top of the block, normal weight | M | PARTIAL (text) | ✅ `ADDR_FROM_PRESENT` (presence) | p14 |
| EP-FR-02 | Block sits in the bottom-left section of the label | M (template) | PARTIAL (text coordinates) | ❌ gap | p14 |
| EP-FR-03 | Font ~Arial 10; return address visibly smaller than the TO address | M | PARTIAL (font metrics) | ❌ gap | p14 |
| EP-FR-04 | Single left-justified block, consistent font, no gaps, no truncation | M | PARTIAL | ❌ gap | p14 |
| EP-FR-05 | Suburb, state and postcode on one line, capitalised, no commas | M | AUTO (regex) | 🟡 same limitation as EP-TO-06 | p14 |
| EP-FR-06 | Address is a valid return address (will be used by video coding; must meet ORS standards) | HD | PARTIAL | ❌ gap | p14 |

## 4. GS1-128 linear barcode — symbol

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-LIN-01 | A linear GS1-128 barcode is present (non-negotiable) | M | AUTO | ✅ `GS1_128_PRESENT` | p8, p15 |
| EP-LIN-02 | Barcode width 83.8 mm (3-char MLID) or 89.4 mm (5-char MLID) | M | PARTIAL (decode bounding box × page mm) | ❌ gap | p15 |
| EP-LIN-03 | Barcode height ≥ 18 mm (22 mm recommended) | M (min) | PARTIAL | ❌ gap | p15 |
| EP-LIN-04 | Light margin (quiet zone) ≥ 2.54 mm each side | M | PARTIAL | ❌ gap | p15 |
| EP-LIN-05 | Human-readable line in Arial 12 with the article number preceded by `AP Article ID:` | M | PARTIAL (text) | 🟡 `VISIBLE_ARTICLE_ID` extracts the value; the `AP Article ID:` prefix and font are not asserted | p15 |
| EP-LIN-06 | Encoding starts with FNC1; uses Start C, code set A (or B with uppercase only) for the MLID, set C for digit pairs | M | PARTIAL (abstracted by the decoder) | ⛔ decoder-level; uppercase indirectly enforced by EP-ART-02 | p16 |

## 5. GS1-128 linear barcode — data content

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-LIN-07 | AI 01 + Australia Post GTIN `99312650999998` (constant prefix `019931265099999891` incl. AI 91) | M | AUTO | ✅ `GS1_PREFIX_n` | p17, p31 |
| EP-LIN-08 | AI 91 article component follows the GTIN | M | AUTO | ✅ `AI91_n` | p17 |
| EP-LIN-09 | Linear barcode and DataMatrix encode the same article number | M (implied) | AUTO | ❌ gap — parsed into one map; equality is never asserted or reported | p15, p18 |

## 6. GS1 DataMatrix — symbol & data content

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-DM-01 | A GS1 DataMatrix barcode is present (non-negotiable) | M | AUTO | ✅ `DATAMATRIX_PRESENT` | p8, p18 |
| EP-DM-02 | Square symbol only (never rectangular); recommended size 13.68 × 13.68 mm | M | PARTIAL (crop geometry) | ❌ gap | p18 |
| EP-DM-03 | Quiet zone of one module on all four sides, kept clear | M | PARTIAL | ❌ gap | p18 |
| EP-DM-04 | FNC1 encoded at the start; group separators are control characters (ASCII 29), never literal text (`$`, `_1`, `FNC1`) | M | AUTO | ✅ `DM_SEPARATORS_n` | p18, p28 |
| EP-DM-05 | AI 420 + 4-digit delivery postcode present | M | AUTO | ✅ `DM_POSTCODE_n` | p19 |
| EP-DM-06 | AI 92 + 8-digit DPID; when DPID unavailable, AI 92 and its separator are omitted entirely; `00000000` is invalid | COND | AUTO | ✅ `DM_DPID_n` | p6, p19, p28 |
| EP-DM-07 | AI 8008 + label-generation date/time `YYMMDDHHMMSS`, no spaces | M | AUTO | 🟡 `DM_8008_n` — format only; calendar plausibility unchecked | p19, p28 |
| EP-DM-08 | Group separators positioned immediately before AI 420 and AI 8008 | M | AUTO | 🟡 implicit in parsing; an explicit positional check would surface the documented failure mode directly | p28 |

## 7. Article number & check digit

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-ART-01 | Article number = MLID + 7-digit consignment serial + 2-digit article count + 5-char product code + 2-digit service code + postage-paid `0` + check digit (21 chars for 3-char MLID, 23 for 5-char) | M | AUTO | ✅ `ARTICLE_PARSE` | p17, p22 |
| EP-ART-02 | MLID is 3 or 5 uppercase alphanumeric characters | M | AUTO | ✅ `MLID_n` | p6, p17 |
| EP-ART-03 | Consignment serial is exactly 7 digits | M | AUTO | ✅ `CONSIGNMENT_n` | p6, p17 |
| EP-ART-04 | Article count is 01–20 (position of the article within the consignment) | M | AUTO | ✅ `ARTICLE_COUNT_n` | p6, p17 |
| EP-ART-05 | Postage-paid indicator is the fixed value `0` | M | AUTO | ✅ `POSTAGE_PAID_n` | p17 |
| EP-ART-06 | Check digit valid per EAN/UCC-13 algorithm with alpha characters converted to the last digit of their ASCII code | M | AUTO | ✅ `CHECK_DIGIT_n` (`calculateEparcelCheckDigit`) | p22–23 |
| EP-ART-07 | Visible consignment number ("Cons No") matches the consignment embedded in the barcode article | M (implied) | AUTO | ✅ `CONSIGNMENT_MATCH_n` | p6 |
| EP-ART-08 | Visible `AP Article ID` text matches the decoded barcode article number | M (implied) | AUTO | ❌ gap — both values extracted but never compared | p15 |
| EP-ART-09 | Consignment numbers not reused within 2 years | M (process) | PARTIAL (duplicate detection within an audited batch only) | ⛔ not auditable from a single label; batch-level duplicate check is a feasible enhancement | p6 |

## 8. Product & service codes

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-SVC-01 | Service code is a known value: 03, 08, 09, 15, 45, 49, 50, 51, 81, 82, 83 | M | AUTO | ✅ `SERVICE_KNOWN` | p20–21 |
| EP-SVC-02 | Product code is a known 5-char value (e.g. 00093, 00096, 00065, 00068, 00091, 00087) | M | AUTO | ✅ `PRODUCT_KNOWN` | p20–21 |
| EP-SVC-03 | Service/product combination is valid per the service-options matrix | M | AUTO | ✅ `SERVICE_PRODUCT_MATCH` | p21 |
| EP-SVC-04 | Signature-required service codes (03/50/…) must not appear alongside contradictory special delivery instructions (e.g. "leave in a safe place") on the label | M | PARTIAL (instruction text scan) | ❌ gap | p20 |
| EP-SVC-05 | Service code does not conflict with the electronic-data flags (`authority_to_leave`, `allow_partial_delivery`, `safe_drop_enabled`) | M | AUTO (when payload supplied) | ✅ payload comparison (identity-gated) | p21 |
| EP-SVC-06 | Wine services (49/81/82/83): identity-on-delivery context applies (VIC regulatory requirement) | COND | PARTIAL | ❌ gap (informational note at minimum) | p21 |

## 9. Returns labels

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-RET-01 | eParcel Returns support service codes 03 or 08 only | M | AUTO (when product is 00065/00068) | ❌ gap | p20 |
| EP-RET-02 | Returns are always single-parcel consignments (article count 01 of 01) | M | AUTO | ❌ gap | p20 |
| EP-RET-03 | SSCC barcodes must not be used for eParcel Returns | M | AUTO | ❌ gap | p26 |

## 10. SSCC label variant

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-SS-01 | Linear barcode contains only FNC1 + AI 00 + 20-digit SSCC | M | AUTO | ✅ `parseSsccBarcode` + `SSCC_EXPECTED_*` | p26 |
| EP-SS-02 | SSCC mod-10 check digit is valid | M | AUTO | ✅ (`gs1Mod10CheckDigit`) | p26 |
| EP-SS-03 | DataMatrix retains the AusPost GTIN prefix with the SSCC in the article-ID position, plus AI 420 postcode and AI 8008 date/time | M | AUTO | 🟡 verify — DM parsing may treat the SSCC payload as a malformed standard article | p26 |
| EP-SS-04 | SSCC company prefix matches the merchant's GS1 prefix; separate prefixes reserved for Parcel Post vs Express Post articles | M | AUTO (when expected prefix supplied) | ✅ `SSCC_EXPECTED_*` (PP-vs-EP prefix separation not distinguishable from one label) | p26 |
| EP-SS-05 | Product/service codes are not embedded in SSCC barcodes — those checks must be suppressed, not failed | M | AUTO | ✅ SSCC mode suppresses embedded-field checks | p20, p26 |

## 11. International

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-INT-01 | International labels must be sourced from the Shipping & Tracking APIs; in-house generation is not permitted | M | PARTIAL (detect international label and flag) | ❌ gap | p26 |

## 12. Electronic data alignment (optional Get Shipments payload audit)

| ID | Requirement | Obligation | Audit | Coverage | Spec ref |
| --- | --- | --- | --- | --- | --- |
| EP-PAY-01 | Identity gate: payload article/consignment/SSCC must match the label before secondary comparisons run | (app rule) | AUTO | ✅ `applyPayloadIdentityGate` | p31 |
| EP-PAY-02 | `barcode_id` is the pipe-delimited representation of the 2D string (pipes standing in for FNC1 group separators) | M | AUTO | ✅/🟡 compared when present | p31–32 |
| EP-PAY-03 | `consignment_id` = MLID + 7 digits; `article_id` = consignment + count + product + service + postage-paid + check digit | M | AUTO | ✅ payload comparison | p31 |

## 13. Physical & process checks (manual-review items in the report)

| ID | Requirement | Obligation | Audit | Spec ref |
| --- | --- | --- | --- | --- |
| EP-PHY-01 | Barcode verifier grade ≥ 1.5 / ISO grade C for both symbols | M | MANUAL (Axicon verifier) | p25 |
| EP-PHY-02 | Contemporary PDF labels must not be printed on thermal printers (unreadable vertical barcode risk) | REC | MANUAL | p8 |
| EP-PHY-03 | Regular print-quality checks; damaged labels replaced | REC | MANUAL | p29 |
| EP-PHY-04 | Label placement exposes address and barcodes to scanning devices | M | MANUAL | p30 |
| EP-PHY-05 | Labels tested and approved by Australia Post (TechSignOff) before production | M | MANUAL (process) | p5, p25 |

---

## Known documented failure modes (negative test cases for the rule set)

From the spec's "invalid 2D symbols" examples (p28) — each should be a regression fixture:

1. Literal `$` in place of FNC1 characters.
2. Separator characters present but in the wrong position (must precede `420` and `8008`).
3. Literal `_1` used as FNC1.
4. DPID of `00000000` (must omit AI 92 + separator instead) and 3-character postcode.
5. Space inside the AI 8008 date/time.
6. Literal `FNC1` text in place of the control character.
7. No FNC1 characters at all.
8. Two FNC1 characters before AI 8008.

## Engine deviations to resolve in the code review

- `A6_SIZE` accepted dimensions don't match the spec's stated 150 × 100 mm label size (currently A6-centric wording and 105×148 acceptance).
- Suburb/state/postcode rule is detected case-insensitively; capitalisation and the no-comma rule are not enforced (EP-TO-06 / EP-FR-05).
- No cross-consistency checks: linear vs DataMatrix article (EP-LIN-09), visible article vs decoded (EP-ART-08), AI 420 vs visible postcode (EP-TO-08).
- AI 8008 is format-checked only; no plausibility validation (valid calendar date/time, not in the future) (EP-DM-07).
- Returns-specific rules absent (EP-RET-01..03) even though return product codes 00065/00068 are recognised.
- Font name/size data available in the PDF text layer is unused (EP-TO-04, EP-FR-03).
