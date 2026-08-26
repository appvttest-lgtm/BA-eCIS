import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  analyzeArticleCandidate,
  auditLabel,
  calculateEparcelCheckDigit,
  groupValidations,
  parseSsccBarcode,
  PRODUCT_CODE_MAP,
  SERVICE_CODE_MAP,
  SERVICE_TO_PRODUCT_MAP,
  STARTRACK_LABEL_CODE_MAP,
  STARTRACK_PRODUCT_CODE_MAP,
  STARTRACK_QR_FIELDS
} from './auditEngine.js';
import { RuleReport, StatusIcon } from './reportView.jsx';
import { FORMAT_KIND, isDataMatrixBarcode, isLinearBarcode, isQrBarcode } from './scanner/barcodeTypes.js';
import { createDetector } from './scanner/decoders.js';
import { isStarTrackFreightItemValue, isStarTrackAtlValue, isStarTrackRoutingValue } from './scanner/labelImages.js';
import { processImageLabels, processPdfLabels, yieldToBrowser } from './scanner/pipeline.js';
import australiaPostLogoUrl from './assets/Australia_Post_logo_logotype.png';
import './styles.css';

const APP_TITLE = 'Australia Post - eCommerce Integration Label Auditor';
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v?';
const FEEDBACK_URL = 'https://github.com/appvttest-lgtm/BA-eCIS/issues/new/choose';
const ACCEPTED_LABEL_FILE_TYPES = 'application/pdf,image/png,image/jpeg,image/webp,image/bmp';
const LABEL_FAMILY_NAMES = { eparcel: 'eParcel', startrack: 'StarTrack' };
const LABEL_FORMAT_NAMES = { standard: 'Standard article format', sscc: 'SSCC article identifier' };
const MAX_FILES_PER_BATCH = 20;
const MAX_LABEL_FILE_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Returns the display name shown for a carrier-specific upload/audit path. */
function labelFamilyName(labelFamily) {
  return LABEL_FAMILY_NAMES[labelFamily] || LABEL_FAMILY_NAMES.eparcel;
}

function imageBoxCaption(images = {}, kind = FORMAT_KIND.datamatrix) {
  if (kind === FORMAT_KIND.qr) {
    const box = images.qrBarcodeBox;
    const label = 'Detected QR barcode location for this label';
    if (!box) return 'QR fallback crop used for scanning/assessment';
    return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
  }
  if (kind === 'startrack-routing') {
    const box = images.routingBarcodeBox;
    const label = 'Detected StarTrack routing barcode location for this label';
    if (!box) return `${label} · fallback crop only`;
    return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
  }
  if (kind === 'startrack-atl') {
    const box = images.atlBarcodeBox;
    const label = 'Detected StarTrack ATL barcode location for this label';
    if (!box) return `${label} · fallback crop only`;
    return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
  }
  if (kind === 'startrack-freight') {
    const box = images.freightBarcodeBox;
    const label = 'Detected StarTrack freight item barcode location for this label';
    if (!box) return `${label} · fallback crop only`;
    return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
  }
  const box = kind === FORMAT_KIND.datamatrix ? images.dataMatrixBox : images.linearBarcodeBox;
  const label =
    kind === FORMAT_KIND.datamatrix
      ? 'Detected GS1 DataMatrix location for this label'
      : 'Detected linear barcode location for this label';
  if (!box) return `${label} · fallback crop only`;
  return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
}

const STANDARD_EXAMPLES = {
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
  SSCC: 'SSCC uses AI 00 and is treated differently from standard eParcel article IDs.',
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

function standardForValidation(v) {
  const id = String(v?.id || '');
  const direct = STANDARD_EXAMPLES[id];
  if (direct) return direct;
  const key = Object.keys(STANDARD_EXAMPLES).find(k => id.startsWith(k));
  if (key) return STANDARD_EXAMPLES[key];
  return v?.expected || 'Follow the Australia Post eParcel label/barcode rule for this field.';
}

function selectedServiceCodes(audit) {
  return [...new Set((audit?.articles || []).map(a => a.serviceCode).filter(Boolean))];
}

function selectedProductCodes(audit) {
  return [...new Set((audit?.articles || []).map(a => a.productCode).filter(Boolean))];
}

function auditHasSsccOnly(audit) {
  const articles = audit?.articles || [];
  return (
    audit?.selectedAuditMode?.labelFormat === 'sscc' ||
    (articles.some(a => a?.type === 'sscc') && !articles.some(a => a?.type === 'eparcel-standard'))
  );
}

function isSsccArticle(article) {
  return article?.type === 'sscc';
}

// The service matrix is derived from the audit reference data, so a service code can never be valid
// for the audit yet missing from this table. Only presentation-only detail lives here: the printed
// row order, the ticked columns, and the wine services' product-name override.
const SERVICE_FLAG_NAMES = ['safeDrop', 'signature', 'atl', 'partial', 'noSignature'];
const SERVICE_PAYLOAD_KEYS = ['authority_to_leave', 'allow_partial_delivery', 'safe_drop_enabled'];
const WINE_PRODUCT_NAMES = { '00093': 'Parcel Post Signature (Wine)' };

// [service code, ticked columns, display overrides], in the order the matrix is printed.
// Services 09 and 82 deliberately tick fewer columns than their payload flags imply — the printed
// matrix, not the Get Shipments payload, decides the ticks.
const SERVICE_ROW_TICKS = [
  ['03', ['signature']],
  ['08', ['atl']],
  ['45', ['signature', 'partial']],
  ['15', ['atl', 'partial']],
  ['50', ['safeDrop']],
  ['51', ['safeDrop', 'partial']],
  ['09', ['partial', 'noSignature']],
  ['49', ['signature'], { display: '49*', productNames: WINE_PRODUCT_NAMES }],
  ['81', ['signature'], { productNames: WINE_PRODUCT_NAMES }],
  ['82', ['atl'], { productNames: WINE_PRODUCT_NAMES }],
  ['83', ['safeDrop'], { productNames: WINE_PRODUCT_NAMES }]
];

/** Ticks implied by the payload flags, used only for a service code with no printed row yet. */
function inferredServiceTicks(service) {
  const ticks = [];
  if (service.safe_drop_enabled) ticks.push('safeDrop');
  if (!service.authority_to_leave && !service.safe_drop_enabled) ticks.push('signature');
  if (service.authority_to_leave) ticks.push('atl');
  if (service.allow_partial_delivery) ticks.push('partial');
  return ticks;
}

/** Builds one matrix row: ticks from the list above, everything else from the reference data. */
function buildServiceReferenceRow(code, ticks, { display, productNames } = {}) {
  const service = SERVICE_CODE_MAP[code] || {};
  return {
    serviceCode: display || code,
    matchCode: code,
    flags: Object.fromEntries(SERVICE_FLAG_NAMES.map(name => [name, ticks.includes(name)])),
    apiPayload: Object.fromEntries(SERVICE_PAYLOAD_KEYS.map(key => [key, service[key] === true])),
    apiNote: service.requires_identity_on_delivery
      ? `IDENTITY_ON_DELIVERY feature must be used with an id_capture_type value of “${service.id_capture_type}”.`
      : null,
    products: (SERVICE_TO_PRODUCT_MAP[code] || []).map(productCode => [
      productCode,
      productNames?.[productCode] || PRODUCT_CODE_MAP[productCode] || 'Unknown product code'
    ])
  };
}

const SERVICE_REFERENCE_ROWS = [
  ...SERVICE_ROW_TICKS.map(([code, ticks, overrides]) => buildServiceReferenceRow(code, ticks, overrides)),
  // A service code added to the audit rules without a printed row still gets a row here, so a decoded
  // service/product pair always has something to highlight. Give it explicit ticks above.
  ...Object.keys(SERVICE_TO_PRODUCT_MAP)
    .filter(code => !SERVICE_ROW_TICKS.some(([listed]) => listed === code))
    .map(code => buildServiceReferenceRow(code, inferredServiceTicks(SERVICE_CODE_MAP[code] || {})))
];

function xMark(value) {
  return value ? 'X' : '';
}

function servicePayloadText(row) {
  const payload = `"authority_to_leave": ${row.apiPayload.authority_to_leave},\n"allow_partial_delivery": ${row.apiPayload.allow_partial_delivery},\n"safe_drop_enabled": ${row.apiPayload.safe_drop_enabled}`;
  return row.apiNote ? `${payload}\n\n${row.apiNote}` : payload;
}

function decodedBarcodeList(audit, type) {
  const all = audit?.detectedBarcodes || [];
  if (type === 'datamatrix') return all.filter(isDataMatrixBarcode);
  if (type === 'qr') return all.filter(isQrBarcode);
  if (type === 'linear') return all.filter(b => isLinearBarcode(b) && !isDataMatrixBarcode(b) && !isQrBarcode(b));
  return all;
}

function starTrackRoutingBarcodeList(audit) {
  return decodedBarcodeList(audit, 'linear').filter(b => isStarTrackRoutingValue(b.rawValue));
}

function starTrackAtlBarcodeList(audit) {
  return decodedBarcodeList(audit, 'linear').filter(b => isStarTrackAtlValue(b.rawValue));
}

function starTrackFreightBarcodeList(audit) {
  return decodedBarcodeList(audit, 'linear').filter(b => isStarTrackFreightItemValue(b.rawValue));
}

function barcodeDisplayName(b) {
  const value = String(b?.format || b?.symbology || '').toLowerCase();
  if (value.includes('data')) return 'GS1 DataMatrix';
  if (value.includes('qr') || b?.kind === FORMAT_KIND.qr) return 'QR Barcode';
  if (value.includes('128') || b?.kind === FORMAT_KIND.linear) return 'Linear / Code128';
  return b?.format || b?.symbology || 'barcode';
}

/** Assembles a labelled block per decoded barcode on the label, in report order, for
 *  the header "copy all" action:
 *
 *    Label:
 *    ------------------
 *    raw value
 *    ------------------
 *
 *  Raw values are kept verbatim (fixed-width QR payloads keep their padding) and
 *  deduped so a symbol decoded on multiple passes is copied once; anything not covered
 *  by a named group falls back to its display name. */
function allBarcodesCopyText(audit) {
  const groups =
    audit?.carrier === 'startrack'
      ? [
          ['StarTrack 2D QR barcode', decodedBarcodeList(audit, 'qr')],
          ['Routing barcode', starTrackRoutingBarcodeList(audit)],
          ['ATL barcode', starTrackAtlBarcodeList(audit)],
          ['Freight item barcode', starTrackFreightBarcodeList(audit)]
        ]
      : [
          ['Linear barcode (GS1-128)', decodedBarcodeList(audit, 'linear')],
          ['GS1 DataMatrix barcode', decodedBarcodeList(audit, 'datamatrix')],
          ['QR barcode', decodedBarcodeList(audit, 'qr')]
        ];
  const RULE = '-'.repeat(18);
  const seen = new Set();
  const blocks = [];
  const push = (label, b) => {
    const raw = String(b?.rawValue || '');
    const key = raw.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    blocks.push(`${label}:\n${RULE}\n${raw}\n${RULE}`);
  };
  for (const [label, list] of groups) for (const b of list || []) push(label, b);
  for (const b of audit?.detectedBarcodes || []) push(barcodeDisplayName(b), b);
  return blocks.join('\n\n');
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// --- Issue #7 preprocessing: orientation normalization & multi-label sheets ---

function getPrimaryArticle(audit) {
  return (audit?.articles || []).find(a => a?.type === 'eparcel-standard') || (audit?.articles || [])[0] || null;
}

function productFamilyForArticle(article) {
  if (isSsccArticle(article)) return 'SSCC label';
  const desc = String(article?.productDescription || '').toLowerCase();
  if (desc.includes('express')) return 'Express Post';
  if (desc.includes('parcel')) return 'Parcel Post';
  return article?.productDescription || 'Product not parsed';
}

function auditDisplayHeader(audit, index = 0) {
  if (audit?.carrier === 'startrack') {
    const article = getPrimaryArticle(audit);
    const qr = (audit?.startrack?.qrParses || [])[0];
    const freight = (audit?.startrack?.freightParses || [])[0];
    const route = (audit?.startrack?.routingParses || [])[0];
    const sscc = (audit?.startrack?.ssccParses || [])[0];
    const productCode = freight?.productCode || qr?.productCode || '';
    const productMeta = productCode ? STARTRACK_PRODUCT_CODE_MAP[productCode] : null;
    const labelCode = route?.labelCode || productMeta?.labelCode || audit?.labelFacts?.labelCode || '';
    const articleNumber =
      freight?.freightItemId ||
      article?.articleId ||
      (sscc ? `00${sscc.sscc}` : '') ||
      qr?.fields?.freightItemNumber ||
      (audit?.labelFacts?.articleIds || [])[0] ||
      `Label ${index + 1}`;
    const product =
      sscc && !productCode
        ? 'StarTrack SSCC label'
        : productMeta?.name || freight?.productName || qr?.productName || 'StarTrack product not parsed';
    return {
      article,
      articleNumber,
      product,
      productCode,
      productName: productMeta?.name || freight?.productName || qr?.productName || '',
      serviceCode: labelCode || 'not parsed',
      serviceName: route?.formatDescription || (productMeta?.labelCode ? `Label code ${productMeta.labelCode}` : ''),
      isSsccOnly: Boolean(audit?.startrack?.ssccOnly),
      filename: audit?.fileInfo?.filename || `Label ${index + 1}`,
      pageLabel: audit?.fileInfo?.sourcePdfPage
        ? `Page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}`
        : '',
      displayFile: `${audit?.fileInfo?.filename || `Label ${index + 1}`}${audit?.fileInfo?.sourcePdfPage ? ` — page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}` : ''}`,
      tabText: `${articleNumber} · ${product} · ${labelCode || 'no routing'}`
    };
  }
  const article = getPrimaryArticle(audit);
  const ssccOnly = auditHasSsccOnly(audit);
  const articleNumber =
    article?.articleId || article?.sscc || (audit?.labelFacts?.articleIds || [])[0] || `Label ${index + 1}`;
  const product = ssccOnly ? 'SSCC label' : productFamilyForArticle(article);
  const serviceCode = ssccOnly ? 'Not applicable' : article?.serviceCode || '';
  return {
    article,
    articleNumber,
    product,
    productCode: ssccOnly ? '' : article?.productCode || '',
    productName: ssccOnly ? 'SSCC label — product code not encoded' : article?.productDescription || '',
    serviceCode,
    serviceName: ssccOnly
      ? 'SSCC barcode does not encode eParcel service code'
      : SERVICE_CODE_MAP[article?.serviceCode]?.name || article?.serviceDescription || '',
    isSsccOnly: ssccOnly,
    filename: audit?.fileInfo?.filename || `Label ${index + 1}`,
    pageLabel: audit?.fileInfo?.sourcePdfPage
      ? `Page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}`
      : '',
    displayFile: `${audit?.fileInfo?.filename || `Label ${index + 1}`}${audit?.fileInfo?.sourcePdfPage ? ` — page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}` : ''}`,
    tabText: `${articleNumber} · ${product} · ${serviceCode || 'no service'}`
  };
}
function combinedAuditSummary(audits = []) {
  const totals = audits.reduce(
    (acc, audit) => {
      acc.total += audit?.summary?.total || 0;
      acc.passed += audit?.summary?.passed || 0;
      acc.failed += audit?.summary?.failed || 0;
      acc.manualReview += audit?.summary?.manualReview || 0;
      acc.decoded += audit?.detectedBarcodes?.length || 0;
      if (audit?.summary?.overallStatus === 'FAIL') acc.hasFail = true;
      if (audit?.summary?.overallStatus === 'REVIEW') acc.hasReview = true;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, manualReview: 0, decoded: 0, hasFail: false, hasReview: false }
  );
  totals.overallStatus = totals.hasFail ? 'FAIL' : totals.hasReview ? 'REVIEW' : 'PASS';
  totals.labelCount = audits.length;
  return totals;
}

/** Consignment ID detected for a label, for the rail file navigator. */
function auditConsignmentId(audit) {
  if (audit?.carrier === 'startrack') {
    return (
      audit?.startrack?.freightParses?.[0]?.connoteNumber ||
      String(audit?.startrack?.qrParses?.[0]?.fields?.connoteNumber || '').trim() ||
      (audit?.labelFacts?.consignmentIds || [])[0] ||
      ''
    );
  }
  return getPrimaryArticle(audit)?.consignmentId || (audit?.labelFacts?.consignmentIds || [])[0] || '';
}

function SectionTitle({ id, children }) {
  return (
    <h2 id={id}>
      <a className="section-link" href={`#${id}`}>
        {children}
      </a>
    </h2>
  );
}

function StandardLine({ children }) {
  return (
    <p className="standard-line">
      <strong>Specification standard / example:</strong> {children}
    </p>
  );
}

function ServiceCodeMatrix({ audit }) {
  const selectedServices = selectedServiceCodes(audit);
  const selectedProducts = selectedProductCodes(audit);
  return (
    <section className="card compact-card service-matrix-card">
      <SectionTitle id="service-code-reference">Service code reference</SectionTitle>
      <p className="muted small">
        Australia Post service-code/product-code matrix. The service and product decoded from the label are highlighted.
      </p>
      <div className="table-wrap service-matrix-wrap">
        <table className="service-matrix-table">
          <thead>
            <tr>
              <th>Service Code</th>
              <th>Safe Drop</th>
              <th>Signature on Delivery required</th>
              <th>Authority To Leave (ATL)</th>
              <th>Partial delivery allowed</th>
              <th>No signature allowed</th>
              <th>API payload / manifest flags</th>
              <th>Product Code</th>
              <th>Product Name</th>
            </tr>
          </thead>
          <tbody>
            {SERVICE_REFERENCE_ROWS.map(row => {
              const matchedService = selectedServices.includes(row.matchCode);
              return row.products.map(([productCode, productName], productIndex) => {
                // Only the label's actual service+product combination is marked "selected":
                // the same product code appears under many service rows, so a product-only
                // match must not light up rows whose service code is not on the label.
                const matchedProduct = matchedService && selectedProducts.includes(productCode);
                return (
                  <tr
                    key={`${row.serviceCode}-${productCode}`}
                    className={`${matchedService ? 'selected-row service-selected-row' : ''} ${matchedService && matchedProduct ? 'selected-combination-row' : ''}`}
                  >
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="service-code-cell">
                        <strong>{row.serviceCode}</strong>
                        {matchedService && <span className="selected-pill">selected</span>}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.safeDrop)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.signature)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.atl)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.partial)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="flag-cell">
                        {xMark(row.flags.noSignature)}
                      </td>
                    )}
                    {productIndex === 0 && (
                      <td rowSpan={row.products.length} className="payload-cell">
                        <pre>{servicePayloadText(row)}</pre>
                      </td>
                    )}
                    <td className={matchedProduct ? 'product-selected-cell' : ''}>
                      <strong>{productCode}</strong>
                      {matchedProduct && <span className="selected-pill">selected</span>}
                    </td>
                    <td className={matchedProduct ? 'product-selected-cell' : ''}>{productName}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <StandardLine>
        Service code and product code must be a valid supported combination from the Australia Post eParcel service
        matrix. Example: service 09 supports product 00091 Parcel Post (Non-Signature) and 00087 Express Post
        (Non-Signature).
      </StandardLine>
    </section>
  );
}

function getAuditSections(audit) {
  const grouped = audit ? groupValidations(audit.validations || []) : {};
  if (audit?.carrier === 'startrack') {
    const used = new Set([
      'audit-mode',
      'StarTrack QR barcode',
      'StarTrack routing barcode',
      'StarTrack ATL barcode',
      'StarTrack freight item barcode',
      'StarTrack product/article data',
      'label-layout',
      'address-format'
    ]);
    return {
      mode: grouped['audit-mode'] || [],
      label: grouped['label-layout'] || [],
      datamatrix: grouped['StarTrack QR barcode'] || [],
      routing: grouped['StarTrack routing barcode'] || [],
      atl: grouped['StarTrack ATL barcode'] || [],
      freight: grouped['StarTrack freight item barcode'] || [],
      linear: [
        ...(grouped['StarTrack routing barcode'] || []),
        ...(grouped['StarTrack ATL barcode'] || []),
        ...(grouped['StarTrack freight item barcode'] || [])
      ],
      service: grouped['StarTrack product/article data'] || [],
      text: grouped['address-format'] || [],
      other: Object.entries(grouped)
        .filter(([key]) => !used.has(key))
        .flatMap(([, items]) => items)
    };
  }
  const used = new Set([
    'audit-mode',
    'DataMatrix barcode analysis',
    'linear barcode analysis',
    'service-code',
    'sscc',
    'label-layout',
    'address-format'
  ]);
  return {
    mode: grouped['audit-mode'] || [],
    label: grouped['label-layout'] || [],
    datamatrix: grouped['DataMatrix barcode analysis'] || [],
    linear: grouped['linear barcode analysis'] || [],
    service: [...(grouped['service-code'] || []), ...(grouped['sscc'] || [])],
    text: grouped['address-format'] || [],
    other: Object.entries(grouped)
      .filter(([key]) => !used.has(key))
      .flatMap(([, items]) => items)
  };
}

function sectionTone(items = []) {
  if (items.some(v => v.status === 'fail')) return 'fail';
  if (items.some(v => v.status === 'manual_review' || v.status === 'warning')) return 'review';
  if (items.some(v => v.status === 'pass')) return 'pass';
  return 'neutral';
}

/** Clean sections hide their parse fact-cards and spec reference text; both surface only
 *  when the section carries a warning or failure the reviewer needs the context for. */
function sectionHasIssues(items) {
  const tone = sectionTone(items);
  return tone === 'fail' || tone === 'review';
}

function SectionStatus({ items }) {
  const tone = sectionTone(items);
  return <span className={`section-status section-status-${tone}`}>{tone === 'neutral' ? 'no checks' : tone}</span>;
}

/** The selected mode already renders in the report header, so this section stays hidden
 *  unless a mode check needs attention (wrong toggle) — then it surfaces with the rule rows
 *  the review bookmarks link to. */
function AuditModeSection({ items }) {
  if (!items?.length || items.every(v => v.status === 'pass')) return null;
  return (
    <section className="card audit-section mode-section" id="audit-mode-section">
      <div className="section-heading">
        <SectionTitle id="audit-mode-section-title">Selected audit mode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <ValidationTable items={items} />
    </section>
  );
}

function additionalBarcodeCandidates(audit) {
  const all = audit?.detectedBarcodes || [];
  if (!all.length) return [];
  const expectedBarcodeCount = audit?.carrier === 'startrack' ? 3 : 2;
  if (all.length <= expectedBarcodeCount) return [];
  return all.filter(b => {
    const raw = String(b.rawValue || '');
    if (!raw) return false;
    if (isQrBarcode(b) || isDataMatrixBarcode(b)) return false;
    const compact = raw.replace(/\s+/g, '');
    if (audit?.carrier === 'startrack') {
      return (
        isLinearBarcode(b) &&
        !isStarTrackRoutingValue(raw) &&
        !isStarTrackAtlValue(raw) &&
        !isStarTrackFreightItemValue(raw) &&
        !/^(\]C1)?\(?00\)?\d{18}$/.test(compact)
      );
    }
    return (
      isLinearBarcode(b) &&
      !isDataMatrixBarcode(b) &&
      !/^(\]C1)?\(?01\)?/.test(compact) &&
      !/^(\]C1)?\(?00\)?\d{18}$/.test(compact)
    );
  });
}

function AdditionalBarcodesSection({ audit }) {
  const extras = additionalBarcodeCandidates(audit);
  if (!extras.length) return null;
  return (
    <section className="card audit-section additional-barcodes-section" id="additional-barcodes-section">
      <div className="section-heading">
        <SectionTitle id="additional-barcodes-section-title">Additional detected barcodes</SectionTitle>
        <span className="section-status section-status-neutral">not assessed</span>
      </div>
      <p className="muted small">
        These decoded barcodes do not match a required eParcel or StarTrack specification role for the selected audit
        mode. They are retained as evidence only and are not used to satisfy required barcode checks.
      </p>
      <ul className="barcode-list decoded-list">
        {extras.map((b, idx) => (
          <li key={`${b.rawValue}-${idx}`}>
            <div className="barcode-meta">
              <strong>{barcodeDisplayName(b)}</strong> page {b.pageNumber || ''}
            </div>
            <div className="segmented-code-row">
              <code className="raw-code raw-code-block">{b.rawValue}</code>
              <CopyButton value={b.rawValue} />
            </div>
            <div className="muted small">
              {b.pageBoundingBox
                ? 'Barcode location was decoded on this label.'
                : 'Barcode decoded; exact location not mapped.'}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ValidationTable({ items }) {
  if (!items || !items.length) return <p className="muted small">No validation checks in this section.</p>;
  return <RuleReport items={items} standardFor={standardForValidation} />;
}

/** Vertical section navigation + review bookmarks for the left rail. The rail is a sidebar
 *  (nothing sticky covers the content), so plain anchor jumps with a small scroll margin
 *  land correctly. The "Needs review" list is the only rail block that scrolls: brand,
 *  verdict, file tabs and section nav stay fixed while a long bookmark list scrolls inside
 *  its own box. */
function RailNav({ audit, sections }) {
  const REVIEW_SEVERITY = { fail: 0, warning: 1, manual_review: 2 };
  const reviewItems = (audit?.validations || [])
    .filter(v => v.status in REVIEW_SEVERITY)
    .sort((a, b) => REVIEW_SEVERITY[a.status] - REVIEW_SEVERITY[b.status]);
  const nav =
    audit?.carrier === 'startrack'
      ? [
          ['full-label-image', 'Full label image', sections.label],
          ['datamatrix-section', 'StarTrack QR', sections.datamatrix],
          ['routing-section', 'Routing barcode', sections.routing],
          ['atl-section', 'ATL barcode', sections.atl],
          ['freight-section', 'Freight item barcode', sections.freight],
          ['service-article-section', 'Product and article data', sections.service],
          ['text-content-section', 'Visible label text', [...sections.text, ...sections.other]]
        ]
      : [
          ['full-label-image', 'Full label image', sections.label],
          ['datamatrix-section', 'GS1 DataMatrix', sections.datamatrix],
          ['linear-section', 'GS1-128 Linear', sections.linear],
          ['service-article-section', 'Article and barcode data', sections.service],
          ['text-content-section', 'Visible label text', [...sections.text, ...sections.other]]
        ];
  return (
    <>
      <nav className="rail-nav" aria-label="Report sections">
        {nav.map(([id, label, items]) => {
          const tone = sectionTone(items);
          return (
            <a key={id} href={`#${id}`} className={`rail-nav-item rail-${tone}`}>
              <span className="nav-dot" aria-hidden="true" />
              <span className="rail-nav-label">{label}</span>
            </a>
          );
        })}
      </nav>
      {reviewItems.length > 0 && (
        <div className="review-list">
          <span className="review-list-title" id="review-bookmarks">
            Needs review <span className="review-count">({reviewItems.length})</span>
          </span>
          <ul className="review-links">
            {reviewItems.map(v => (
              <li key={v.id}>
                <a
                  href={`#rule-${v.id}`}
                  className={`review-link review-link-${v.status === 'fail' ? 'fail' : 'review'}`}
                >
                  <StatusIcon status={v.status} />
                  <span className="review-link-title">{v.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ImageZoomModal({ image, onClose }) {
  useEffect(() => {
    if (!image) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [image, onClose]);

  if (!image) return null;
  return (
    <div
      className="image-zoom-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || 'Full label image'}
      onClick={onClose}
    >
      <button className="image-zoom-close" type="button" onClick={onClose} aria-label="Close full screen label image">
        Close
      </button>
      <div className="image-zoom-stage" onClick={event => event.stopPropagation()}>
        <img src={image.src} alt={image.alt || 'Full label image'} />
      </div>
    </div>
  );
}

function FullLabelImageSection({ audit, items, onZoomLabel }) {
  const facts = audit?.labelFacts || {};
  const images = audit?.labelImages || {};
  return (
    <section className="card audit-section" id="full-label-image">
      <div className="section-heading">
        <SectionTitle id="full-label-image-title">Full label image</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col label-layout-grid">
        <div>
          {images.labelPreview ? (
            <button
              className="label-preview-button"
              type="button"
              onClick={() => onZoomLabel?.({ src: images.labelPreview, alt: 'Full label preview' })}
              aria-label="Open full screen label image"
            >
              <img className="label-preview-large" src={images.labelPreview} alt="Full label preview" />
            </button>
          ) : (
            <p className="muted">No label preview captured.</p>
          )}
          {images.labelPreview && (
            <p className="small muted preview-legend">
              Barcode outlines: <span className="legend-dot legend-valid" /> decoded &amp; valid{' · '}
              <span className="legend-dot legend-invalid" /> decoded but invalid{' · '}
              <span className="legend-dot legend-missing" /> expected, not decoded
            </p>
          )}
        </div>
        <div>
          <h3>Visible label facts</h3>
          <div className="fact-cards">
            <div>
              <span>article_id</span>
              <strong>{(facts.articleIds || []).join(', ') || 'Not extracted'}</strong>
            </div>
            <div>
              <span>consignment_id</span>
              <strong>{(facts.consignmentIds || []).join(', ') || 'Not extracted'}</strong>
            </div>
            <div>
              <span>weight</span>
              <strong>{facts.weightKg ? `${facts.weightKg}kg` : 'Not extracted'}</strong>
            </div>
            <div>
              <span>{audit?.carrier === 'startrack' ? 'label_code' : 'label_type'}</span>
              <strong>
                {audit?.carrier === 'startrack' ? facts.labelCode || 'StarTrack' : facts.labelType || 'Not extracted'}
              </strong>
            </div>
          </div>
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

const QR_OBLIGATION_LABEL = { M: 'Mandatory', COND: 'Conditional', O: 'Optional' };

/** Small pass / review / fail key shown above a field breakdown. */
function StatusKeyLegend() {
  return (
    <div className="status-key-legend">
      <span>
        <StatusIcon status="pass" /> pass
      </span>
      <span>
        <StatusIcon status="manual_review" /> review
      </span>
      <span>
        <StatusIcon status="fail" /> fail
      </span>
    </div>
  );
}

/** One expandable field line shared by every barcode breakdown: optional colour swatch +
 *  name + spec + raw value + status icon; char positions and reference detail live in the
 *  drawer so the line itself stays readable. */
function FieldLine({ name, spec, value, status, detail, swatchClass }) {
  const text = String(value ?? '').trim();
  return (
    <details className="qr-line">
      <summary>
        <span className="qr-chev" aria-hidden="true">
          ▸
        </span>
        <span className="qr-name">
          {swatchClass ? <span className={`seg-swatch ${swatchClass}`} aria-hidden="true" /> : null}
          {name}
        </span>
        <span className="qr-spec">{spec}</span>
        <span className="qr-val">{text ? <code>{text}</code> : <span className="muted small">blank</span>}</span>
        {status ? <StatusIcon status={status} /> : <span className="qr-noico muted small">—</span>}
      </summary>
      <div className="qr-drawer">
        <code>{detail}</code>
      </div>
    </details>
  );
}

/** One expandable QR field line: the StarTrack QR spec fields carry their own rule ids,
 *  obligations and fixed char positions. */
function QrFieldLine({ field, value, status, swatchClass }) {
  const obligation = QR_OBLIGATION_LABEL[field.obligation] || field.obligation;
  return (
    <FieldLine
      name={field.label}
      spec={field.obligation === 'M' ? field.criteria : `${obligation}. ${field.criteria}`}
      value={value}
      status={status}
      swatchClass={swatchClass}
      detail={`${field.rule ? `${field.rule} · ` : ''}field ${field.num} · position ${field.pos}, length ${field.len} · ${obligation}`}
    />
  );
}

/** Status of the per-field rule (ST-QR-Fnn) for a QR field, matching exact or forEach-suffixed ids. */
function qrFieldStatus(items, ruleId) {
  if (!ruleId) return null;
  const rows = items || [];
  const exact = rows.find(it => String(it.id || '') === ruleId);
  if (exact) return exact.status;
  const prefixed = rows.find(it => String(it.id || '').startsWith(`${ruleId}_`));
  return prefixed ? prefixed.status : null;
}

const SEG_PALETTE = 8;

/** Renders a decoded barcode value with each data element highlighted in a distinct colour,
 *  plus a legend mapping colour -> field, so reviewers can see which character ranges map to
 *  which validated field. `segments` is an ordered [{ text, label }]; concatenated text equals
 *  the decoded value (padding preserved for fixed-width payloads). */
/** Small copy-to-clipboard icon button for barcode data strings (issue #15). Shows a clipboard
 *  glyph, swapping to a check mark for a moment after a successful copy. */
function CopyButton({ value, label = 'Copy barcode value', text }) {
  const [copied, setCopied] = useState(false);
  // Copy verbatim: fixed-width payloads (StarTrack QR) carry significant leading/
  // trailing padding, so only the "is there anything to copy" check may trim.
  const payload = String(value ?? '');
  if (!payload.trim()) return null;
  const doCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const ta = document.createElement('textarea');
        ta.value = payload;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (blocked context); leave the value selectable manually */
    }
  };
  const tip = copied ? 'Copied' : label;
  return (
    <button
      type="button"
      className={`copy-btn${text ? ' copy-btn-labeled' : ''}${copied ? ' copied' : ''}`}
      onClick={doCopy}
      aria-label={tip}
      title={tip}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M20 6 9 17l-5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
          <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      {text && <span className="copy-btn-text">{copied ? 'Copied' : text}</span>}
    </button>
  );
}

function SegmentedCode({ segments, title = 'Barcode field map (colour-coded)', showLegend = true }) {
  const segs = (segments || []).filter(s => s && ((s.text != null && String(s.text).length > 0) || s.display));
  if (!segs.length) return null;
  const fullValue = segs.map(s => String(s.text)).join('');
  return (
    <div className={title ? 'decoded-panel segmented-panel' : 'segmented-inline'}>
      {title ? <h3>{title}</h3> : null}
      <div className="segmented-code-row">
        <code className="segmented-code">
          {segs.map((s, i) => (
            <span key={i} className={s.display ? 'seg seg-sep' : `seg seg-c${i % SEG_PALETTE}`} title={s.label}>
              {s.display ?? String(s.text)}
            </span>
          ))}
        </code>
        <CopyButton value={fullValue} />
      </div>
      {showLegend ? (
        <ul className="segmented-legend">
          {segs.map((s, i) => (
            <li key={i}>
              <span className={`seg-swatch seg-c${i % SEG_PALETTE}`} aria-hidden="true" />
              <span className="segmented-legend-label">{s.label}</span>
              <code className="segmented-legend-val">{String(s.text).trim() || '(blank)'}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Best-effort GS1 DataMatrix segmentation: split on group separators, else match the
 *  Australia Post AI pattern (01 GTIN, 91 article, 420 postcode, 92 DPID, 8008 date/time). */
/** Splits an eParcel article number into its individual spec elements (MLID + 7-digit
 *  consignment serial + article count + product + service + postage-paid + check digit).
 *  Structure and field lengths come from the audit engine's article parser (the single
 *  slicing source of truth); the original string is sliced so the display stays faithful.
 *  Returns null when the engine does not recognise a standard eParcel article. */
function articleSegments(article) {
  const c = String(article || '');
  const parsed = analyzeArticleCandidate(c)?.article;
  if (parsed?.type !== 'eparcel-standard' || parsed.articleId.length !== c.length) return null;
  const fields = [
    [parsed.mlidLength, 'MLID'],
    [7, 'Consignment serial'],
    [2, 'Article count'],
    [5, 'Product code'],
    [2, 'Service code'],
    [1, 'Postage paid'],
    [1, 'Check digit']
  ];
  let i = 0;
  return fields.map(([len, label]) => ({ text: c.slice(i, (i += len)), label }));
}

/** Length of the eParcel article ID at the front of an AI 91 payload. AusPost sometimes appends
 *  further AIs (420 postcode, 92 DPID, 8008 date) after the article with no separator, so prefer
 *  the shortest valid article length whose remainder is empty or begins with a known trailing AI.
 *  Also accepts the 20-char SSCC-as-article form (AI 00 + 18-digit SSCC in the AI 91 position,
 *  Parcel Post spec v1.4 p26); otherwise consume the whole payload (rendered as a single block). */
function eparcelArticleLength(payload) {
  const c = String(payload || '');
  const remainderOk = len => {
    const rest = c.slice(len);
    return rest === '' || /^(420|92|8008|00|01)/.test(rest);
  };
  for (const len of [21, 23]) {
    if (len <= c.length && articleSegments(c.slice(0, len)) && remainderOk(len)) return len;
  }
  if (/^00\d{18}$/.test(c.slice(0, 20)) && remainderOk(20)) return 20;
  return c.length;
}

function dataMatrixSegments(value, symbologyIdent = '') {
  const seg = (text, label) => ({ text, label });
  const AI_LABEL = {
    '00': 'AI 00 SSCC',
    '01': 'AI 01 GTIN',
    91: 'AI 91 article',
    420: 'AI 420 postcode',
    92: 'AI 92 DPID',
    8008: 'AI 8008 date/time'
  };
  // Fixed-value-length AIs can be consumed back-to-back without a separator; AI 91 (article) is
  // variable so it always runs to the end of its element.
  const FIXED = { '00': 18, '01': 14, 420: 4, 92: 8, 8008: 12 };
  const sepSeg = text => ({ text, label: 'FNC1 separator', display: '⟨FNC1⟩' });
  const splitElement = s => {
    const out = [];
    let i = 0;
    while (i < s.length) {
      // The spec's component table (Parcel Post v1.4 p19) places an FNC1 before AI 420,
      // 92 and 8008. When those AIs follow the previous element with no decoded
      // separator (many scanners strip FNC1 from the reported payload), mark the
      // expected boundary with a zero-length divider so the structure stays visible.
      if (i > 0 && /^(420|92|8008)/.test(s.slice(i, i + 4))) out.push(sepSeg(''));
      const fixed = Object.keys(FIXED).find(ai => s.startsWith(ai, i));
      if (fixed) {
        out.push(
          seg(fixed, AI_LABEL[fixed]),
          seg(s.slice(i + fixed.length, i + fixed.length + FIXED[fixed]), `${AI_LABEL[fixed]} value`)
        );
        i += fixed.length + FIXED[fixed];
        continue;
      }
      if (s.startsWith('91', i)) {
        const rest = s.slice(i + 2);
        out.push(seg('91', AI_LABEL['91']));
        // AI 91 (variable length) carries the eParcel article ID, sometimes followed by more
        // AusPost AIs (420 postcode, 92 DPID, 8008 date) with no separators. Peel the
        // fixed-length article off the front into its components, then let the loop parse the
        // trailing AIs instead of dumping the whole payload as one block.
        const artLen = eparcelArticleLength(rest);
        const artText = rest.slice(0, artLen);
        const artSegs = articleSegments(artText);
        if (artSegs) out.push(...artSegs);
        else if (/^00\d{18}$/.test(artText))
          // SSCC used as the article ID in the AI 91 position (Parcel Post spec v1.4 p26).
          out.push(seg('00', 'AI 00 SSCC'), seg(artText.slice(2), 'AI 00 SSCC value'));
        else out.push(seg(artText, `${AI_LABEL['91']} value`));
        i += 2 + artLen;
        continue;
      }
      out.push(seg(s.slice(i), 'GS1 element'));
      return out;
    }
    return out;
  };
  // Split on every separator representation a decoder can emit: GS/RS/FS control
  // characters, the pipe stand-in, CR/LF (some scanners report FNC1 as a newline),
  // and the literal "<GS>"/"<RS>"/"<FS>" strings produced by human-readable decode
  // modes. The separators are kept as their own segments - the original characters
  // stay as the segment text (so joins, positions and copies remain verbatim) and a
  // visible marker is rendered instead. Stray spaces/tabs at element edges are
  // trimmed the same way the engine's normalizeBarcode strips them before parsing.
  const tokens = String(value)
    .replace(/[()]/g, '')
    .split(/((?:[\x1d\x1e\x1c|\r\n]|<GS>|<RS>|<FS>)+)/);
  const out = tokens.flatMap((tok, idx) => {
    if (idx % 2 === 1) return [sepSeg(tok)];
    const t = tok.replace(/^[\t ]+|[\t ]+$/g, '');
    return t ? splitElement(t) : [];
  });
  // Zero-length segments survive only as display markers (expected-FNC1 dividers).
  const filtered = out.filter(s => String(s.text).length > 0 || s.display);
  // GS1 carriers require FNC1 in the FIRST position (GS1 DataMatrix: signalled as the
  // ]d2 symbology identifier, never as a data character). Mark the expected leading
  // position; when the decoder exposed the identifier it becomes the marker's text.
  const startMarker = {
    text: symbologyIdent,
    label: 'FNC1 start',
    display: symbologyIdent ? `⟨FNC1⟩ ${symbologyIdent}` : '⟨FNC1⟩'
  };
  return filtered.some(s => String(s.text).length > 0)
    ? [startMarker, ...filtered]
    : [seg(String(value), 'Decoded value')];
}

/** Splits a decoded barcode value into colour-coded field segments by its fixed format and field
 *  lengths, operating on the literal decoded value so the highlighted string matches the scan.
 *  Always returns at least one segment for a non-empty value; a concat check guarantees no
 *  character is dropped or duplicated (falls back to a single block when slicing is unreliable). */
function rawSegments(rawValue, kind) {
  const v = String(rawValue || '').replace(/^\][A-Za-z0-9]{2}/, '');
  if (!v) return [];
  const seg = (text, label) => ({ text, label });
  const whole = [seg(v, 'Decoded value')];
  let out;
  switch (kind) {
    case 'qr': {
      out = STARTRACK_QR_FIELDS.map(f => seg(v.slice(f.pos - 1, f.pos - 1 + f.len), `${f.num}. ${f.label}`)).filter(
        s => s.text.length > 0
      );
      const consumed = STARTRACK_QR_FIELDS.reduce((m, f) => Math.max(m, f.pos - 1 + f.len), 0);
      if (v.length > consumed) out.push(seg(v.slice(consumed), 'Overflow / extra'));
      break;
    }
    case 'freight': {
      const c = v.replace(/[()]/g, '');
      if (/^00\d{18}$/.test(c)) return rawSegments(c, 'sscc');
      out = /^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(c)
        ? [
            seg(c.slice(0, 4), 'Despatch ID'),
            seg(c.slice(4, 12), 'Connote sequence'),
            seg(c.slice(12, 15), 'Product code'),
            seg(c.slice(15, 20), 'Item sequence')
          ]
        : whole;
      break;
    }
    case 'routing': {
      const c = v.replace(/[()\s]/g, '');
      const m421 = c.match(/^421(\d{3})(\d{4})(?:403([A-Z0-9]+))?$/);
      if (m421) {
        out = [seg('421', 'AI 421'), seg(m421[1], 'Country code'), seg(m421[2], 'Postcode')];
        if (m421[3]) out.push(seg('403', 'AI 403'), seg(m421[3], 'Label code'));
      } else {
        const m = c.match(/^([A-Z]{2,3})(\d{4})([A-Z0-9]{2,3})?$/);
        out = m ? [seg(m[1], 'Label code'), seg(m[2], 'Postcode'), ...(m[3] ? [seg(m[3], 'Depot/port')] : [])] : whole;
      }
      break;
    }
    case 'atl': {
      const m = v.replace(/[()]/g, '').match(/^(C)(\d{9})$/);
      out = m ? [seg('C', 'Prefix'), seg(m[2], 'Counter')] : whole;
      break;
    }
    case 'sscc': {
      const d = v.replace(/[()\s]/g, '');
      if (/^00\d{18}$/.test(d))
        out = [
          seg('00', 'AI 00'),
          seg(d.slice(2, 3), 'Extension digit'),
          seg(d.slice(3, 19), 'Company prefix + serial'),
          seg(d.slice(19), 'Check digit')
        ];
      else if (/^\d{18}$/.test(d))
        out = [
          seg(d.slice(0, 1), 'Extension digit'),
          seg(d.slice(1, 17), 'Company prefix + serial'),
          seg(d.slice(17), 'Check digit')
        ];
      else if (/^00/.test(d)) out = [seg('00', 'AI 00'), seg(d.slice(2), 'SSCC payload (malformed)')];
      else if (/^\d+$/.test(d)) out = [seg(d, 'SSCC payload (AI 00 missing)')];
      else out = whole;
      break;
    }
    case 'eparcel-linear-sscc':
    case 'eparcel-linear': {
      const c = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (/^00\d{18}$/.test(c)) return rawSegments(c, 'sscc');
      if (kind === 'eparcel-linear-sscc') return rawSegments(c, 'sscc');
      // GS1-128 carries AI 01 GTIN + AI 91 article; segment it by AI like the DataMatrix.
      if (/^01\d{14}91[A-Z0-9]+/.test(c)) return dataMatrixSegments(c);
      return rawSegments(c, 'article');
    }
    case 'article': {
      const c = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      out = articleSegments(c) || whole;
      break;
    }
    case 'datamatrix':
      return dataMatrixSegments(v, (String(rawValue).match(/^\][A-Za-z0-9]{2}/) || [])[0] || '');
    default:
      out = whole;
  }
  out = (out || []).filter(s => s && String(s.text).length > 0);
  if (!out.length) return whole;
  // Faithfulness guard: the coloured segments must reproduce the decoded value exactly.
  const joined = out.map(s => String(s.text)).join('');
  const cleaned = v.replace(/[()\s]/g, '').toUpperCase();
  if (joined !== v && joined.toUpperCase() !== cleaned) return whole;
  return out;
}

// --- Per-field specifications for the barcode breakdown tables. Display-only: statuses
// re-use the same reference maps and check-digit functions the rule engine validates with
// (PRODUCT/SERVICE maps, calculateEparcelCheckDigit, parseSsccBarcode, STARTRACK maps);
// no new validation logic is introduced here. Keyed by the rawSegments field label.
const pf = (spec, check, detail) => ({ spec, check, detail });
const digitsCheck = n => t => (new RegExp(`^\\d{${n}}$`).test(t) ? 'pass' : 'fail');
const literalCheck = lit => t => (t === lit ? 'pass' : 'fail');

const ARTICLE_FIELD_SPECS = {
  MLID: pf('Merchant location ID — 3 or 5 alphanumeric', t =>
    /^[A-Z0-9]{3}$|^[A-Z0-9]{5}$/i.test(t) ? 'pass' : 'fail'
  ),
  'Consignment serial': pf('Consignment serial — 7 digits', digitsCheck(7)),
  'Article count': pf('Article number within consignment — 2 digits', digitsCheck(2)),
  'Product code': pf(
    '5-digit eParcel product code',
    t => (PRODUCT_CODE_MAP[t] ? 'pass' : 'fail'),
    t => PRODUCT_CODE_MAP[t] || 'not in the eParcel product map'
  ),
  'Service code': pf(
    '2-digit eParcel service code',
    t => (SERVICE_CODE_MAP[t] ? 'pass' : 'fail'),
    t => SERVICE_CODE_MAP[t]?.name || 'not in the eParcel service map'
  ),
  'Postage paid': pf('Postage paid indicator — 1 character'),
  'Check digit': pf(
    'Weighted mod-10 check digit over the preceding characters',
    (t, ctx) => {
      const calc = calculateEparcelCheckDigit(String(ctx.article || '').slice(0, -1));
      return calc.validInput ? (calc.checkDigit === t ? 'pass' : 'fail') : null;
    },
    (t, ctx) => {
      const calc = calculateEparcelCheckDigit(String(ctx.article || '').slice(0, -1));
      return calc.validInput ? `expected ${calc.checkDigit}` : '';
    }
  )
};

const ssccFromContext = ctx => parseSsccBarcode(ctx.joined.length === 18 ? `00${ctx.joined}` : ctx.joined);
const SSCC_FIELD_SPECS = {
  'AI 00': pf('GS1 Application Identifier 00 — SSCC follows', literalCheck('00')),
  'Extension digit': pf('Extension digit 0–9 (merchant assigned)', digitsCheck(1)),
  'Company prefix + serial': pf('GS1 company prefix + serial reference — 16 digits', digitsCheck(16)),
  'SSCC payload (malformed)': pf(
    'SSCC — exactly 18 digits after AI 00',
    () => 'fail',
    t => (/\D/.test(t) ? 'contains a non-digit character' : `found ${t.length} digits, expected 18`)
  ),
  'SSCC payload (AI 00 missing)': pf(
    'SSCC must be preceded by Application Identifier 00',
    () => 'fail',
    () => 'no AI 00 prefix on the decoded value'
  ),
  'Check digit': pf(
    'GS1 mod-10 check digit',
    (t, ctx) => (ssccFromContext(ctx).valid ? 'pass' : 'fail'),
    (t, ctx) => {
      const parsed = ssccFromContext(ctx);
      return parsed.expectedCheckDigit ? `expected ${parsed.expectedCheckDigit}` : '';
    }
  )
};

const GS1_FIELD_SPECS = {
  'AI 01 GTIN': pf('GS1 Application Identifier 01 — GTIN follows', literalCheck('01')),
  'AI 01 GTIN value': pf('14-digit GTIN (99312650999998 = Australia Post eParcel)', digitsCheck(14)),
  'AI 91 article': pf('GS1 AI 91 — eParcel article and services data follows', literalCheck('91')),
  'AI 91 article value': pf(
    'eParcel article ID — 21 chars (3-char MLID) or 23 chars (5-char MLID)',
    () => 'manual_review',
    () => 'payload did not parse as a standard eParcel article'
  ),
  'AI 420 postcode': pf('GS1 AI 420 — ship-to postcode follows', literalCheck('420')),
  'AI 420 postcode value': pf('Delivery postcode — 4 digits', digitsCheck(4)),
  'AI 92 DPID': pf('GS1 AI 92 — delivery point identifier follows', literalCheck('92')),
  'AI 92 DPID value': pf('Delivery point identifier (DPID) — 8 digits', digitsCheck(8)),
  'AI 8008 date/time': pf('GS1 AI 8008 — production date/time follows', literalCheck('8008')),
  'AI 8008 date/time value': pf('Date/time — YYMMDDHHMMSS', digitsCheck(12)),
  'AI 00 SSCC': pf('GS1 Application Identifier 00 — SSCC follows', literalCheck('00')),
  'AI 00 SSCC value': pf('18-digit SSCC with GS1 mod-10 check digit', t =>
    parseSsccBarcode(`00${t}`).valid ? 'pass' : 'fail'
  ),
  'FNC1 start': pf(
    'GS1 symbol start: FNC1 required in the FIRST position (GS1 DataMatrix signals it as symbology identifier ]d2; GS1-128 as ]C1 — it is not a data character)',
    t => (t === ']d2' || t === ']d5' || t === ']C1' ? 'pass' : /^\]d\d$/.test(t) ? 'fail' : null),
    t =>
      t === ''
        ? 'not visible in this decode — see the "GS1 FNC1 in first position" rule row, which assesses the decoder-reported symbology identifier'
        : /^\](d[25]|C1)$/.test(t)
          ? `symbology identifier ${t}: FNC1 in first position (GS1 carrier)`
          : `symbology identifier ${t}: FNC1 is NOT in first position`
  ),
  'FNC1 separator': pf(
    'GS1 FNC1 group separator expected at this element boundary — encoded as ASCII 29',
    t => (t.length ? 'pass' : null),
    t =>
      t.length === 0
        ? 'separator character not visible in this decode — many scanners strip FNC1 from the reported payload'
        : /^[\x1d\x1e\x1c\r\n]+$/.test(t)
          ? 'control character'
          : 'reported by the decoder as readable text; the symbol itself normally encodes ASCII 29'
  ),
  'GS1 element': pf('Unrecognised GS1 element', () => 'manual_review')
};

const FREIGHT_FIELD_SPECS = {
  'Despatch ID': pf('Despatch/depot identifier — 4 alphanumeric', t => (/^[A-Z0-9]{4}$/i.test(t) ? 'pass' : 'fail')),
  'Connote sequence': pf('Consignment note sequence — 8 digits', digitsCheck(8)),
  'Product code': pf(
    'StarTrack product code — 3 characters',
    t => (STARTRACK_PRODUCT_CODE_MAP[t] ? 'pass' : 'fail'),
    t => STARTRACK_PRODUCT_CODE_MAP[t]?.name || 'not in the StarTrack product map'
  ),
  'Item sequence': pf('Freight item sequence — 5 digits', digitsCheck(5))
};

const ROUTING_FIELD_SPECS = {
  'Label code': pf(
    'StarTrack service label code (e.g. EXP / PRM / ARL)',
    t => (STARTRACK_LABEL_CODE_MAP[t] ? 'pass' : 'manual_review'),
    t =>
      STARTRACK_LABEL_CODE_MAP[t]
        ? `products: ${STARTRACK_LABEL_CODE_MAP[t].join(', ')}`
        : 'not a known StarTrack label code'
  ),
  Postcode: pf('Destination postcode — 4 digits', digitsCheck(4)),
  'Depot/port': pf('Destination depot/port — 2–3 characters', t => (/^[A-Z0-9]{2,3}$/i.test(t) ? 'pass' : 'fail')),
  'AI 421': pf('GS1 AI 421 — postal code with ISO country follows', literalCheck('421')),
  'Country code': pf('ISO 3166 numeric country code (036 = Australia)', digitsCheck(3)),
  'AI 403': pf('GS1 AI 403 — routing code follows', literalCheck('403'))
};

const ATL_FIELD_SPECS = {
  Prefix: pf('Literal character C', literalCheck('C')),
  Counter: pf('Nine-digit sequential counter (starts 000000001)', digitsCheck(9))
};

/** Picks the field-spec map for a segmented barcode. SSCC-split segments can surface under
 *  several kinds (freight, linear, sscc), so their labels take precedence over the kind. */
function fieldSpecsFor(kind, segments) {
  if (segments.some(s => s.label === 'Extension digit' || String(s.label).startsWith('SSCC payload')))
    return { ...GS1_FIELD_SPECS, ...SSCC_FIELD_SPECS };
  if (kind === 'freight') return FREIGHT_FIELD_SPECS;
  if (kind === 'routing') return ROUTING_FIELD_SPECS;
  if (kind === 'atl') return ATL_FIELD_SPECS;
  return { ...GS1_FIELD_SPECS, ...ARTICLE_FIELD_SPECS };
}

/** QR-style per-field breakdown for a colour-segmented barcode value: one expandable line
 *  per field with its specification and status check, colour-matched to the raw string above
 *  (same segment order, so seg-cN indexes line up). */
function SegmentedFields({ segments, kind }) {
  const segs = (segments || []).filter(s => s && (String(s.text).length > 0 || s.display));
  if (!segs.length) return null;
  const specs = fieldSpecsFor(kind, segs);
  if (!segs.some(s => specs[s.label])) return null;
  const joined = segs.map(s => String(s.text)).join('');
  const artLabels = Object.keys(ARTICLE_FIELD_SPECS);
  const ctx = {
    joined,
    article: segs
      .filter(s => artLabels.includes(s.label))
      .map(s => String(s.text))
      .join('')
  };
  const lens = segs.map(s => String(s.text).length);
  const starts = lens.map((_, i) => 1 + lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="qr-lines">
      <StatusKeyLegend />
      <div className="qr-lines-head">
        <span />
        <span>Field</span>
        <span>Specification</span>
        <span>Raw value</span>
        <span />
      </div>
      {segs.map((s, i) => {
        const text = String(s.text);
        const start = starts[i];
        const def = specs[s.label];
        const detail = [`position ${start}, length ${text.length}`, def?.detail ? def.detail(text, ctx) : '']
          .filter(Boolean)
          .join(' · ');
        return (
          <FieldLine
            key={`${i}-${s.label}`}
            swatchClass={s.display ? 'seg-sep' : `seg-c${i % SEG_PALETTE}`}
            name={s.label}
            spec={def?.spec || '—'}
            value={text.length ? (s.display ?? text) : ''}
            status={def?.check ? def.check(text, ctx) : null}
            detail={detail}
          />
        );
      })}
    </div>
  );
}

/** Renders each decoded barcode value colour-coded by its field format/lengths, with the
 *  QR-style per-field breakdown beneath it when the kind has field specifications (the
 *  breakdown then replaces the plain colour legend). `showLegend` forces the legend on/off
 *  for kinds whose field table renders elsewhere (StarTrack QR). */
function DecodedBarcodes({ barcodes, kind, label, emptyText, showLegend }) {
  if (!barcodes || !barcodes.length) return <p className="muted">{emptyText}</p>;
  return (
    <ul className="barcode-list decoded-list">
      {barcodes.map(b => {
        const segments = rawSegments(b.rawValue, kind).filter(s => s && (String(s.text).length > 0 || s.display));
        const hasFieldRows = segments.some(s => fieldSpecsFor(kind, segments)[s.label]);
        return (
          <li key={`${b.pageNumber || 0}-${b.rawValue}`}>
            <div className="barcode-meta">
              <strong>{label}</strong> {b.pageNumber ? `page ${b.pageNumber}` : ''}
            </div>
            <SegmentedCode segments={segments} title={null} showLegend={showLegend ?? !hasFieldRows} />
            {hasFieldRows ? <SegmentedFields segments={segments} kind={kind} /> : null}
            <div className="muted small">
              {b.pageBoundingBox
                ? 'Barcode location verified on this label.'
                : 'Barcode decoded; exact location not mapped.'}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function StarTrackQrSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const qrBarcodes = decodedBarcodeList(audit, 'qr');
  const qrs = audit?.startrack?.qrParses || [];
  return (
    <section className="card audit-section startrack-section" id="datamatrix-section">
      <div className="section-heading">
        <SectionTitle id="datamatrix-section-title">StarTrack 2D QR Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.qrBarcodeCrop ? (
            <figure className="category-crop">
              <img src={images.qrBarcodeCrop} alt="StarTrack QR barcode crop" />
              <figcaption>{imageBoxCaption(images, FORMAT_KIND.qr)}</figcaption>
            </figure>
          ) : (
            <p className="muted">No QR barcode crop captured.</p>
          )}
        </div>
        <div>
          {sectionHasIssues(items) && (
            <StandardLine>
              StarTrack QR fields are fixed width and include receiver suburb/postcode, connote, freight item number,
              product code, quantity, weight, despatch date, unit type, destination depot, DG indicator and movement
              type.
            </StandardLine>
          )}
          <div className="decoded-panel">
            <h3>Raw decoded QR string (colour-coded by field)</h3>
            <DecodedBarcodes
              barcodes={qrBarcodes}
              kind="qr"
              label="QR"
              emptyText="No StarTrack QR value decoded from the uploaded file."
              showLegend={qrs.length === 0}
            />
          </div>
          {qrs.length > 0 &&
            qrs.map(qr => {
              // Colour-match each parsed field row to its segment in the raw string above:
              // both derive from rawSegments(raw, 'qr'), so the filtered segment order fixes
              // the seg-cN palette index for a given "<num>. <label>" field.
              const segLabels = rawSegments(qr.raw, 'qr')
                .filter(s => String(s.text).length > 0)
                .map(s => s.label);
              return (
                <div key={qr.raw} className="decoded-panel qr-fields-panel">
                  <h3>Parsed QR payload fields</h3>
                  <p className="muted small">
                    Product {qr.productCode || '—'}
                    {qr.productName ? ` — ${qr.productName}` : ''} · payload {qr.length} chars
                  </p>
                  <div className="qr-lines">
                    <StatusKeyLegend />
                    <div className="qr-lines-head">
                      <span />
                      <span>Field</span>
                      <span>Specification</span>
                      <span>Raw value</span>
                      <span />
                    </div>
                    {STARTRACK_QR_FIELDS.map(f => {
                      const segIndex = segLabels.indexOf(`${f.num}. ${f.label}`);
                      return (
                        <QrFieldLine
                          key={f.key}
                          field={f}
                          value={qr.fields?.[f.key] ?? ''}
                          status={qrFieldStatus(items, f.rule)}
                          swatchClass={segIndex >= 0 ? `seg-c${segIndex % SEG_PALETTE}` : null}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function StarTrackRoutingSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const routingBarcodes = starTrackRoutingBarcodeList(audit);
  const routes = audit?.startrack?.routingParses || [];
  return (
    <section className="card audit-section startrack-section" id="routing-section">
      <div className="section-heading">
        <SectionTitle id="routing-section-title">StarTrack Routing Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.routingBarcodeCrop ? (
            <figure className="category-crop wide">
              <img src={images.routingBarcodeCrop} alt="StarTrack routing barcode crop" />
              <figcaption>{imageBoxCaption(images, 'startrack-routing')}</figcaption>
            </figure>
          ) : (
            <p className="muted">No routing barcode crop captured.</p>
          )}
        </div>
        <div>
          <h3>Decoded routing barcode values (colour-coded by field)</h3>
          <DecodedBarcodes
            barcodes={routingBarcodes}
            kind="routing"
            label="Routing barcode"
            emptyText="No StarTrack routing barcode value decoded."
          />
          {sectionHasIssues(items) && routes.length > 0 && (
            <div className="fact-cards fact-cards-wide">
              {routes.map(route => (
                <React.Fragment key={route.raw}>
                  <div>
                    <span>Label code</span>
                    <strong>{route.labelCode}</strong>
                  </div>
                  <div>
                    <span>Postcode</span>
                    <strong>{route.postcode}</strong>
                  </div>
                  <div>
                    <span>Depot / port</span>
                    <strong>{route.depotOrPort || 'Not applicable'}</strong>
                  </div>
                  <div>
                    <span>Format</span>
                    <strong>{route.formatDescription}</strong>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
          {sectionHasIssues(items) && (
            <StandardLine>
              StarTrack routing barcode is required separately from the freight item and ATL barcodes. Standard format
              is SSS9999DD/DDD: Premium and Fixed Price Premium labels commonly use a three-character depot/port suffix,
              while Express labels may use a two-character suffix. AU domestic SSCC labels may use GS1 421/403 routing.
            </StandardLine>
          )}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function StarTrackAtlSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const atlBarcodes = starTrackAtlBarcodeList(audit);
  const atlParses = audit?.startrack?.atlParses || [];
  return (
    <section className="card audit-section startrack-section" id="atl-section">
      <div className="section-heading">
        <SectionTitle id="atl-section-title">StarTrack ATL Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.atlBarcodeCrop ? (
            <figure className="category-crop wide">
              <img src={images.atlBarcodeCrop} alt="StarTrack ATL barcode crop" />
              <figcaption>{imageBoxCaption(images, 'startrack-atl')}</figcaption>
            </figure>
          ) : (
            <p className="muted">No ATL barcode crop captured.</p>
          )}
        </div>
        <div>
          <h3>Decoded ATL barcode values (colour-coded by field)</h3>
          <DecodedBarcodes
            barcodes={atlBarcodes}
            kind="atl"
            label="ATL barcode"
            emptyText="No StarTrack ATL barcode value decoded."
          />
          {sectionHasIssues(items) && atlParses.length > 0 && (
            <div className="fact-cards fact-cards-wide">
              {atlParses.map(atl => (
                <React.Fragment key={atl.atlNumber}>
                  <div>
                    <span>ATL number</span>
                    <strong>{atl.atlNumber}</strong>
                  </div>
                  <div>
                    <span>Counter</span>
                    <strong>{atl.counter}</strong>
                  </div>
                  <div>
                    <span>Format</span>
                    <strong>C999999999</strong>
                  </div>
                  <div>
                    <span>Orientation</span>
                    <strong>Picket Fence</strong>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
          {sectionHasIssues(items) && (
            <StandardLine>
              StarTrack ATL barcode content is C999999999. C is always the character C and the nine-digit sequential
              counter starts at 000000001. Preferred orientation is Picket Fence, minimum bar height 10mm, minimum
              barcode length 28mm, left/right quiet zone 5mm, and resolution 6 dots per mm.
            </StandardLine>
          )}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function StarTrackFreightItemSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const freightBarcodes = starTrackFreightBarcodeList(audit);
  const freightParses = audit?.startrack?.freightParses || [];
  const ssccs = audit?.startrack?.ssccParses || [];
  return (
    <section className="card audit-section startrack-section" id="freight-section">
      <div className="section-heading">
        <SectionTitle id="freight-section-title">StarTrack Freight Item Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.freightBarcodeCrop ? (
            <figure className="category-crop wide">
              <img src={images.freightBarcodeCrop} alt="StarTrack freight item barcode crop" />
              <figcaption>{imageBoxCaption(images, 'startrack-freight')}</figcaption>
            </figure>
          ) : (
            <p className="muted">No freight item barcode crop captured.</p>
          )}
        </div>
        <div>
          <h3>Decoded freight item barcode values (colour-coded by field)</h3>
          <DecodedBarcodes
            barcodes={freightBarcodes}
            kind="freight"
            label="Freight item barcode"
            emptyText="No StarTrack freight item / SSCC barcode value decoded."
          />
          {sectionHasIssues(items) && freightParses.length > 0 && (
            <div className="fact-cards fact-cards-wide">
              {freightParses.map(f => (
                <React.Fragment key={f.freightItemId}>
                  <div>
                    <span>article_id</span>
                    <strong>{f.freightItemId}</strong>
                  </div>
                  <div>
                    <span>consignment_id</span>
                    <strong>{f.connoteNumber}</strong>
                  </div>
                  <div>
                    <span>product_code</span>
                    <strong>
                      {f.productCode} — {f.productName}
                    </strong>
                  </div>
                  <div>
                    <span>item_sequence</span>
                    <strong>{f.itemNumber}</strong>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
          {sectionHasIssues(items) && ssccs.length > 0 && (
            <details className="reference-details sscc-details">
              <summary>SSCC details ({ssccs.length})</summary>
              <div className="fact-cards fact-cards-wide">
                {ssccs.map(s => (
                  <React.Fragment key={s.sscc}>
                    <div>
                      <span>SSCC</span>
                      <strong>00{s.sscc}</strong>
                    </div>
                    <div>
                      <span>Extension digit</span>
                      <strong>{s.extensionDigit}</strong>
                    </div>
                    <div>
                      <span>Check digit</span>
                      <strong>{s.checkDigit}</strong>
                    </div>
                    <div>
                      <span>Expected check digit</span>
                      <strong>{s.expectedCheckDigit}</strong>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              {ssccs.map(s => (
                <SegmentedCode
                  key={`seg-${s.sscc}`}
                  segments={rawSegments(`00${s.sscc}`, 'sscc')}
                  title="SSCC field map (colour-coded)"
                />
              ))}
            </details>
          )}
          {sectionHasIssues(items) && (
            <StandardLine>
              StarTrack freight item barcode is mandatory and is separate from the routing barcode. It is either
              20-character Code128 XXXZ99999999AAA99999 or GS1 AI 00 SSCC.
            </StandardLine>
          )}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function DataMatrixSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const dataMatrixBarcodes = decodedBarcodeList(audit, 'datamatrix');
  return (
    <section className="card audit-section" id="datamatrix-section">
      <div className="section-heading">
        <SectionTitle id="datamatrix-section-title">GS1 DataMatrix Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.dataMatrixFocusedCrop || images.dataMatrixCrop ? (
            <figure className="category-crop">
              <img src={images.dataMatrixFocusedCrop || images.dataMatrixCrop} alt="GS1 DataMatrix crop" />
              <figcaption>{imageBoxCaption(images, FORMAT_KIND.datamatrix)}</figcaption>
            </figure>
          ) : (
            <p className="muted">No GS1 DataMatrix crop captured.</p>
          )}
        </div>
        <div>
          {sectionHasIssues(items) &&
            (auditHasSsccOnly(audit) ? (
              <StandardLine>
                SSCC labels use AI 00. eParcel AI 91/product/service evaluation is not applicable to an SSCC barcode.
              </StandardLine>
            ) : (
              <StandardLine>
                GS1 DataMatrix should include AI 01, AI 91, AI 420 postcode and AI 8008 date/time. AI 92 DPID is
                optional.
              </StandardLine>
            ))}

          <div className="decoded-panel">
            <h3>Raw decoded GS1 DataMatrix string (colour-coded by AI)</h3>
            <DecodedBarcodes
              barcodes={dataMatrixBarcodes}
              kind="datamatrix"
              label="DataMatrix"
              emptyText="No GS1 DataMatrix value decoded from the uploaded file."
            />
          </div>

          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function LinearBarcodeSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const linearBarcodes = (audit?.detectedBarcodes || []).filter(
    b =>
      String(b.format || '')
        .toLowerCase()
        .includes('128') || b.kind === 'linear'
  );
  return (
    <section className="card audit-section" id="linear-section">
      <div className="section-heading">
        <SectionTitle id="linear-section-title">GS1-128 Linear Barcode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="two-col">
        <div>
          {images.linearBarcodeCrop || images.rightLinearBarcodeCrop ? (
            <figure className="category-crop wide">
              <img src={images.linearBarcodeCrop || images.rightLinearBarcodeCrop} alt="Linear barcode crop" />
              <figcaption>{imageBoxCaption(images, FORMAT_KIND.linear)}</figcaption>
            </figure>
          ) : (
            <p className="muted">No linear barcode crop captured.</p>
          )}
        </div>
        <div>
          <h3>Decoded linear barcode values (colour-coded by field)</h3>
          <DecodedBarcodes
            barcodes={linearBarcodes}
            kind={audit?.selectedAuditMode?.labelFormat === 'sscc' ? 'eparcel-linear-sscc' : 'eparcel-linear'}
            label="Linear barcode"
            emptyText="No Code128/GS1-128 value decoded."
          />
          {sectionHasIssues(items) &&
            (auditHasSsccOnly(audit) ? (
              <StandardLine>
                SSCC linear barcodes use AI 00 and should decode to a valid SSCC value. eParcel
                product/service/check-digit fields are not encoded in the SSCC value.
              </StandardLine>
            ) : (
              <StandardLine>
                Linear GS1-128 should encode AI 01 + AusPost GTIN, AI 91 + article component, with a valid eParcel check
                digit.
              </StandardLine>
            ))}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function StarTrackProductArticleSection({ audit, items }) {
  const st = audit?.startrack || {};
  const products = [
    ...new Set(
      [...(st.freightParses || []).map(f => f.productCode), ...(st.qrParses || []).map(q => q.productCode)].filter(
        Boolean
      )
    )
  ];
  const routes = st.routingParses || [];
  const ssccOnly = Boolean(st.ssccOnly);
  return (
    <section className="card audit-section startrack-section" id="service-article-section">
      <div className="section-heading">
        <SectionTitle id="service-article-section-title">StarTrack Product, Routing and Article Data</SectionTitle>
        <SectionStatus items={items} />
      </div>
      {ssccOnly && (
        <div className="info-panel sscc-panel">
          <strong>StarTrack SSCC label detected.</strong>
          <p>
            Product code is not embedded in the SSCC article identifier. Product context is assessed from the QR
            payload, routing barcode or manifest data when available.
          </p>
        </div>
      )}
      <div className="fact-cards fact-cards-wide">
        <div>
          <span>Freight item barcode(s)</span>
          <strong>{(st.freightParses || []).map(f => f.freightItemId).join(', ') || 'Not decoded'}</strong>
        </div>
        <div>
          <span>SSCC value(s)</span>
          <strong>{(st.ssccParses || []).map(s => `00${s.sscc}`).join(', ') || 'Not decoded'}</strong>
        </div>
        <div>
          <span>Product code(s)</span>
          <strong>
            {products.length
              ? products.map(p => `${p} — ${STARTRACK_PRODUCT_CODE_MAP[p]?.name || 'Unknown'}`).join(', ')
              : ssccOnly
                ? 'Not encoded in SSCC'
                : 'Not parsed'}
          </strong>
        </div>
        <div>
          <span>Routing code(s)</span>
          <strong>
            {routes.length
              ? routes.map(r => `${r.labelCode}${r.postcode}${r.depotOrPort || ''}`).join(', ')
              : 'Not decoded'}
          </strong>
        </div>
      </div>
      <StandardLine>
        Supported StarTrack products include EXP, PRM, FPP, ARL, FPA, RET, RE2, APT and TSE. Product-to-label-code
        relationships include EXP→EXP, PRM/FPP→PRM and ARL/FPA→ARL.
      </StandardLine>
      <ValidationTable items={items} />
      <div className="matrix-block">
        <h3 className="matrix-block-title">StarTrack product and label-code reference</h3>
        <StarTrackProductMatrix audit={audit} />
      </div>
    </section>
  );
}

function StarTrackProductMatrix({ audit }) {
  const selectedProducts = new Set(
    [
      ...(audit?.startrack?.freightParses || []).map(f => f.productCode),
      ...(audit?.startrack?.qrParses || []).map(q => q.productCode)
    ].filter(Boolean)
  );
  const selectedLabelCodes = new Set(
    [...(audit?.startrack?.routingParses || []).map(r => r.labelCode), audit?.labelFacts?.labelCode].filter(Boolean)
  );
  return (
    <div className="table-wrap">
      <table className="compact-table startrack-matrix">
        <thead>
          <tr>
            <th>Product Code</th>
            <th>Product Name</th>
            <th>Group</th>
            <th>Label Code</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(STARTRACK_PRODUCT_CODE_MAP).map(([code, meta]) => {
            return (
              <tr
                key={code}
                className={
                  selectedProducts.has(code) || selectedLabelCodes.has(meta.labelCode) ? 'row-pass selected' : ''
                }
              >
                <td>
                  <strong>{code}</strong>
                  {selectedProducts.has(code) && <span className="pill">selected</span>}
                </td>
                <td>{meta.name}</td>
                <td>{meta.group}</td>
                <td>
                  <strong>{meta.labelCode}</strong>
                  {selectedLabelCodes.has(meta.labelCode) && <span className="pill">selected</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ServiceArticleBreakdownSection({ audit, items }) {
  if (audit?.carrier === 'startrack') return <StarTrackProductArticleSection audit={audit} items={items} />;
  const ssccOnly = auditHasSsccOnly(audit);
  return (
    <section className="card audit-section" id="service-article-section">
      <div className="section-heading">
        <SectionTitle id="service-article-section-title">Article and barcode data</SectionTitle>
        <SectionStatus items={items} />
      </div>
      {ssccOnly && (
        <div className="info-panel sscc-panel">
          <strong>SSCC label detected.</strong>
          <p>
            Product code and service code are not evaluated for SSCC labels because SSCC barcodes encode AI 00 SSCC
            data, not the eParcel article product/service fields. The audit still reports barcode readability,
            sender/receiver blocks, weight, DG declaration and other visible label requirements where extractable.
          </p>
        </div>
      )}
      {audit.articles?.length > 0 ? (
        audit.articles.map(a => (
          <div className="article-summary" key={a.articleId || a.sscc}>
            {a.type === 'sscc' ? (
              <div className="fact-cards fact-cards-wide">
                <div>
                  <span>barcode_type</span>
                  <strong>SSCC / AI 00</strong>
                </div>
                <div>
                  <span>article_id</span>
                  <strong>
                    <code>{a.sscc}</code>
                  </strong>
                </div>
                <div>
                  <span>product_code</span>
                  <strong>Not encoded in SSCC</strong>
                </div>
                <div>
                  <span>service_code</span>
                  <strong>Not encoded in SSCC</strong>
                </div>
              </div>
            ) : (
              <div className="fact-cards fact-cards-wide">
                <div>
                  <span>article_id</span>
                  <strong>
                    <code>{a.articleId}</code>
                  </strong>
                </div>
                <div>
                  <span>mlid</span>
                  <strong>{a.mlid}</strong>
                </div>
                <div>
                  <span>consignment_id</span>
                  <strong>{a.consignmentId}</strong>
                </div>
                <div>
                  <span>article_count</span>
                  <strong>{a.articleCount}</strong>
                </div>
                <div>
                  <span>product_code</span>
                  <strong>
                    {a.productCode} — {a.productDescription}
                  </strong>
                </div>
                <div>
                  <span>service_code</span>
                  <strong>
                    {a.serviceCode} — {a.serviceDescription}
                  </strong>
                </div>
                <div>
                  <span>postage_paid_indicator</span>
                  <strong>{a.postagePaidIndicator}</strong>
                </div>
                <div>
                  <span>check_digit</span>
                  <strong>{a.checkDigit}</strong>
                </div>
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="muted">No article details parsed from a decoded barcode.</p>
      )}
      {ssccOnly ? (
        <StandardLine>
          SSCC label = AI 00 + 18 digit serial shipping container code. eParcel product and service-code matrix checks
          are intentionally skipped.
        </StandardLine>
      ) : (
        <StandardLine>
          Standard article ID = MLID + 7 digit consignment suffix + article count + product code + service code +
          postage paid indicator + check digit.
        </StandardLine>
      )}
      <ValidationTable items={items} />
      {/* The service/product matrix stays permanently expanded: it is the key visual reference. */}
      {!ssccOnly && <ServiceCodeMatrix audit={audit} />}
    </section>
  );
}

/**
 * Plain-language description of where a label's audit text came from, so a
 * reviewer can tell selectable PDF text, successful OCR, and a failed/empty OCR
 * run apart instead of seeing only "No raw text extracted".
 */
function describeTextSource(fileInfo) {
  const sources = fileInfo?.textSources || [];
  const ocr = fileInfo?.ocr || null;
  const hasPdf = sources.includes('pdf-text-layer');
  const hasOcr = sources.includes('ocr');
  if (hasPdf && hasOcr) return 'Text source: selectable PDF text layer plus OCR of the rendered page.';
  if (hasPdf) return 'Text source: selectable PDF text layer (image OCR was not required).';
  if (hasOcr)
    return `Text source: OCR of the label image${ocr?.charCount ? ` — ${ocr.charCount} characters read` : ''}.`;
  if (!ocr) return 'Text source: none — no selectable text was found and OCR did not run.';
  if (ocr.status === 'failed')
    return `OCR could not run on this image (engine error: ${ocr.detail || 'unknown'}). See the scan log below for details.`;
  if (ocr.status === 'empty') return 'OCR ran on the label image but found no readable text.';
  if (ocr.status === 'low')
    return `OCR found only ${ocr.charCount} character${ocr.charCount === 1 ? '' : 's'} — below the usefulness threshold, so it was treated as no text.`;
  if (ocr.status === 'skipped') return 'OCR was skipped because the selectable PDF text layer was sufficient.';
  return 'Text source: none.';
}

function TextContentSection({ audit, items, otherItems }) {
  const facts = audit?.labelFacts || {};
  return (
    <section className="card audit-section" id="text-content-section">
      <div className="section-heading">
        <SectionTitle id="text-content-section-title">Visible label text</SectionTitle>
        <SectionStatus items={[...items, ...otherItems]} />
      </div>
      <div className="facts facts-compact text-block-grid">
        <div>
          <strong>TO block</strong>
          <pre>{(facts.toBlock || []).join('\n') || 'Not extracted'}</pre>
          <StandardLine>Address should end with uppercase suburb/state/postcode, e.g. CHULLORA NSW 2190.</StandardLine>
        </div>
        <div>
          <strong>FROM/SENDER block</strong>
          <pre>{(facts.fromBlock || []).join('\n') || 'Not extracted'}</pre>
          <StandardLine>
            Sender address should remain separate from the DG declaration, e.g. RICHMOND VIC 3121.
          </StandardLine>
        </div>
        <div>
          <strong>DG declaration</strong>
          <pre>
            {(facts.dgBlock || []).join('\n') || (facts.dangerousGoodsDeclarationPresent ? 'Present' : 'Not extracted')}
          </pre>
          <StandardLine>
            Aviation Security and Dangerous Goods Declaration should appear as its own declaration section.
          </StandardLine>
        </div>
        <div>
          <strong>Raw extracted text</strong>
          <pre>{audit.extractedText || 'No raw text extracted.'}</pre>
          <p className="small muted">{describeTextSource(audit?.fileInfo)}</p>
        </div>
      </div>
      <ValidationTable items={items} />
      {otherItems?.length > 0 && (
        <>
          <h3>Other checks</h3>
          <ValidationTable items={otherItems} />
        </>
      )}
    </section>
  );
}

// Newest-first cap for the on-screen scan timing log.
const MAX_SCAN_DEBUG_LINES = 220;

const INITIAL_WORKFLOW = {
  // Locks upload controls while the local render -> scan -> audit pipeline is active.
  processing: false,
  scanDebugLines: [],
  // Short status/error text shown above the timing log and report.
  message: '',
  // Raw rendered label data is kept so payload comparison can be refreshed without
  // rescanning PDFs/images.
  scanDatas: [],
  // Completed audit objects rendered by the report UI.
  audits: [],
  // Index of the label currently selected in the tabbed report view.
  activeIndex: 0
};

/** Audit workflow state: every transition of the scan/audit lifecycle in one place. */
function workflowReducer(state, action) {
  switch (action.type) {
    case 'message':
      return { ...state, message: action.message };
    case 'debug':
      return { ...state, scanDebugLines: [action.line, ...state.scanDebugLines].slice(0, MAX_SCAN_DEBUG_LINES) };
    case 'batch-start':
      return {
        ...state,
        processing: true,
        scanDebugLines: [],
        message: 'Preparing barcode scanner…',
        audits: [],
        scanDatas: [],
        activeIndex: 0
      };
    case 'append-result':
      return {
        ...state,
        audits: [...state.audits, action.audit],
        scanDatas: [...state.scanDatas, action.data],
        activeIndex: state.audits.length
      };
    case 'batch-complete':
      return { ...state, activeIndex: 0, message: '' };
    case 'processing-finished':
      return { ...state, processing: false };
    case 'set-active':
      return { ...state, activeIndex: action.index };
    case 'replace-audits':
      return { ...state, audits: action.audits, message: action.message };
    default:
      return state;
  }
}

function App() {
  // No carrier or label format is pre-selected: the user must consciously choose
  // both before the upload box is revealed, so a label is never audited against a
  // defaulted (and possibly wrong) rule set.
  const [selectedCarrier, setSelectedCarrier] = useState(null);
  const [selectedLabelFormat, setSelectedLabelFormat] = useState(null);
  const [workflow, dispatch] = useReducer(workflowReducer, INITIAL_WORKFLOW);
  const [zoomImage, setZoomImage] = useState(null);
  // Report view: the upload panel moves into a dismissable overlay opened from the rail.
  // Closing it preserves the current report; a new upload replaces the report.
  const [showUploader, setShowUploader] = useState(false);

  const { processing, scanDebugLines, message, scanDatas, audits, activeIndex } = workflow;
  const setMessage = text => dispatch({ type: 'message', message: text });
  // The upload box stays hidden until both audit-mode choices are made.
  const auditModeReady = Boolean(selectedCarrier && selectedLabelFormat);

  const activeAudit = audits[activeIndex] || null;
  const activeScanData = scanDatas[activeIndex] || null;
  const batchSummary = useMemo(() => combinedAuditSummary(audits), [audits]);
  const sections = useMemo(() => (activeAudit ? getAuditSections(activeAudit) : null), [activeAudit]);
  const hasReport = audits.length > 0;

  useEffect(() => {
    if (!showUploader) return undefined;
    const onKey = e => {
      if (e.key === 'Escape') setShowUploader(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showUploader]);

  /** Filters browser-selected files to the PDF/image formats the scanner can render locally. */
  function normaliseSelectedFiles(selectedFiles) {
    const rejected = [];
    const accepted = Array.from(selectedFiles || []).filter(file => {
      const name = String(file.name || '').toLowerCase();
      const type = String(file.type || '').toLowerCase();
      const supported =
        type === 'application/pdf' || type.startsWith('image/') || /\.(pdf|png|jpe?g|webp|bmp)$/.test(name);
      if (!supported) {
        rejected.push(`${file.name || 'Unnamed file'} is not a supported PDF/image label.`);
        return false;
      }
      if (file.size > MAX_LABEL_FILE_BYTES) {
        rejected.push(
          `${file.name || 'Unnamed file'} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_LABEL_FILE_BYTES)}.`
        );
        return false;
      }
      return true;
    });
    return { accepted, rejected };
  }

  /** Starts the full audit immediately after a user drops or chooses files. */
  async function acceptSelectedFiles(selectedFiles) {
    if (!selectedCarrier || !selectedLabelFormat) {
      setMessage('Select a carrier branch and a label format before uploading a label.');
      return;
    }
    const { accepted, rejected } = normaliseSelectedFiles(selectedFiles);
    const selected = accepted.slice(0, MAX_FILES_PER_BATCH);
    const limitMessages = [
      ...rejected,
      ...(accepted.length > MAX_FILES_PER_BATCH
        ? [`Only the first ${MAX_FILES_PER_BATCH} supported files were accepted for this batch.`]
        : [])
    ];
    if (!selected.length) {
      setMessage(limitMessages[0] || 'No supported PDF or image files were selected.');
      return;
    }
    if (limitMessages.length) {
      setMessage(limitMessages.join(' '));
    }
    await auditSelectedFiles(selected, { carrier: selectedCarrier, labelFormat: selectedLabelFormat });
  }

  function appendScanDebug(message, durationMs = null) {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const duration = Number.isFinite(durationMs) ? ` +${formatDurationMs(durationMs)}` : '';
    dispatch({
      type: 'debug',
      line: {
        text: `[${time}]${duration} ${message}`,
        durationMs: Number.isFinite(durationMs) ? durationMs : null
      }
    });
  }

  const scanDebugText = scanDebugLines.map(line => line.text).join('\n');

  /** Main UI pipeline: render each file/page, decode barcodes, run carrier rules, then display results. */
  async function auditSelectedFiles(files, auditMode = { carrier: 'eparcel', labelFormat: 'standard' }) {
    const labelFamily = auditMode.carrier || 'eparcel';
    const labelFormat = auditMode.labelFormat || 'standard';
    const batches = files.map(file => ({ file, labelFamily, labelFormat }));
    if (!batches.length) {
      setMessage('Choose or drop one or more PDF/image label files first.');
      return;
    }
    // A new batch replaces the report, so the "new audit" overlay's job is done here;
    // closing it without uploading keeps the existing report untouched.
    setShowUploader(false);
    dispatch({ type: 'batch-start' });
    try {
      const auditStart = performance.now();
      appendScanDebug(`Started audit batch (${batches.length} file${batches.length === 1 ? '' : 's'})`);
      const scannerStart = performance.now();
      const detector = await createDetector();
      appendScanDebug(
        detector ? 'Native BarcodeDetector ready' : 'Native BarcodeDetector unavailable; using ZXing-WASM/JS scanning',
        performance.now() - scannerStart
      );
      const nextAudits = [];
      const nextScanDatas = [];
      for (let i = 0; i < batches.length; i += 1) {
        const { file: currentFile, labelFamily, labelFormat } = batches[i];
        const carrierLabel = labelFamilyName(labelFamily);
        const formatLabel = LABEL_FORMAT_NAMES[labelFormat] || labelFormat;
        const fileDebugPrefix = `${carrierLabel} ${formatLabel} file ${i + 1}/${batches.length}: ${currentFile.name}`;
        const fileTimer = performance.now();
        const fileDebug = (message, durationMs = null) =>
          appendScanDebug(`${fileDebugPrefix} - ${message}`, durationMs);
        setMessage(`Scanning ${carrierLabel} ${formatLabel} file ${i + 1} of ${batches.length}: ${currentFile.name}`);
        const dataItems =
          currentFile.type === 'application/pdf' || currentFile.name.toLowerCase().endsWith('.pdf')
            ? await processPdfLabels(currentFile, detector, fileDebug, labelFamily)
            : await processImageLabels(currentFile, detector, fileDebug, labelFamily);
        appendScanDebug(`${fileDebugPrefix} - finished render/scan phase`, performance.now() - fileTimer);

        for (let pageIndex = 0; pageIndex < dataItems.length; pageIndex += 1) {
          const data = {
            ...dataItems[pageIndex],
            labelFamily,
            labelFormat,
            fileInfo: { ...(dataItems[pageIndex].fileInfo || {}), labelFamily, labelFormat }
          };
          const itemLabel =
            data.fileInfo?.pageLabel ||
            (data.fileInfo?.sourcePdfPage ? `page ${data.fileInfo.sourcePdfPage}` : 'image');
          setMessage(`Auditing ${currentFile.name} — ${itemLabel}`);
          const auditRuleStart = performance.now();
          const nextAudit = auditLabel({
            ...data,
            labelFamily,
            labelFormat
          });
          appendScanDebug(`${fileDebugPrefix} - ran audit rules for ${itemLabel}`, performance.now() - auditRuleStart);
          nextAudit.labelImages = data.labelImages || {};
          nextAudit.extractedText = data.extractedText || '';
          nextAudit.scanDiagnostics = data.scanDiagnostics || [];
          nextAudit.batchIndex = nextAudits.length;
          nextAudit.sourceFileIndex = i;
          nextAudit.labelFamily = labelFamily;
          nextAudit.labelFormat = labelFormat;
          nextAudit.sourcePageIndex = pageIndex;
          nextAudits.push(nextAudit);
          nextScanDatas.push(data);
          dispatch({ type: 'append-result', audit: nextAudit, data });
          await yieldToBrowser();
        }
      }
      appendScanDebug('Completed audit batch', performance.now() - auditStart);
      dispatch({ type: 'batch-complete' });
      setTimeout(() => document.getElementById('audit-result')?.scrollIntoView({ block: 'start' }), 0);
    } catch (error) {
      console.error(error);
      appendScanDebug(`Stopped with error: ${error.message || String(error)}`);
      setMessage(`Error: ${error.message || String(error)}`);
    } finally {
      dispatch({ type: 'processing-finished' });
    }
  }

  // Rendered inline on the landing view and inside the "new audit" overlay on the report
  // view, so both share one upload flow and one set of audit-mode selections.
  const uploadPanel = (
    <section className="card upload-card upload-split">
      <section className="audit-mode-panel" aria-labelledby="audit-mode-title">
        <h2 id="audit-mode-title">Audit mode</h2>
        <div className="mode-control-grid">
          <div>
            <span className="field-label">Carrier branch</span>
            <div className="segmented-control" role="group" aria-label="Carrier branch">
              {Object.entries(LABEL_FAMILY_NAMES).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={selectedCarrier === value ? 'active' : ''}
                  disabled={processing}
                  onClick={() => setSelectedCarrier(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="field-label">Label format</span>
            <div className="segmented-control" role="group" aria-label="Label format">
              {Object.entries(LABEL_FORMAT_NAMES).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={selectedLabelFormat === value ? 'active' : ''}
                  disabled={processing}
                  onClick={() => setSelectedLabelFormat(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {auditModeReady ? (
          <label
            className={`dropzone dropzone-${selectedCarrier} ${processing ? 'dropzone-disabled' : ''}`}
            onDragOver={e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={e => {
              e.preventDefault();
              if (!processing) acceptSelectedFiles(e.dataTransfer.files);
            }}
          >
            <input
              className="file-input-hidden"
              type="file"
              multiple
              accept={ACCEPTED_LABEL_FILE_TYPES}
              disabled={processing}
              onChange={e => {
                acceptSelectedFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <span className="dropzone-title">
              Drop {LABEL_FAMILY_NAMES[selectedCarrier]} {LABEL_FORMAT_NAMES[selectedLabelFormat]} labels here
            </span>
            <span className="dropzone-subtitle">PDF, PNG, JPG, WebP or BMP</span>
          </label>
        ) : (
          <p className="dropzone-pending muted" role="status">
            {!selectedCarrier && !selectedLabelFormat
              ? 'Choose a carrier branch and a label format above to enable label upload.'
              : !selectedCarrier
                ? 'Choose a carrier branch above to enable label upload.'
                : 'Choose a label format above to enable label upload.'}
          </p>
        )}
      </section>
    </section>
  );

  return (
    <main className="app">
      {/* The app is intentionally local-only: static assets and all label data stay in the browser session. */}
      {/* The report shell is the permanent backdrop: before any audit it renders as an
          empty skeleton with the upload panel hovering over it. */}
      <section className="results report-shell">
        <aside className="rail" aria-label="Audit overview and navigation">
          {/* The rail card spans the full page length; this inner wrapper is the part that
              stays pinned to the viewport and scrolls itself if it outgrows the screen. */}
          <div className="rail-inner">
            <div className="rail-brand">
              {/* Same AP emblem, tinted StarTrack blue when the audit (or the picker) is StarTrack. */}
              <img
                className={`rail-logo ${
                  (activeAudit ? activeAudit.selectedAuditMode?.carrier || activeAudit.carrier : selectedCarrier) ===
                  'startrack'
                    ? 'rail-logo-startrack'
                    : ''
                }`}
                src={australiaPostLogoUrl}
                alt="Australia Post"
              />
            </div>
            {hasReport ? (
              <div
                className={`rail-verdict summary-${batchSummary.overallStatus.toLowerCase()}`}
                id="audit-result"
                role="status"
              >
                <span className="rail-verdict-label">Audit result</span>
                <strong className={`rail-verdict-status overall-${batchSummary.overallStatus.toLowerCase()}`}>
                  {batchSummary.overallStatus}
                </strong>
                <span className="rail-verdict-counts">
                  {batchSummary.passed} passed · {batchSummary.manualReview} review · {batchSummary.failed} fail
                  {batchSummary.failed === 1 ? '' : 's'}
                </span>
              </div>
            ) : (
              <div className="rail-verdict rail-verdict-empty" id="audit-result" role="status">
                <span className="rail-verdict-label">Audit result</span>
                <strong className="rail-verdict-status">—</strong>
                <span className="rail-verdict-counts">Upload a label to begin</span>
              </div>
            )}
            {audits.length > 1 && (
              <div className="rail-files" role="tablist" aria-label="Uploaded labels">
                <span className="rail-block-title">Labels ({audits.length})</span>
                {audits.map((item, idx) => {
                  const h = auditDisplayHeader(item, idx);
                  const consignment = auditConsignmentId(item);
                  const tone = String(item.summary?.overallStatus || 'review').toLowerCase();
                  return (
                    <button
                      key={`${h.articleNumber}-${idx}`}
                      type="button"
                      role="tab"
                      aria-selected={idx === activeIndex}
                      className={`rail-file rail-${tone === 'pass' ? 'pass' : tone === 'fail' ? 'fail' : 'review'} ${idx === activeIndex ? 'active' : ''}`}
                      onClick={() => dispatch({ type: 'set-active', index: idx })}
                    >
                      <span className="rail-file-head">
                        <span className="nav-dot" aria-hidden="true" />
                        <code className="rail-file-article">{h.articleNumber}</code>
                      </span>
                      <span className="rail-file-sub">
                        {consignment ? `Consignment ${consignment}` : 'Consignment not detected'}
                      </span>
                      <span className="rail-file-sub">
                        {h.productCode ? `${h.productCode} — ${h.productName || h.product}` : h.product}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {activeAudit && sections && <RailNav audit={activeAudit} sections={sections} />}
            {!hasReport && (
              <div className="rail-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            )}
            <a className="rail-feedback" href={FEEDBACK_URL} target="_blank" rel="noreferrer">
              Feedback
            </a>
          </div>
        </aside>
        <div className="report-main">
          {processing && (
            <section className="scan-progress card" aria-live="polite">
              <div className="scan-progress-head">
                <div>
                  <strong>Scanning labels</strong>
                  <span>{message || 'Processing labels'}</span>
                </div>
              </div>
            </section>
          )}
          {!processing && message && (
            <section className="message" aria-live="polite">
              {message}
            </section>
          )}
          {!hasReport && !processing && (
            <div className="skeleton-report" aria-hidden="true">
              <section className="card">
                <span className="skl skl-w30" />
                <span className="skl skl-lg skl-w60" />
                <span className="skl skl-w80" />
              </section>
              <section className="card">
                <span className="skl skl-w40" />
                <span className="skl skl-w90" />
                <span className="skl skl-w80" />
                <span className="skl skl-w60" />
              </section>
              <section className="card">
                <span className="skl skl-w30" />
                <span className="skl skl-w80" />
                <span className="skl skl-w70" />
              </section>
            </div>
          )}
          {activeAudit &&
            sections &&
            (() => {
              const h = auditDisplayHeader(activeAudit, activeIndex);
              return (
                <section className="single-audit-view" key={`${h.articleNumber}-${activeIndex}`}>
                  <section className="card compact-card selected-label-header">
                    <button
                      type="button"
                      className="new-audit-btn"
                      onClick={() => setShowUploader(true)}
                      disabled={processing}
                      title="Start a new audit (keeps this report until a new label is uploaded)"
                    >
                      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
                        <path
                          d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <path d="M14 3v6h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        <path
                          d="M12 11v6M9 14h6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span>New audit</span>
                    </button>
                    <span className="selected-label-eyebrow">Article number</span>
                    <div className="selected-label-number">
                      <code>{h.articleNumber}</code>
                      <CopyButton
                        value={allBarcodesCopyText(activeAudit)}
                        label="Copy every decoded barcode value, one per line"
                        text="Copy all label data"
                      />
                    </div>
                    <div className="selected-label-meta">
                      <span>
                        <span className="meta-k">Mode</span>
                        <span className="meta-v">
                          {LABEL_FAMILY_NAMES[activeAudit.selectedAuditMode?.carrier || activeAudit.carrier] ||
                            activeAudit.carrier}{' '}
                          /{' '}
                          {LABEL_FORMAT_NAMES[activeAudit.selectedAuditMode?.labelFormat || activeAudit.labelFormat] ||
                            activeAudit.labelFormat ||
                            'standard'}
                        </span>
                      </span>
                      <span>
                        <span className="meta-k">Rule set</span>
                        <span className="meta-v">{activeAudit.ruleSet?.name || 'carrier defaults'}</span>
                      </span>
                      <span>
                        <span className="meta-k">Product</span>
                        <span className="meta-v">
                          {h.productCode ? `${h.productCode} — ${h.productName}` : h.product}
                        </span>
                      </span>
                      <span>
                        <span className="meta-k">
                          {activeAudit.carrier === 'startrack' ? 'Routing / service' : 'Service code'}
                        </span>
                        <span className="meta-v">
                          {h.serviceCode || 'not parsed'}
                          {h.serviceName ? ` — ${h.serviceName}` : ''}
                        </span>
                      </span>
                      <span>
                        <span className="meta-k">File</span>
                        <span className="meta-v">{h.displayFile || h.filename}</span>
                      </span>
                    </div>
                  </section>

                  {/* Full label image always leads the report so the reviewer sees the label first. */}
                  <FullLabelImageSection audit={activeAudit} items={sections.label} onZoomLabel={setZoomImage} />
                  <AuditModeSection items={sections.mode} />
                  {activeAudit.carrier === 'startrack' ? (
                    <>
                      <StarTrackQrSection
                        audit={activeAudit}
                        items={sections.datamatrix}
                        scanData={activeScanData || activeAudit}
                      />
                      <StarTrackRoutingSection
                        audit={activeAudit}
                        items={sections.routing}
                        scanData={activeScanData || activeAudit}
                      />
                      <StarTrackAtlSection
                        audit={activeAudit}
                        items={sections.atl}
                        scanData={activeScanData || activeAudit}
                      />
                      <StarTrackFreightItemSection
                        audit={activeAudit}
                        items={sections.freight}
                        scanData={activeScanData || activeAudit}
                      />
                    </>
                  ) : (
                    <>
                      <DataMatrixSection
                        audit={activeAudit}
                        items={sections.datamatrix}
                        scanData={activeScanData || activeAudit}
                      />
                      <LinearBarcodeSection
                        audit={activeAudit}
                        items={sections.linear}
                        scanData={activeScanData || activeAudit}
                      />
                    </>
                  )}
                  <AdditionalBarcodesSection audit={activeAudit} />
                  <ServiceArticleBreakdownSection audit={activeAudit} items={sections.service} />
                  {activeAudit.invalidArticleCandidates?.length > 0 && (
                    <section className="card audit-section" id="invalid-article-candidates">
                      <SectionTitle id="invalid-article-candidates-title">Invalid article candidate(s)</SectionTitle>
                      {activeAudit.invalidArticleCandidates.map(item => (
                        <p key={item.candidate}>
                          <code>{item.candidate}</code> — {item.reason}
                        </p>
                      ))}
                    </section>
                  )}
                  <TextContentSection audit={activeAudit} items={sections.text} otherItems={sections.other} />
                </section>
              );
            })()}
        </div>
      </section>

      {!processing && (showUploader || !hasReport) && (
        <div
          className="uploader-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={hasReport ? 'Start a new audit' : APP_TITLE}
          onClick={() => {
            if (hasReport) setShowUploader(false);
          }}
        >
          <div className="uploader-modal" onClick={e => e.stopPropagation()}>
            <div className="uploader-modal-head">
              <h2>{hasReport ? 'New audit' : APP_TITLE}</h2>
              {hasReport && (
                <button
                  type="button"
                  className="uploader-close"
                  onClick={() => setShowUploader(false)}
                  aria-label="Close and keep the current report"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </div>
            <p className="muted small uploader-modal-note">
              {hasReport
                ? 'Uploading a new label replaces the current report. Close this window to keep it.'
                : 'Select the carrier and label format being tested, then upload the label. A wrong selection fails the audit-mode check while the full report still runs.'}
            </p>
            {uploadPanel}
          </div>
        </div>
      )}

      {scanDebugLines.length > 0 && (
        <section className="card scan-debug-card">
          <details open={processing}>
            <summary>Debug timing log</summary>
            <label className="scan-debug-label" htmlFor="scan-debug-log">
              Full timing log
            </label>
            <textarea
              id="scan-debug-log"
              className="scan-debug-log"
              rows="8"
              readOnly
              value={scanDebugText}
              placeholder="Timing events will appear here while files are processed."
            />
          </details>
        </section>
      )}
      <ImageZoomModal image={zoomImage} onClose={() => setZoomImage(null)} />
      <footer className="app-version" aria-label={`Application version ${APP_VERSION}`}>
        {APP_TITLE} {APP_VERSION}
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
