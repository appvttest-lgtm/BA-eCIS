
BarcodeAuditer v1.7.5 Release Notes
===================================

Release focus
-------------
The v1.7.1 to v1.7.6 line replaces hard-coded validation logic with external JSON rule sets, adds a rule-by-rule report UI, introduces input preprocessing for rotated and multi-label uploads, and hardens the local server, the launcher and all attacker-controlled input paths. The local-only security design is unchanged.

v1.13.1 - GS1 DataMatrix carrier compliance: FNC1-first and ECC 200
--------------------------------------------------------------------
Per the GS1 DataMatrix Guideline (gs1.org), a GS1 DataMatrix is specifically Data
Matrix ECC 200 with the FNC1 codeword in the FIRST position; the leading FNC1 is
never transmitted as data - scanners signal it via the ISO/IEC 15424 symbology
identifier "]d2". Neither property was previously assessed.

- New rule EP-DM-09 "GS1 FNC1 in first position": passes on identifier ]d2/]d5,
  fails on other ]dN identifiers (a plain Data Matrix, not GS1), and goes to
  manual review when the decoder reported no identifier.
- New rule EP-DM-10 "Data Matrix ECC 200": identifier ]d1-]d6 proves ECC 200 and
  ]d0 fails (ECC 000-140 is not permitted for GS1 applications); when no identifier
  is available, a decode by either ZXing engine still proves ECC 200 because ZXing
  only reads ECC 200 symbols. Both rules apply to eParcel standard and SSCC labels.
- The ZXing-WASM symbology identifier now survives barcode deduplication and is
  attached to every DataMatrix parse as audit evidence.
- The colour-coded DataMatrix breakdown now shows the leading "(FNC1) start"
  marker at position 1 (previously only the separators before AI 420/92/8008 were
  marked), with the reported symbology identifier when the decoder exposed it.

v1.13.0 - Checklist gap remediation: silent false-passes closed, undetected states visible, barcode-crop OCR
-------------------------------------------------------------------------------------------------------------
Driven by four per-label-type audits (eParcel standard/SSCC, StarTrack standard/SSCC)
of the documented rule sets vs the shipped engine.

Barcode classification & parsing correctness:
- A decoded DataMatrix can no longer satisfy the "GS1-128 linear barcode present"
  check (EP-LIN-01); symbology metadata now outranks payload-content sniffing when
  classifying DataMatrix vs linear values, and QR formats can no longer leak into
  StarTrack's linear barcode list (a QR payload starting 00+18 digits previously
  could satisfy the SSCC check).
- SSCC symbols must now contain AI 00 + the 20-digit SSCC and nothing else; trailing
  payload is rejected with an explicit reason.
- The SSCC mod-10 check digit is now validated wherever the SSCC is carried,
  including the AI 91 article position inside a GS1 DataMatrix.
- Linear GS1 barcodes without the AI 01 + Australia Post GTIN opener now fail
  EP-LIN-07 instead of being silently skipped.
- New EP-DM-08: AI 420/92/8008 values recoverable only without their FNC1 group
  separators are flagged for manual review (spec p28 invalid-symbol modes #2/#7/#8).
- New ST-LIN-UNK: StarTrack linear symbols that decode but match no StarTrack
  structure are surfaced for review instead of being mislabelled "not decoded".

SSCC cross-checks:
- New EP-SS-03/EP-SS-03A: the eParcel SSCC DataMatrix must repeat the linear SSCC
  and retain the AusPost GTIN prefix.
- ST-SSC-02/EP-SS-02 no longer emit a vacuous "all check digits valid" PASS when
  zero SSCCs decoded; they now report "not assessed" instead.
- New EP-SS-STRAY / ST-SSC-STRAY: a valid SSCC decoded on a standard-format audit
  raises a warning.

Printed-vs-decoded direction (StarTrack):
- Printed-label checks (CONNOTE, label code, WEIGHT, CUBE, receiver block) no longer
  accept values backfilled from the very barcodes they cross-check; ST-FRT-08
  (printed CONNOTE = freight barcode) can now genuinely fail.
- New ST-FRT-07 (visible article ID = freight barcode) and ST-SSC-08 (printed
  20-digit SSCC = decoded SSCC), both compared against print-only text.

Undetected/missing states are now visible:
- Mandatory checks whose input data is undetected now emit manual-review or
  "not assessed" rows instead of vanishing: ST-QR-MAND (QR undecoded), ST-SSC-06
  (despatch-only), ST-RTE-03/04, ST-X-01/02, EP-LIN-09, EP-SS-02/03, ST-FRT-07/08,
  ST-SSC-08, and the SSCC expected-prefix checks ("prefix not checked" note when no
  expected value is supplied).
- Get Shipments payload problems now surface as report rows (parse failure, identity
  mismatch, per-field mismatches) and influence the overall status; the payload
  identity gate accepts decoded barcode identifiers only (OCR text can no longer
  stand in as the label-identity source).

OCR improvements:
- New targeted OCR pass over each located barcode crop (expanded to include the
  human-readable line) using an aggressive profile: strong local contrast stretch,
  heavier unsharp mask (1.4), up to 6x magnification and an alphanumeric whitelist -
  recovering the HRI digits the full-label pass misses.
- The full-label OCR pass's sharpening is reduced (0.8 -> 0.5) so general text is no
  longer over-sharpened. Barcode decoding still always runs on the untouched canvas;
  OCR remains a one-way cross-check and never a barcode value source.

Docs/tests:
- intended-checklist.json, coverage-report.json and both audit checklists updated
  (stale "engine deviations" corrected; ST-SSC-08 documented; MANUAL legend fixed).
- New regression suite tests/audit-gap-fixes.test.mjs (16 tests) pins every fix at
  the auditLabel() boundary; golden baselines refreshed after review.

v1.12.12 - FNC1 separators shown in the DataMatrix breakdown
-------------------------------------------------------------
- The colour-coded DataMatrix string now shows a divider wherever the spec expects a
  Function 1 group separator: a short vertical bar with a small "⟨FNC1⟩" label between
  the coloured fields, at the spec's page-19 positions (before AI 420, 92 and 8008).
  The divider appears whether or not the separator character survived decoding - many
  scanners strip FNC1 from the reported payload, so the structural boundary is marked
  either way.
- Each divider also gets a row in the field table: a pass tick with "control
  character" or "readable text" when the separator was decoded (e.g. a real ASCII 29
  or the literal "<GS>" rendering), or a neutral dash with "separator character not
  visible in this decode" when the scanner stripped it.
- Copy fidelity improves as a side effect: the segmented-row copy button now includes
  the original separator characters verbatim (they were previously dropped from that
  one copy path); the marker text is display-only and never enters the clipboard.

v1.12.11 - DataMatrix breakdown matches the Parcel Post spec's AI 91 forms
---------------------------------------------------------------------------
- The eParcel GS1 DataMatrix per-field breakdown no longer reports "payload did not
  parse as a standard eParcel article" for two spec-conforming labels the rule engine
  already parsed correctly (display-only gaps, verified against Parcel Post & Express
  Post spec v1.4):
  - SSCC-as-article (spec p26): an AI 91 value of AI 00 + 18-digit SSCC "in exactly
    the same position where a standard article Id would go" now renders as AI 00 SSCC
    components with the check-digit field check, instead of an unparsed block.
  - Separator forms: the breakdown now splits elements on every separator a decoder
    can emit - GS/RS/FS control characters, pipe, CR/LF (some scanners report FNC1 as
    a newline), and the literal "<GS>"/"<RS>"/"<FS>" strings produced by human-readable
    decode modes (the reported field case: a valid 23-char article followed by
    "<GS>4203125<GS>8008..." rendered as one unparsed 54-char block) - and trims stray
    spaces at element edges.
- No validation logic changed: the rule engine parsed all these forms before and
  after. New engine regression tests pin the spec's own example payloads (pp18/24/26
  scanner reading, ZPL string, SSCC-as-article and newline-separated forms).

v1.12.10 - decoded barcode values kept verbatim at ingestion
-------------------------------------------------------------
- The scan pipeline no longer trims decoded barcode values when deduplicating scan
  passes: fixed-width StarTrack QR payloads keep their significant leading and
  trailing padding everywhere downstream - the colour-coded report display, every
  copy action, and the parser's length evidence. Previously the padding was stripped
  before anything could see it, which is why v1.12.9's copy fix alone was not enough.
- No rule logic changed. Parsed field values are identical (fields are sliced at
  absolute positions and trimmed per field). Two input-fidelity effects: a payload
  with leading padding now parses at the correct field positions instead of shifted
  ones, and the QR length evidence reflects the true symbol length, so a full-width
  payload that only "failed short" because its padding was trimmed now reports its
  real length.

v1.12.9 - copy buttons never trim barcode values
-------------------------------------------------
- The shared copy-to-clipboard button no longer trims the value it writes: fixed-width
  StarTrack QR payloads keep their significant leading and trailing padding on every
  copy action ("Copy all label data" and the per-barcode copy icons). Trimming is only
  used to decide whether there is anything to copy.

v1.12.8 - clearer "Copy all label data" format
-----------------------------------------------
- The copied text now separates each barcode into its own block: the label on one
  line, then the raw value fenced between dashed rules, with a blank line between
  blocks. Raw values are copied verbatim (fixed-width QR payloads keep their internal
  and trailing padding) instead of being trimmed.

v1.12.7 - StarTrack logo tint matched to the brand blue
--------------------------------------------------------
- The StarTrack tint on the rail emblem now matches the StarTrack brand blue #009FDA
  (sampled from the startrack.com.au logo), a lighter blue than the first pass. The
  CSS hue-shift filter was tuned so the emblem renders at ~rgb(0,161,217).

v1.12.6 - "Copy all label data" action in the report header
------------------------------------------------------------
- The copy button next to the article number becomes "Copy all label data": a labelled
  icon button that copies every decoded barcode raw string on the label, one per line,
  each prefixed with its name and a colon (for example "Routing barcode: EXP2000SYD").
  Order follows the report: StarTrack QR / routing / ATL / freight item, or eParcel
  linear GS1-128 / GS1 DataMatrix; duplicate decodes of the same symbol are copied once
  and any unclassified barcode falls back to its display name.
- Barcode decoding, parsing and validation logic are untouched - this only assembles
  already-decoded raw values for the clipboard.

v1.12.5 - rail spans the full page; roomier "Needs review" scroll area
-----------------------------------------------------------------------
- The rail card now extends all the way down the page (the full report column) instead
  of stopping at one viewport height. The content inside stays pinned while the page
  scrolls via an inner sticky wrapper.
- The "Needs review" list keeps flexing into the remaining pinned space but can no
  longer be crushed to a sliver on short screens: it holds a minimum height, and when
  the pinned blocks genuinely outgrow the screen the inner rail scrolls as a whole
  instead of pinching the bookmark list.

v1.12.4 - "Additional provided data" inputs temporarily disabled
-----------------------------------------------------------------
- The optional "Additional provided data" panel in the upload screen (Get Shipments
  payload comparison and SSCC extension/prefix inputs) is greyed out and cannot be
  opened while the comparison logic behind it is reviewed. The panel stays visible with
  a "temporarily unavailable" tag so users know the capability exists; all underlying
  code paths are unchanged and it re-enables by removing the disabled class.

v1.12.3 - fixed rail with scrolling review list; collapsed rules; carrier-tinted logo
--------------------------------------------------------------------------------------
- The rail no longer scrolls as a whole: the logo, audit result, file tabs and section
  navigation stay fixed while the "Needs review" bookmark list scrolls inside its own box
  when it grows too long (the multi-label file list also caps at 30% of the viewport with
  its own scrollbar). The review list is now a plain always-visible block, no longer a
  collapsible details element.
- The "New audit" button doubles in height: a stacked tile (icon above the label) pinned
  top-right, much harder to miss.
- Every rule row now starts collapsed, including failures - the head line already shows
  the status icon, FAIL/REVIEW badge and observed value; clicking a row expands the input
  data / rule / outcome panes.
- The full label image section always renders first in the report, ahead of the audit-mode
  check, so the reviewer immediately sees the label that was imported.
- The AP emblem in the rail tints StarTrack blue (CSS hue shift on the same asset) when the
  active audit - or the carrier picked in the upload panel - is StarTrack; it stays AP red
  for eParcel.
- The service-code/product matrix (eParcel) and the StarTrack product and label-code
  reference are no longer folded behind a collapsible reveal: both render permanently
  expanded in their sections.

v1.12.2 - report shell becomes the landing page; full-height rail; larger logo
-------------------------------------------------------------------------------
- The old hero + inline upload landing page is retired. The command-rail report shell is
  now the permanent backdrop: before any audit it renders as an empty skeleton (placeholder
  verdict, greyed nav lines, ghost report cards) with the upload panel hovering over it as
  an overlay. On the landing overlay there is no close button (nothing to go back to); once
  a report exists the overlay closes/ESCs back to the report as before.
- The rail now extends the full height of the viewport instead of enclosing its content.
- The Australia Post logo in the rail enlarges to the full rail width, matching the audit
  result box below it.
- Scan progress and status messages move into the report content column.

v1.12.1 - prominent "New audit" button top-right
------------------------------------------------
- The "New audit" button moves out of the rail to the top-right corner of the report
  header, opposite the logo: larger (14px text, pill), AP red with a new-document icon,
  soft red shadow for prominence. Same behaviour: opens the upload overlay; closing keeps
  the current report. On narrow screens it sits above the article number instead.
- Validation logic re-verified unchanged: the layout commits touch only main.jsx and
  styles.css; rules/, auditEngine, ruleEngine, checklists and tests are untouched since
  v1.11.0, and the golden corpus (which pins every rule outcome) passes unchanged.

v1.12.0 - command-rail report layout
------------------------------------
The report adopts the "command rail" layout (chosen from the three mockups): a sticky left
sidebar with the content column beside it, so nothing sticky ever overlaps the report.
- The rail carries: the AP brand mark + a "New audit" button, the audit verdict with
  passed/review/fail counters, a file navigator for multi-label uploads (article number,
  detected consignment ID and shipping service per label), the vertical section navigation
  with status dots, and the "Needs review" bookmarks.
- The landing view is unchanged (carrier + label format selection, then the dropzone).
  Once a report exists the upload panel leaves the page: "New audit" opens it in a
  dismissable overlay - closing it (button, backdrop or ESC) keeps the current report
  untouched; uploading a new label replaces the report.
- The sticky verdict banner, the "Uploaded label results" tab card and the horizontal
  pill nav are retired (the rail replaces all three). Anchor jumps simplify accordingly
  (no sticky stack to clear).
- On screens under 950px the rail stacks above the report as a normal card.

v1.11.1 - lean pass: drop orphan CSS and dead exports
-----------------------------------------------------
Over-engineering audit applied; no behaviour change intended.
- Removed 25 orphan CSS classes (~150 lines) stranded by the report redesign: the old
  status-dot vocabulary, pre-redesign report-table cells, the removed DataMatrix AI panel,
  retired upload/landing chrome and superseded payload cells. The shared ".notice, .message"
  block collapses to the live ".message" with its effective styles.
- Deleted two exports with zero callers: getRuleFunction (ruleEngine) and
  getServiceCodeRules (referenceData).

v1.11.0 - StarTrack receiver location codes (RC/R1/R2) cross-checked
--------------------------------------------------------------------
The printed location line next to the routing barcode (e.g. "AU TSV TSV") is now verified
against decoded data per MOS v9 1.009-1.011.1, closing the ST-LOC checklist gap.
- New derived fact pins the expected codes from decoded barcodes only: Premium-group
  products expect RC=AU, R1 = routing barcode port, R2 = QR destination depot; Express and
  Special Services expect RC=AU, R2 = routing barcode depot; NZ Premium (routing postcode
  9901) expects the fixed NZ/SYD/ZNA trio.
- Upgraded ST-LOC-01 (premium) and ST-LOC-02 (express) from a decoded-format-only check to
  a one-way text cross-check: the expected codes must appear in the extracted label text.
  Text is a soft signal, so a miss is manual review, never a hard fail. Renders in the
  routing barcode section. FPP/FPA labels (Premium group) now get ST-LOC-01 too.
- Location Master File validity remains out of scope (no LMF data in the app).
- Checklists updated (ST-LOC-01/02/03 coverage); 4 new end-to-end tests; golden baseline
  re-captured for the express fixture (ST-LOC-02 pass -> manual review, reviewed).

v1.10.8 - colour-coded string no longer bleeds past its box
-----------------------------------------------------------
- Fixed-width payloads (StarTrack QR) contain long runs of preserved spaces for blank
  fields; with white-space: pre-wrap those trailing spaces hang past the container edge,
  dragging their coloured segment background outside the box. Switched the segmented code
  block to white-space: break-spaces so space runs wrap like characters and every colour
  stays inside the box.

v1.10.7 - review bookmarks flow as a compact pill row
-----------------------------------------------------
- Review bookmarks now wrap as a horizontal pill row (like the section pills) instead of
  one full-width chip per line, so nine bookmarks take ~3 rows inside the sticky nav card
  instead of nine. Chips are slightly smaller (rounded-pill shape, 15px status icon).
- Bookmarks sort by severity: fails first, then warnings, then manual reviews.

v1.10.6 - thin verdict banner; no more overlap with the section pills
---------------------------------------------------------------------
- The sticky "Audit result" banner is now a thin single-row bar (~50px: label and verdict
  side by side at 24px) instead of a ~115px stacked card, so it no longer covers the
  sticky section pills / bookmarks underneath it on failed labels.
- The quick-nav sticky offset moves up to match (72px -> 56px) and anchor scroll margins
  were retuned so bookmark jumps still land below the sticky stack.

v1.10.5 - clean sections hide their parse cards and spec reference text
-----------------------------------------------------------------------
- The per-barcode parse fact-cards (e.g. ATL number/counter/format/orientation, routing
  label/postcode/depot, freight article/consignment/product, the collapsed SSCC details)
  and the "Specification standard / example" reference paragraphs are now hidden when the
  section has no warnings or failures - the colour-coded string + field breakdown already
  carry that information for clean sections. Both reappear automatically when a section
  rule warns or fails, giving the reviewer the spec context next to the problem.

v1.10.4 - rule tables default to warnings & fails only
------------------------------------------------------
- Every per-section rule table now opens on the "Warnings & fails" filter instead of "All",
  so an all-pass section collapses to a one-line summary ("No warnings or failures in this
  section - N rules passed"). The All / Passed chips still expand the full rule list on
  demand, and failing rows stay visible by default so review-bookmark jumps keep working.

v1.10.3 - review bookmarks: accurate jumps + tinted chip styling
----------------------------------------------------------------
- Clicking a review bookmark or section pill now lands the target just below the sticky
  verdict banner + quick-nav stack instead of underneath it: anchor targets carry a
  scroll margin, the bookmark list collapses before the jump (so the sticky stack is at
  its final height when the scroll position is computed), and scrolling is smooth.
- Review bookmarks restyled: underlined links + grey MANUAL_REVIEW badges become tinted
  chips (amber for review/warning, red for fail) with the standard status icon.

v1.10.2 - QR parsed-field rows take over the colour legend
----------------------------------------------------------
- The StarTrack QR "Parsed QR payload fields" rows now carry the colour swatch matching
  their segment in the raw decoded string (same palette order), and the duplicate colour
  legend under the raw string is dropped - one place per field: colour, spec, value, status.
- Fields not present in the payload (e.g. optional trailing RA/TA number) render without a
  swatch, since they have no segment in the raw string.

v1.10.1 - slicker report header and section navigation
------------------------------------------------------
- Report header: small "ARTICLE NUMBER" eyebrow over a large mono article number with a
  one-click copy button; the mode/product/service/file facts become labelled chips
  (muted label + strong value) instead of bold-colon pills.
- Section quick-nav: plain-blue underlined links + repeated PASS badges replaced with
  quiet pills - a small status dot per section (green/amber/red/grey), with review/fail
  sections tinting the whole pill so problems stand out while passing sections stay calm.

v1.10.0 - QR-style field breakdown for every barcode; audit-mode section retired
--------------------------------------------------------------------------------
The StarTrack 2D QR "parsed payload fields" layout is now the standard breakdown for every
barcode on both carriers.
- Every decoded barcode (eParcel article, GS1-128 linear, GS1 DataMatrix, eParcel SSCC,
  StarTrack freight item, routing, ATL and StarTrack SSCC) now renders its colour-coded raw
  string with a QR-style field table beneath it: one expandable line per field with a colour
  swatch matched to the raw string, the field name, its specification, the raw value and a
  pass/review/fail status icon. Char position and length sit in the expandable drawer.
- Field statuses re-use the engine's own reference maps and check functions (eParcel
  product/service maps, weighted mod-10 article check digit, GS1 mod-10 SSCC check digit,
  StarTrack product/label-code maps) - display only, no rule-set changes.
- The plain colour legend and the separate "GS1 DataMatrix AI breakdown" cards are replaced
  by the field tables (same information, one place).
- The "Selected audit mode" section is removed from the report; the header already shows the
  selected mode. It only reappears (slim, rule rows only) if a mode check fails, so wrong-toggle
  failures stay visible and bookmarkable.

v1.9.3 - lean pass: drop unused legacy OCR cores (~24 MB) and dead code
-----------------------------------------------------------------------
Over-engineering audit applied; no behaviour change intended.
- Removed the six legacy (non-LSTM) tesseract core variants from public/tesseract-core/ (~24 MB
  per shipped copy). The app creates its OCR worker in LSTM_ONLY mode so these were never
  requested; scripts/sync-ocr-assets.mjs now syncs only the *-lstm variants. tesseract.js fails
  loudly ("Legacy model requested but code missing.") if legacy mode is ever introduced.
- Deleted the dead validateServiceProduct() (superseded by the serviceProductCompatible rule
  function) and the orphaned scripts/audit-harness.mjs (golden corpus covers it).
- The report's article segmentation now derives its field slicing from the audit engine's
  article parser instead of a hand-copied slice table (one source of truth; display remains
  faithful to the scanned string). Dropped the speculative 18-char article form the engine
  never recognised.
- Collapsed the ZXing-WASM bounding-box corner min/max block into a small helper.

v1.9.2 - report detail: copy icons, full eParcel/AI-91 element breakdown, frozen verdict
----------------------------------------------------------------------------------------
Incremental refinements to the redesigned report (issues #15, #22, #23, #25).
- The eParcel AI 91 payload is now broken into its individual spec elements instead of one opaque
  block: the article ID splits into MLID, consignment serial, article count, product code, service
  code, postage-paid indicator and check digit, and any trailing AusPost AIs packed after the
  article with no separator (420 postcode, 92 DPID, 8008 date/time) are parsed out as their own
  colour-coded segments. The faithfulness guard still guarantees the segments reproduce the decoded
  value exactly.
- Barcode copy controls are now a clipboard icon (green tick on success) rather than a text button,
  on both the per-barcode list and the segmented-code panel (issue #15).
- The optional Get Shipments payload and SSCC extension/prefix inputs are collapsed behind an
  "Additional provided data" dropdown so the upload form stays focused (issue #23).
- The overall PASS / REVIEW / FAIL verdict banner is frozen (sticky) at the top of the report while
  scrolling long reports (issue #25).

v1.9.1 - colour-coded raw strings for every barcode + warm theme
----------------------------------------------------------------
Every decoded barcode now shows its raw string colour-segmented by field, and the app adopts the
warm cream/paper theme from the report mockups.
- Each raw decoded value is split into colour-coded field segments by the barcode's fixed format and
  field lengths, operating on the literal scanned value (with a legend mapping colour to field). The
  separate duplicate "field map" panels are removed - the raw string itself is now the colour map.
- Coverage: StarTrack QR (24 fixed-width fields), freight item (despatch/connote-seq/product/item),
  routing (label code/postcode/depot and the GS1 421 form), ATL (C + counter), AI 00 SSCC
  (AI/extension/prefix+serial/check), eParcel GS1-128 linear (AI 01 GTIN + AI 91 article) and bare
  article IDs, and GS1 DataMatrix (AI 01/91/420/92/8008) - the DataMatrix had no colour map before.
- A faithfulness guard guarantees the coloured segments always reproduce the decoded value exactly;
  an unrecognised value falls back to a single coloured block rather than dropping characters.
- Theme: warm cream page, flat white cards with warm borders at 12px radius, status badges and icons
  re-skinned to green tick (pass) / amber dash (review) / red cross (fail).

v1.9.0 - report redesign: per-field lines, status icons, collapsible detail
---------------------------------------------------------------------------
The audit report is reorganised so each barcode reads as plain language first, with the engineering detail one click away.
- The StarTrack 2D QR breakdown is now one expandable line per field: field name, the plain-English specification, the raw decoded value and a status icon. The rule id and char position (e.g. ST-QR-F02, position 31, length 4) move into the expanded drawer so the line itself stays readable.
- A single status-icon vocabulary across the whole report - green tick (pass), amber dash (review) and red cross (fail) - replacing the previous coloured status dot.
- SSCC details (extension/check-digit cards plus the SSCC field map) are collapsed behind an "SSCC details" button in the freight-item section; the freight item field map stays visible.
- The StarTrack product/label-code and eParcel service-code reference matrices now start collapsed behind their existing button instead of open.

v1.8.1 - colour-coded barcode field maps
----------------------------------------
Every decoded barcode now renders a colour-coded "field map" above its breakdown: each data element is highlighted in a distinct colour with a legend mapping colour to field, so reviewers can see at a glance which character ranges map to which validated field (e.g. freight item: Despatch ID, Connote sequence, Product code, Item sequence).
- New SegmentedCode component + per-barcode segment builders for the StarTrack QR (sliced by fixed-width position), freight item, routing, ATL and AI 00 SSCC barcodes, and the eParcel GS1-128 article ID.
- The QR "Parsed QR payload fields" table (from v1.8.0) is unchanged and sits below the colour map; the two together give the highlight + full list breakdown.

v1.8.0 - StarTrack QR field-by-field exposure (issue #16)
--------------------------------------------------------
The StarTrack 2D QR report previously showed only a single "decoded" check and hid every parsed field, so a QR that decoded but did not match the fixed-width layout (e.g. an SSCC-retailer QR with a different field order) reported a misleading "not decoded" failure with no detail.
- Any decoded QR long enough to carry the mandatory fields (>= 67 chars) is now sliced against the MOS v9 fixed-width positions and exposed field-by-field, even when non-conforming, so the failing positions are visible instead of hidden.
- The "Parsed QR payload fields" table now shows each field's validation criteria alongside its position, parsed value and pass/fail check.
- ST-QR-03 continues to flag a payload shorter than the 290-character fixed width; the per-field format rules (postcode, connote, product, etc.) show exactly which positions do not conform.
- Confirmed against issue #16: that QR is non-conforming to the MOS v9 suburb-first layout (receiver suburb/postcode appear at the end, not positions 1/31) and is now reported field-by-field rather than as "not decoded".

v1.7.9 - bar count scan-quality warning
---------------------------------------
ST-FRT-09 no longer skips silently when the freight barcode's bar count cannot be measured reliably (low contrast or inconsistent scanlines). It now reports a warning that names the likely scan-quality cause and recommends the original PDF or a 300 DPI export, so an unconfirmed compression check is always visible in the report. A wrong count still warns with the 61-vs-70 explanation; neither case ever fails the label.

v1.7.8 - freight barcode bar count (compression evidence)
---------------------------------------------------------
A Code 128 symbol's bar count is fixed by its encodation: the 20-character StarTrack freight item barcode with the mandated Code B/C compression always prints exactly 61 bars (19 symbol characters x 3 bars + 4 stop bars), while an uncompressed all-Code-B symbol prints 70. This is the first symbol-level compression check - the v1.7.7 rules validate the decoded text, which is identical either way.
- The scan pipeline now measures the bar count of every decoded Code 128 symbol from three scanlines across its bounding box (median, with contrast and agreement guards; unreliable measurements are discarded rather than guessed).
- New rule ST-FRT-09 compares the measured count against 61. Per the warning-only design: a mismatch reports a WARNING for manual verification, never a label fail, because image quality affects the count. Labels where no reliable count could be measured skip the check silently.
- Verified against generated symbols: the compressed freight value measures exactly 61 bars (routing 40, ATL 31 for reference).
- 9 new tests (106 total) covering the pure scanline counter, warning-not-fail behavior, skip-when-unmeasured and the end-to-end ride from detected barcode to rule result.

v1.7.7 - compression rules for all StarTrack Code 128 barcodes (issue #8)
-------------------------------------------------------------------------
MOS v9 defines a Code B/C compression pattern for every StarTrack Code 128 barcode, but only the freight item barcode was checked (ST-FRT-04). Two new rules close the gap:
- ST-RTE-09: routing barcode compression (3 chars Code B label code + 4 Code C postcode + remaining Code B depot/port). The GS1 421 routing form used on SSCC labels has its own structure and is exempt.
- ST-ATL-06: ATL barcode compression (2 chars Code B + 8 Code C, i.e. literal C + 9 digits).
- The SSCC barcode's pure-Code-C requirement was already enforced by the digits-only SSCC format rules.
As with ST-FRT-04, the rules assert the character-class consequence of the subset pattern visible after decoding; physical subset switching inside the symbol still needs a print-time verifier. Checklist rows ST-RTE-09 and ST-ATL-06 added (and the stale ST-RTE-04 row corrected); 7 new tests (97 total).

v1.7.6 - senior review readiness
--------------------------------
Prepares the repository for senior application and security review (board items R01-R08 in BOARD.md):
- Adversarial input hardening, found by probing and fixed: extracted-text lines are now capped in length and count (the postcode regex backtracked quadratically - a crafted 40k-character line took about a second); pasted payload flattening is iterative with a 20k-entry cap (a JSON payload nested 5k deep previously crashed with an uncaught RangeError). Both behaviors are pinned by the new tests/adversarial.test.mjs (90 tests total).
- Fixed an S12 regression where the dangerous-goods prefix-stripping regex lost its escape characters when converted to a template string; this was also the cause of the first CI failure on main.
- start-auditer.bat no longer invokes PowerShell with -ExecutionPolicy Bypass: health checks use curl.exe (Windows 10 1803+) with a plain batch retry loop, and the stale hardcoded version banner is gone.
- Supply chain: GitHub Actions pinned to commit SHAs; a CycloneDX SBOM for the full build-time tree is committed at docs/security/sbom.cyclonedx.json and regenerated each release via npm run sbom.
- Documentation: docs/security/threat-model.md (data flow, trust boundaries, data-handling statement, accepted risks) and security-assessment-v1.7.6.md with a disposition of every v1.6.8 finding. README corrections: stale TypeScript and HTML-report-export claims removed, project file map updated to the current module layout.
- Resources/ example labels swept for customer data: synthetic test data throughout; two low-risk items flagged for owner confirmation (a real-looking recipient name in PP.pdf and a mobile number in EXP.pdf, both consistent with internal test accounts).

v1.7.5 - coding standards uplift
--------------------------------
No behavior changes for end users; this release is engineering hygiene (board items S01-S17 in BOARD.md):
- Tooling: ESLint flat config + Prettier (one-time format), .gitattributes line-ending policy, GitHub Actions CI with lint/format/test/build and a dist-drift gate enforcing the committed-build rule, and an engines requirement of Node 20.10+.
- Structure: main.jsx split into src/scanner/ modules (canvas utils, decode engines, label preview images, file pipeline); auditEngine's reference data and identity-gated payload comparison moved to src/audit/; App workflow state consolidated into a single reducer.
- Consistency: stable React list keys, gated scanner debug logging, named tuning constants, the AU state list single-sourced between rule JSON and text extraction ({{constant}} template support in the rule engine), and JSDoc on all exported functions.
- Hygiene: async-only file serving in server.mjs, README dependency assessment refreshed (stale TypeScript entries removed; tesseract.js 7.0.0 and @tesseract.js-data/eng 1.0.0 documented and pinned exact), and the smoke tests migrated to the built-in node:test runner (80 tests, including a previously unwired parser test file).

v1.7.4 - security hardening
---------------------------
- DNS rebinding protection: server.mjs now rejects requests whose Host header is not a loopback hostname (127.0.0.1, localhost, [::1]), blocking malicious websites from driving a victim's browser at the local server via rebound DNS.
- Added Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Resource-Policy: same-origin and X-Permitted-Cross-Domain-Policies: none response headers.
- The HTML report builders now emit a Content-Security-Policy meta tag (default-src 'none'; img-src data:; style-src 'unsafe-inline') so no script can execute in a downloaded or shared report document. Review finding: the report download functions are currently not wired to any UI control (the in-browser rule report replaced them), so they are tree-shaken from the shipped bundle; the CSP protects them if reinstated.
- pdf.js document loading sets isEvalSupported: false, closing the font/PostScript eval path (CVE-2024-4367 class) as defense in depth for untrusted PDF uploads.
- Review confirmed: path-traversal containment (plain, percent-encoded and backslash vectors all serve the app shell), GET/HEAD-only methods, comprehensive HTML escaping in all three report builders, no dangerouslySetInnerHTML, guarded JSON parsing of pasted payloads, and npm audit --omit=dev reporting 0 production vulnerabilities. Two moderate advisories remain in dev-only tooling (esbuild via Vite 5 dev server); they do not affect the shipped app and the pinned-dependency policy defers the breaking Vite major bump.

v1.7.3 - input preprocessing (issue #7)
---------------------------------------
- Auto-orientation: rotated or upside-down uploads are detected from decoded barcode symbol orientation and corrected before validation. Each rotation candidate is verified by re-decoding a downscaled probe before the full-resolution page is rotated.
- Multi-label sheets: pages larger than any single label format (A4 and up) are scanned for white gutters; each detected label region is cropped with a small margin and audited as an individual label with proportional physical dimensions. Aspect-ratio and ink-share guards prevent single labels from being split.
- Rotated or segmented PDF pages fall back to per-label OCR because the page-level PDF text layer cannot be trusted after those transforms.
- New tests/smoke-preprocess.mjs covers orientation selection and segmentation; verified against rotated and composited real label samples.

v1.7.2 - image input guidance and rule review corrections (issues #2-#6)
------------------------------------------------------------------------
- Low-resolution raster uploads now produce an explicit warning (EP-IMG-01 / ST-IMG-01) with estimated DPI and guidance to upload the original PDF or a 300 DPI export, instead of opaque decode failures.
- Visible article ID extraction tightened against watermark interference; visible-text vs barcode mismatches report as manual review rather than hard fails (issue #4).
- ST-FRT-04 added: validates the freight barcode character structure implied by the Code 128 B/C/B/C compression pattern (issue #5).
- SSCC parsing anchored to the start of the payload so zero-padded digit runs inside StarTrack QR data can no longer produce false SSCC check-digit failures (issue #6).
- StarTrack unit-type map confirmed spec-exact against MOS v9 Appendix A.
- App version is injected from package.json at build time, so the page version always matches the release (issue #3).

v1.7.1 - JSON rule sets and rule-by-rule report
-----------------------------------------------
- Validation rules externalised to declarative JSON rule sets under rules/ (eParcel and StarTrack, base plus per-product variants) evaluated by a generic rule engine.
- New report UI shows each rule with its input data, plain-English logic, expandable JSON definition, and outcome; tags are reserved for failures and review items.
- Spec-derived audit checklists added under docs/checklists/ for both carriers.
- Prebuilt dist/ committed so the target environment only needs node server.mjs.

---

BarcodeAuditer v1.7.0 Release Notes
===================================

Release focus
-------------
This release introduces the explicit audit mode workflow for eParcel and StarTrack label review while preserving the security hardening delivered in the v1.6.8 and v1.6.9 release line.

Security assurance
------------------
- Preserves the local-only desktop wrapper security design.
- The local server continues to bind to 127.0.0.1 only.
- No administrator install, Windows service, registry write, Program Files write, external API call, or telemetry path is introduced.
- Security headers remain enabled in server.mjs:
  - X-Content-Type-Options: nosniff.
  - X-Frame-Options: DENY.
  - Referrer-Policy: no-referrer.
  - Restrictive Permissions-Policy.
  - Restrictive Content-Security-Policy.
- The Content-Security-Policy remains locked down with a targeted wasm-unsafe-eval allowance for ZXing barcode decoding compatibility.
- Runtime safety limits remain in place for batch file count, label file size, PDF pages, image pixel count, and optional payload size.
- Temporary object URLs are still revoked after image decode.
- npm.cmd audit --omit=dev was checked before this release draft and reported 0 production vulnerabilities.

UI and audit workflow updates
-----------------------------
- Adds explicit audit mode controls for eParcel and StarTrack.
- Adds explicit label format controls for Standard article format and SSCC article identifier.
- Replaces the old carrier-specific upload boxes with one compact upload/drop zone.
- Wrong carrier or format selection now fails the audit mode check while still running the full report.
- Adds optional SSCC extension digit and GS1 company prefix inputs for SSCC account validation.
- Keeps raw barcode data visible in the audit detail.
- Keeps the collapsible JSON payload evidence for later review.
- Improves the report table around required fields, decoded values, Get Shipments values, and result state.
- Retains the existing cropped barcode preview placement and right-side audit report layout.

Barcode evidence updates
------------------------
- Fixes additional barcode classification so required StarTrack QR/DataMatrix content is not incorrectly flagged as an internal barcode.
- Additional decoded barcodes are retained as evidence only and are not used to satisfy required checks.
- The additional barcode section now appears only when decoded barcode count exceeds the selected specification expectation:
  - StarTrack: more than 3 decoded barcodes.
  - eParcel: more than 2 decoded barcodes.

Known review limits
-------------------
Some checks still require external data or physical measurement and remain review-context rather than fully automated pass/fail:
- StarTrack Location Master File depot/port validation.
- Barcode verifier grade.
- Quiet-zone, bar-width and print-grade measurement from a real thermal label.
- Physical label stock colour, gloss, and printer calibration.

Verification completed for release pack
---------------------------------------
- npm.cmd audit --omit=dev: 0 production vulnerabilities.
- npm.cmd run build: passed.
- build-portable-release.bat: passed.
- Portable ZIP: release\BarcodeAuditer-v1.7.0-windows-x64-portable.zip.
- SHA256: 2B09BC1D6069D74823FE8B986A5E1A18DCCF4B444BDE2BEE2B603090700B87D8.
