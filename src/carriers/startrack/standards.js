// Specification standard / example text per StarTrack validation id, shown in the report
// beneath each rule row (looked up via src/report/standards.js).
export const STARTRACK_STANDARD_EXAMPLES = {
  ST_LABEL_SIZE:
    'StarTrack despatch labels are normally 100mm x 150mm. Optional extended despatch labels may be 100mm x 200mm. Controlled Returns/Transfer labels may be 150mm x 100mm. The audit allows tolerance for PDF rounding.',
  ST_TEXT_EXTRACTED:
    'Digital PDF/image should expose or render StarTrack label content such as CONNOTE, receiver, sender, routing and barcode zones.',
  ST_LOGO_HEADER: 'The P-StarTrack logo must appear in the label header.',
  ST_LABEL_CODE_VISIBLE:
    'A 3-character StarTrack label code such as EXP, PRM, ARL, RET, RE2, APT or TSE should appear in the header.',
  ST_CONNOTE_VISIBLE: 'CONNOTE should be visible in the header and support up to 20 characters.',
  ST_RECEIVER_BLOCK:
    'Receiver details must include full name/business/address/suburb/state/postcode and phone where present.',
  ST_SENDER_BLOCK:
    'Sender details must include sender name, phone, address, suburb and postcode beneath the routing barcode.',
  ST_WEIGHT_PRESENT: 'Weight should be displayed in kg in the item details area.',
  ST_QR_PRESENT:
    'StarTrack 2D QR barcode must appear on all labels. It uses fixed-width fields and error correction level L.',
  ST_FREIGHT_BARCODE_PRESENT:
    'Freight item barcode is mandatory: either StarTrack 20-character Code128 XXXZ99999999AAA99999 or GS1 AI 00 SSCC.',
  ST_ROUTING_BARCODE_PRESENT:
    'Routing barcode is mandatory: StarTrack SSS9999DD/DDD or GS1 421/403 routing barcode for AU domestic SSCC labels.',
  ST_PRODUCT_KNOWN: 'Known StarTrack product codes include EXP, PRM, FPP, ARL, FPA, RET, RE2, APT and TSE.',
  ST_CONNOTE_STRUCTURE:
    'StarTrack connote number format is four-character Despatch ID plus eight-digit incrementing number.',
  ST_ITEM_SEQUENCE: 'StarTrack freight item barcode ends with a five-digit item number.',
  ST_CONNOTE_MATCH: 'Visible CONNOTE should match the connote component from the freight item barcode.',
  ST_SSCC: 'StarTrack SSCC uses GS1 AI 00 + 18 digit SSCC and must have a valid GS1 check digit.',
  ST_ROUTE_LABEL_CODE: 'Routing label code should be a valid StarTrack label code such as EXP, PRM or ARL.',
  ST_ROUTE_POSTCODE: 'Routing barcode includes a four-digit receiver postcode, or 9901 for NZ Premium consignments.',
  ST_ROUTE_PRODUCT_MATCH: 'Routing label code should match the product label code: EXP→EXP, PRM/FPP→PRM, ARL/FPA→ARL.',
  ST_QR_MANDATORY:
    'StarTrack QR fixed-width payload contains mandatory receiver, connote, freight item, product, quantity, weight, despatch date, unit, depot, DG and movement fields.',
  ST_QR_POSTCODE: 'QR receiver postcode must be four digits.',
  ST_QR_PRODUCT: 'QR product code must be a valid 3-character StarTrack product code.',
  ST_QR_DG: 'QR Dangerous Goods Indicator permitted values are Y or N.',
  ST_QR_MOVEMENT: 'QR Movement Type permitted values are N (Despatch), C (Controlled Return), or T (Transfer).',
  ST_QR_UNIT:
    'Unit type must be permitted for the StarTrack product; examples include CTN, BAG, ITM, PAL, SAT and SKI.',
  ST_QR_ATL: 'ATL number format is C999999999 when Authority To Leave is selected.',
  ST_ATL_BARCODE: 'Optional StarTrack ATL barcode format is C999999999.',
  ST_ATL_COUNTER:
    'ATL sequential counter starts at 000000001 and increments per consignment requiring Authority To Leave.',
  ST_SSCC_PRODUCT_RULE:
    'For StarTrack SSCC, product is not encoded in the SSCC article identifier; use QR/routing/manifest context for product where available.'
};
