// Spec-derived "standard / example" text keyed by eParcel validation id, shown under
// each rule row in the report so reviewers can compare the finding with the spec.
export const EPARCEL_STANDARD_EXAMPLES = {
  A6_SIZE:
    'eParcel labels should be supplied as an A6-style PDF page. The audit accepts either true A6 sizing (105mm x 148mm) or common thermal-label sizing (100mm x 150mm), in portrait or landscape, with tolerance for PDF rounding.',
  TEXT_EXTRACTED:
    'Digital PDF/image should expose or render label content such as DELIVER TO, SENDER/FROM, AP Article ID and barcode zones.',
  LABEL_TYPE:
    'Parcel Post / Express Post branding may be image-only. Product family is verified primarily from decoded product code when text extraction cannot expose the header.',
  VISIBLE_ARTICLE_ID: 'AP Article ID: 2JD569514501000910903',
  VISIBLE_CONS_NO: 'Con No 2JD5695145',
  ADDR_TO_PRESENT: 'DELIVER TO block with address ending in suburb/state/postcode, e.g. CHULLORA NSW 2190.',
  ADDR_FROM_PRESENT: 'SENDER/FROM block with address ending in suburb/state/postcode, e.g. RICHMOND VIC 3121.',
  ADDR_SUBURB_STATE_POSTCODE: 'Suburb, state and postcode on one line, capitalised, no comma: CHULLORA NSW 2190.',
  DG_DECLARATION: 'Aviation Security and Dangerous Goods Declaration present as a separate declaration area.',
  WEIGHT_PRESENT: 'Weight displayed as a kg value, e.g. 1.00kg.',
  GS1_128_PRESENT:
    'Required GS1-128 Linear Barcode must decode and contain AI 01 + Australia Post GTIN and AI 91 + article component.',
  DATAMATRIX_PRESENT:
    'Required GS1 DataMatrix Barcode must decode and contain AI 01, AI 91 and additional delivery data.',
  ARTICLE_PARSE:
    'Standard article ID: MLID + 7-digit consignment suffix + article count + product + service + postage paid + check digit.',
  GS1_PREFIX: 'Decoded GS1 barcode begins with AI 01 and Australia Post GTIN: 0199312650999998.',
  AI91: 'Decoded GS1 barcode includes AI 91 followed by the eParcel article component.',
  MLID: 'MLID is 3 or 5 uppercase alphanumeric characters, e.g. 2JD or 1JDQ1.',
  CONSIGNMENT: 'Consignment suffix is 7 digits; consignment ID example: 2JD5695145.',
  CONSIGNMENT_MATCH: 'Visible Con No should match MLID + 7 digit consignment suffix parsed from AP Article Id.',
  ARTICLE_COUNT: 'Article count is 01 to 20.',
  POSTAGE_PAID: 'Postage paid indicator is 0.',
  CHECK_DIGIT: 'Check digit is calculated from the article ID excluding the final digit.',
  SERVICE_KNOWN: 'Known service code example: 09 — Non-Signature + ATL.',
  PRODUCT_KNOWN: 'Known product code example: 00091 — Parcel Post (Non-Signature).',
  SERVICE_PRODUCT_MATCH: 'Service 09 supports products 00091 and 00087.',
  DM_POSTCODE: 'GS1 DataMatrix includes AI 420 + 4 digit delivery postcode, e.g. 4202190.',
  DM_8008: 'GS1 DataMatrix includes AI 8008 + label generation date/time in YYMMDDHHMMSS format.',
  DM_DPID:
    'AI 92 DPID is optional; if present it must be 8 digits and not 00000000. If unavailable, omit AI 92 and its separator.',
  DM_SEPARATORS:
    'GS1 FNC1/group separators must be encoded as control characters, not literal text such as FNC1, _1 or $.',
  SSCC: 'SSCC uses AI 00 and is treated differently from standard eParcel article IDs.'
};
