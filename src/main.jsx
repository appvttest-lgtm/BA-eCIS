import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { auditLabel, groupValidations, SERVICE_CODE_MAP, STARTRACK_PRODUCT_CODE_MAP } from './auditEngine.js';
import { RuleReport } from './reportView.jsx';
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
const MAX_OPTIONAL_PAYLOAD_CHARS = 500_000;

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
    Boolean(audit?.expectedSscc?.provided) ||
    (articles.some(a => a?.type === 'sscc') && !articles.some(a => a?.type === 'eparcel-standard'))
  );
}

function isSsccArticle(article) {
  return article?.type === 'sscc';
}

const SERVICE_REFERENCE_ROWS = [
  {
    serviceCode: '03',
    flags: { safeDrop: false, signature: true, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature'],
      ['00065', 'Parcel Post Return'],
      ['00068', 'Express Post Return']
    ]
  },
  {
    serviceCode: '08',
    flags: { safeDrop: false, signature: false, atl: true, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: false, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature'],
      ['00065', 'Parcel Post Return'],
      ['00068', 'Express Post Return']
    ]
  },
  {
    serviceCode: '45',
    flags: { safeDrop: false, signature: true, atl: false, partial: true, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '15',
    flags: { safeDrop: false, signature: false, atl: true, partial: true, noSignature: false },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '50',
    flags: { safeDrop: true, signature: false, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: true },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '51',
    flags: { safeDrop: true, signature: false, atl: false, partial: true, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: true, safe_drop_enabled: true },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '09',
    flags: { safeDrop: false, signature: false, atl: false, partial: true, noSignature: true },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [
      ['00091', 'Parcel Post (Non-Signature)'],
      ['00087', 'Express Post (Non-Signature)']
    ]
  },
  {
    serviceCode: '49*',
    matchCode: '49',
    flags: { safeDrop: false, signature: true, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: false },
    apiNote: 'IDENTITY_ON_DELIVERY feature must be used with an id_capture_type value of “addressee”.',
    products: [['00093', 'Parcel Post Signature (Wine)']]
  },
  {
    serviceCode: '81',
    flags: { safeDrop: false, signature: true, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: false },
    products: [['00093', 'Parcel Post Signature (Wine)']]
  },
  {
    serviceCode: '82',
    flags: { safeDrop: false, signature: false, atl: true, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [['00093', 'Parcel Post Signature (Wine)']]
  },
  {
    serviceCode: '83',
    flags: { safeDrop: true, signature: false, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: true },
    products: [['00093', 'Parcel Post Signature (Wine)']]
  }
];

function serviceRowMatchCode(row) {
  return row.matchCode || row.serviceCode.replace(/\D/g, '');
}

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

function dmParseList(audit) {
  return (audit?.parsed || []).filter(p => p && Object.prototype.hasOwnProperty.call(p, 'hasAi420'));
}

function barcodeDisplayName(b) {
  const value = String(b?.format || b?.symbology || '').toLowerCase();
  if (value.includes('data')) return 'GS1 DataMatrix';
  if (value.includes('qr') || b?.kind === FORMAT_KIND.qr) return 'QR Barcode';
  if (value.includes('128') || b?.kind === FORMAT_KIND.linear) return 'Linear / Code128';
  return b?.format || b?.symbology || 'barcode';
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

function StatusBadge({ status }) {
  return <span className={`badge badge-${String(status).toLowerCase()}`}>{status}</span>;
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
  const showPayloadColumn = auditHasApiPayload(audit);
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
              {showPayloadColumn && <th>Get Shipments match</th>}
            </tr>
          </thead>
          <tbody>
            {SERVICE_REFERENCE_ROWS.map(row => {
              const matchedService = selectedServices.includes(serviceRowMatchCode(row));
              return row.products.map(([productCode, productName], productIndex) => {
                const matchedProduct = selectedProducts.includes(productCode);
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
                    {showPayloadColumn && (
                      <td>
                        <span
                          className={`payload-match ${selectedEparcelServiceRowPayloadStatus(audit, row, productCode) === 'Match' ? 'payload-match-match' : selectedEparcelServiceRowPayloadStatus(audit, row, productCode) === 'Does not match' ? 'payload-match-mismatch' : 'payload-match-not_checked'}`}
                        >
                          {selectedEparcelServiceRowPayloadStatus(audit, row, productCode)}
                        </span>
                      </td>
                    )}
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

function SectionStatus({ items }) {
  const tone = sectionTone(items);
  return <span className={`section-status section-status-${tone}`}>{tone === 'neutral' ? 'no checks' : tone}</span>;
}

function AuditModeSection({ audit, items }) {
  const mode = audit?.selectedAuditMode || {
    carrier: audit?.carrier || 'eparcel',
    labelFormat: auditHasSsccOnly(audit) ? 'sscc' : 'standard'
  };
  return (
    <section className="card audit-section mode-section" id="audit-mode-section">
      <div className="section-heading">
        <SectionTitle id="audit-mode-section-title">Selected audit mode</SectionTitle>
        <SectionStatus items={items} />
      </div>
      <div className="fact-cards fact-cards-wide">
        <div>
          <span>carrier branch</span>
          <strong>{LABEL_FAMILY_NAMES[mode.carrier] || mode.carrier}</strong>
        </div>
        <div>
          <span>label format</span>
          <strong>{LABEL_FORMAT_NAMES[mode.labelFormat] || mode.labelFormat}</strong>
        </div>
        <div>
          <span>format rule</span>
          <strong>{mode.labelFormat === 'sscc' ? 'AI 00 SSCC expected' : 'standard article barcode expected'}</strong>
        </div>
        <div>
          <span>wrong toggle handling</span>
          <strong>fails mode check; full report still runs</strong>
        </div>
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
            <code className="raw-code raw-code-block">{b.rawValue}</code>
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

function hasApiPayloadComparison(items = []) {
  return (items || []).some(v => v?.apiPayloadMatch);
}

function formatApiPayloadEvidence(match) {
  if (!match) return '';
  const lines = [];
  if (match.field) lines.push(`comparison_field: ${match.field}`);
  if (match.detail) lines.push(`comparison: ${match.detail}`);
  if (match.evidence) {
    lines.push('', 'json_payload_evidence:');
    lines.push(match.evidence);
  }
  return lines.join('\n').trim();
}

function auditHasApiPayload(audit) {
  return Boolean(audit?.apiPayload?.provided);
}

function auditPayloadIdentityMismatch(audit) {
  return Boolean(audit?.apiPayload?.identityGateApplied && audit?.apiPayload?.identityMatchesLabel === false);
}

function selectedEparcelServiceRowPayloadStatus(audit, row, productCode) {
  if (!auditHasApiPayload(audit)) return null;
  if (auditPayloadIdentityMismatch(audit)) return 'N/A';
  const articles = audit?.articles || [];
  const selected = articles.some(a => a?.serviceCode === serviceRowMatchCode(row) && a?.productCode === productCode);
  if (!selected) return 'N/A';
  const checks = [];
  const payloadText = String(audit.apiPayload?.rawText || '').toUpperCase();
  if (payloadText) {
    checks.push(payloadText.includes(String(serviceRowMatchCode(row)).toUpperCase()));
    checks.push(payloadText.includes(String(productCode).toUpperCase()));
    for (const [key, value] of Object.entries(row.apiPayload || {})) {
      if (payloadText.includes(String(key).toUpperCase()))
        checks.push(payloadText.includes(String(value).toUpperCase()));
    }
  }
  return checks.length ? (checks.every(Boolean) ? 'Match' : 'Does not match') : 'N/A';
}

function selectedStarTrackProductPayloadStatus(audit, productCode, labelCode) {
  if (!auditHasApiPayload(audit)) return null;
  if (auditPayloadIdentityMismatch(audit)) return 'N/A';
  const text = String(audit.apiPayload?.rawText || '').toUpperCase();
  const selected =
    (audit?.startrack?.freightParses || []).some(f => f.productCode === productCode) ||
    (audit?.startrack?.qrParses || []).some(q => q.productCode === productCode) ||
    (audit?.startrack?.routingParses || []).some(r => r.labelCode === labelCode) ||
    audit?.labelFacts?.labelCode === labelCode;
  if (!selected) return 'N/A';
  return text.includes(String(productCode).toUpperCase()) || text.includes(String(labelCode).toUpperCase())
    ? 'Match'
    : 'Does not match';
}

function ApiPayloadEvidenceCell({ match }) {
  if (!match) return <span className="muted small">No payload comparison.</span>;
  const evidence = formatApiPayloadEvidence(match);
  return (
    <div className="measurement-cell payload-measurement-cell">
      {match.field && (
        <div>
          <span className="measurement-label">Payload field</span>
          <code>{match.field}</code>
        </div>
      )}
      {match.detail && (
        <div>
          <span className="measurement-label">Payload comparison</span>
          {match.detail}
        </div>
      )}
      {evidence && (
        <details className="payload-evidence">
          <summary>JSON evidence</summary>
          <pre>{evidence}</pre>
        </details>
      )}
    </div>
  );
}

function ValidationTable({ items }) {
  if (!items || !items.length) return <p className="muted small">No validation checks in this section.</p>;
  const showPayloadColumn = hasApiPayloadComparison(items);
  return (
    <RuleReport
      items={items}
      standardFor={standardForValidation}
      showPayload={showPayloadColumn}
      renderPayload={match => <ApiPayloadEvidenceCell match={match} />}
    />
  );
}

function AuditBookmarks({ audit, sections }) {
  const reviewItems = (audit?.validations || []).filter(
    v => v.status === 'manual_review' || v.status === 'warning' || v.status === 'fail'
  );
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
    <section className="card nav-card">
      <div className="quick-nav">
        {nav.map(([id, label, items]) => (
          <a key={id} href={`#${id}`}>
            {label} <SectionStatus items={items} />
          </a>
        ))}
      </div>
      {reviewItems.length > 0 && (
        <div className="review-list">
          <h3 id="review-bookmarks">Review bookmarks</h3>
          <ul>
            {reviewItems.map(v => (
              <li key={v.id}>
                <a href={`#rule-${v.id}`}>{v.title}</a> <StatusBadge status={v.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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
          <p className="muted">Checks the required StarTrack QR payload.</p>
          <StandardLine>
            StarTrack QR fields are fixed width and include receiver suburb/postcode, connote, freight item number,
            product code, quantity, weight, despatch date, unit type, destination depot, DG indicator and movement type.
          </StandardLine>
          <div className="decoded-panel">
            <h3>Raw decoded QR string</h3>
            {qrBarcodes.length ? (
              <ul className="barcode-list decoded-list">
                {qrBarcodes.map(b => (
                  <li key={`${b.pageNumber || 0}-${b.rawValue}`}>
                    <div className="barcode-meta">
                      <strong>QR</strong> page {b.pageNumber || ''}
                    </div>
                    <code className="raw-code raw-code-block">{b.rawValue}</code>
                    <div className="muted small">
                      {b.pageBoundingBox
                        ? 'Barcode location verified on this label.'
                        : 'Barcode decoded; exact location not mapped.'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No StarTrack QR value decoded from the uploaded file.</p>
            )}
          </div>
          {qrs.length > 0 &&
            qrs.map(qr => (
              <div key={qr.raw} className="fact-cards fact-cards-wide">
                <div>
                  <span>product_code</span>
                  <strong>
                    {qr.productCode} — {qr.productName}
                  </strong>
                </div>
                <div>
                  <span>consignment_id</span>
                  <strong>{qr.fields.connoteNumber}</strong>
                </div>
                <div>
                  <span>article_id</span>
                  <strong>{qr.fields.freightItemNumber}</strong>
                </div>
                <div>
                  <span>weight / cubic_volume</span>
                  <strong>
                    {qr.fields.consignmentWeight || '-'}kg / {qr.fields.consignmentCube || '-'}
                  </strong>
                </div>
                <div>
                  <span>dangerous_goods / movement_type</span>
                  <strong>
                    {qr.fields.dangerousGoodsIndicator || '-'} / {qr.fields.movementTypeIndicator || '-'}
                  </strong>
                </div>
              </div>
            ))}
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
          <h3>Decoded routing barcode values</h3>
          {routingBarcodes.length ? (
            <ul className="barcode-list">
              {routingBarcodes.map(b => (
                <li key={`${b.pageNumber || 0}-${b.rawValue}`}>
                  <strong>Routing barcode</strong>: <code>{b.rawValue}</code>
                  <br />
                  <span className="muted small">
                    {b.pageBoundingBox
                      ? 'Barcode location verified on this label.'
                      : 'Barcode decoded; exact location not mapped.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No StarTrack routing barcode value decoded.</p>
          )}
          {routes.length > 0 && (
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
          <StandardLine>
            StarTrack routing barcode is required separately from the freight item and ATL barcodes. Standard format is
            SSS9999DD/DDD: Premium and Fixed Price Premium labels commonly use a three-character depot/port suffix,
            while Express labels may use a two-character suffix. AU domestic SSCC labels may use GS1 421/403 routing.
          </StandardLine>
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
          <h3>Decoded ATL barcode values</h3>
          {atlBarcodes.length ? (
            <ul className="barcode-list">
              {atlBarcodes.map(b => (
                <li key={`${b.pageNumber || 0}-${b.rawValue}`}>
                  <strong>ATL barcode</strong>: <code>{b.rawValue}</code>
                  <br />
                  <span className="muted small">
                    {b.pageBoundingBox
                      ? 'Barcode location verified on this label.'
                      : 'Barcode decoded; exact location not mapped.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No StarTrack ATL barcode value decoded.</p>
          )}
          {atlParses.length > 0 && (
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
          <StandardLine>
            StarTrack ATL barcode content is C999999999. C is always the character C and the nine-digit sequential
            counter starts at 000000001. Preferred orientation is Picket Fence, minimum bar height 10mm, minimum barcode
            length 28mm, left/right quiet zone 5mm, and resolution 6 dots per mm.
          </StandardLine>
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
          <h3>Decoded freight item barcode values</h3>
          {freightBarcodes.length ? (
            <ul className="barcode-list">
              {freightBarcodes.map(b => (
                <li key={`${b.pageNumber || 0}-${b.rawValue}`}>
                  <strong>Freight item barcode</strong>: <code>{b.rawValue}</code>
                  <br />
                  <span className="muted small">
                    {b.pageBoundingBox
                      ? 'Barcode location verified on this label.'
                      : 'Barcode decoded; exact location not mapped.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No StarTrack freight item / SSCC barcode value decoded.</p>
          )}
          {freightParses.length > 0 && (
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
          {ssccs.length > 0 && (
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
          )}
          <StandardLine>
            StarTrack freight item barcode is mandatory and is separate from the routing barcode. It is either
            20-character Code128 XXXZ99999999AAA99999 or GS1 AI 00 SSCC.
          </StandardLine>
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function DataMatrixSection({ audit, items }) {
  const images = audit?.labelImages || {};
  const dataMatrixBarcodes = decodedBarcodeList(audit, 'datamatrix');
  const dmParses = dmParseList(audit);
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
          {auditHasSsccOnly(audit) ? (
            <StandardLine>
              SSCC labels use AI 00. eParcel AI 91/product/service evaluation is not applicable to an SSCC barcode.
            </StandardLine>
          ) : (
            <StandardLine>
              GS1 DataMatrix should include AI 01, AI 91, AI 420 postcode and AI 8008 date/time. AI 92 DPID is optional.
            </StandardLine>
          )}

          <div className="decoded-panel">
            <h3>Raw decoded GS1 DataMatrix string</h3>
            {dataMatrixBarcodes.length ? (
              <ul className="barcode-list decoded-list">
                {dataMatrixBarcodes.map(b => (
                  <li key={`${b.pageNumber || 0}-${b.rawValue}`}>
                    <div className="barcode-meta">
                      <strong>{b.format || b.symbology || 'DataMatrix'}</strong> page {b.pageNumber || ''}
                    </div>
                    <code className="raw-code raw-code-block">{b.rawValue}</code>
                    <div className="muted small">
                      {b.pageBoundingBox
                        ? 'Barcode location verified on this label.'
                        : 'Barcode decoded; exact location not mapped.'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No GS1 DataMatrix value decoded from the uploaded file.</p>
            )}
          </div>

          {dmParses.length > 0 && (
            <div className="decoded-panel ai-panel">
              <h3>GS1 DataMatrix AI breakdown</h3>
              {dmParses.map(dm => (
                <div key={dm.raw} className="fact-cards dm-ai-cards">
                  <div>
                    <span>AI 01 GTIN</span>
                    <strong>{dm.compact?.slice(2, 16) || 'Not parsed'}</strong>
                  </div>
                  <div>
                    <span>AI 91 article</span>
                    <strong>{dm.article?.articleId || dm.base?.article?.articleId || 'Not parsed'}</strong>
                  </div>
                  <div>
                    <span>AI 420 postcode</span>
                    <strong>{dm.postcode || 'Not present'}</strong>
                  </div>
                  <div>
                    <span>AI 92 DPID</span>
                    <strong>{dm.dpid || 'Not present / omitted'}</strong>
                  </div>
                  <div>
                    <span>AI 8008 date/time</span>
                    <strong>{dm.dateTime || 'Not present'}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}

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
          <h3>Decoded linear barcode values</h3>
          {linearBarcodes.length ? (
            <ul className="barcode-list">
              {linearBarcodes.map(b => (
                <li key={`${b.pageNumber || 0}-${b.rawValue}`}>
                  <strong>{barcodeDisplayName(b)}</strong>: <code>{b.rawValue}</code>
                  <br />
                  <span className="muted small">
                    {b.pageBoundingBox
                      ? 'Barcode location verified on this label.'
                      : 'Barcode decoded; exact location not mapped.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No Code128/GS1-128 value decoded.</p>
          )}
          {auditHasSsccOnly(audit) ? (
            <StandardLine>
              SSCC linear barcodes use AI 00 and should decode to a valid SSCC value. eParcel
              product/service/check-digit fields are not encoded in the SSCC value.
            </StandardLine>
          ) : (
            <StandardLine>
              Linear GS1-128 should encode AI 01 + AusPost GTIN, AI 91 + article component, with a valid eParcel check
              digit.
            </StandardLine>
          )}
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
      <details open className="reference-details">
        <summary>StarTrack product and label-code reference</summary>
        <StarTrackProductMatrix audit={audit} />
      </details>
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
  const showPayloadColumn = auditHasApiPayload(audit);
  return (
    <div className="table-wrap">
      <table className="compact-table startrack-matrix">
        <thead>
          <tr>
            <th>Product Code</th>
            <th>Product Name</th>
            <th>Group</th>
            <th>Label Code</th>
            {showPayloadColumn && <th>Get Shipments match</th>}
          </tr>
        </thead>
        <tbody>
          {Object.entries(STARTRACK_PRODUCT_CODE_MAP).map(([code, meta]) => {
            const payloadStatus = selectedStarTrackProductPayloadStatus(audit, code, meta.labelCode);
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
                {showPayloadColumn && (
                  <td>
                    <span
                      className={`payload-match ${payloadStatus === 'Match' ? 'payload-match-match' : payloadStatus === 'Does not match' ? 'payload-match-mismatch' : 'payload-match-not_checked'}`}
                    >
                      {payloadStatus}
                    </span>
                  </td>
                )}
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
      {!ssccOnly && (
        <details open className="reference-details">
          <summary>Service code and product matrix</summary>
          <ServiceCodeMatrix audit={audit} />
        </details>
      )}
    </section>
  );
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
  // Optional Get Shipments payload pasted by the user. It is never sent anywhere; it is
  // parsed locally and compared only after the label identity appears to match.
  const [manifestJson, setManifestJson] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState('eparcel');
  const [selectedLabelFormat, setSelectedLabelFormat] = useState('standard');
  const [ssccExtensionDigit, setSsccExtensionDigit] = useState('');
  const [ssccCompanyPrefix, setSsccCompanyPrefix] = useState('');
  const [workflow, dispatch] = useReducer(workflowReducer, INITIAL_WORKFLOW);
  const [zoomImage, setZoomImage] = useState(null);

  const { processing, scanDebugLines, message, scanDatas, audits, activeIndex } = workflow;
  const setMessage = text => dispatch({ type: 'message', message: text });

  const activeAudit = audits[activeIndex] || null;
  const activeScanData = scanDatas[activeIndex] || null;
  const batchSummary = useMemo(() => combinedAuditSummary(audits), [audits]);

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
    if (manifestJson.length > MAX_OPTIONAL_PAYLOAD_CHARS) {
      setMessage(
        `Optional payload is ${formatBytes(manifestJson.length)} of text; the safe limit is ${formatBytes(MAX_OPTIONAL_PAYLOAD_CHARS)}.`
      );
      return;
    }
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
            manifestJson,
            ssccCompanyPrefix,
            ssccExtensionDigit,
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

  /** Re-runs validation with current optional inputs without re-rendering or re-decoding labels. */
  function rerunAuditWithOptionalInputs() {
    if (!scanDatas.length) {
      setMessage('No scanned file data is available yet. Upload and audit one or more labels first.');
      return;
    }
    if (manifestJson.length > MAX_OPTIONAL_PAYLOAD_CHARS) {
      setMessage(
        `Optional payload is ${formatBytes(manifestJson.length)} of text; the safe limit is ${formatBytes(MAX_OPTIONAL_PAYLOAD_CHARS)}.`
      );
      return;
    }
    const refreshed = scanDatas.map((base, idx) => {
      const nextAudit = auditLabel({
        ...base,
        manifestJson,
        ssccCompanyPrefix,
        ssccExtensionDigit,
        labelFamily: base.labelFamily || base.fileInfo?.labelFamily || 'eparcel',
        labelFormat: base.labelFormat || base.fileInfo?.labelFormat || selectedLabelFormat
      });
      nextAudit.labelImages = base.labelImages || {};
      nextAudit.extractedText = base.extractedText || '';
      nextAudit.scanDiagnostics = base.scanDiagnostics || [];
      nextAudit.batchIndex = idx;
      return nextAudit;
    });
    dispatch({
      type: 'replace-audits',
      audits: refreshed,
      message: 'Optional payload and SSCC prefix checks refreshed for all uploaded labels.'
    });
  }

  return (
    <main className="app">
      {/* The app is intentionally local-only: static assets and all label data stay in the browser session. */}
      <header className="hero hero-compact">
        <img className="ap-mark" src={australiaPostLogoUrl} alt="Australia Post" />
        <div>
          <h1>{APP_TITLE}</h1>
          <p>
            Select the carrier and label format being tested, then upload the label. A wrong selection fails the
            audit-mode check while the full report still runs.
          </p>
        </div>
        <a className="feedback-button" href={FEEDBACK_URL} target="_blank" rel="noreferrer">
          Feedback
        </a>
      </header>

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
        </section>
        <div className="optional-input-grid">
          <section className="payload-input-panel" aria-labelledby="payload-input-title">
            <h2 id="payload-input-title">Get Shipments API payload comparison</h2>
            <p className="muted small">
              Optional: paste a Get Shipments response before upload, or apply it to the current report.
            </p>
            <textarea
              className="api-payload-textarea"
              rows="8"
              placeholder={`Paste Get Shipments payload here, for example:
{
  "shipments": [{
    "shipment_id": "...",
    "items": [{ "item_id": "..." }],
    "authority_to_leave": true,
    "allow_partial_delivery": true,
    "safe_drop_enabled": false
  }]
}`}
              value={manifestJson}
              onChange={e => setManifestJson(e.target.value)}
            />
          </section>
          <section className="sscc-prefix-panel" aria-labelledby="sscc-prefix-title">
            <h2 id="sscc-prefix-title">SSCC extension and prefix</h2>
            <p className="muted small">
              Used when SSCC article identifier is selected. The decoded AI 00 barcode is checked against the supplied
              extension digit and GS1 Company Prefix when provided.
            </p>
            <label className="field-label" htmlFor="sscc-extension-digit">
              Extension digit
            </label>
            <input
              id="sscc-extension-digit"
              className="sscc-prefix-input"
              type="text"
              inputMode="numeric"
              placeholder="003"
              value={ssccExtensionDigit}
              onChange={e => setSsccExtensionDigit(e.target.value)}
            />
            <label className="field-label" htmlFor="sscc-company-prefix">
              Company prefix
            </label>
            <input
              id="sscc-company-prefix"
              className="sscc-prefix-input"
              type="text"
              inputMode="numeric"
              placeholder="9315345"
              value={ssccCompanyPrefix}
              onChange={e => setSsccCompanyPrefix(e.target.value)}
            />
            <p className="muted small">
              Example: SSCC (00) 3 9315345 000000070 0 uses extension digit 3 and company prefix 9315345.
            </p>
          </section>
          {scanDatas.length > 0 && (
            <button className="secondary optional-input-apply" onClick={rerunAuditWithOptionalInputs}>
              Apply optional checks to current results
            </button>
          )}
        </div>
      </section>

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

      {audits.length > 0 && (
        <section className="results">
          <div
            className={`summary card compact-card consolidated-summary summary-${batchSummary.overallStatus.toLowerCase()}`}
          >
            <div>
              <SectionTitle id="audit-result">Audit result</SectionTitle>
              <p className={`overall overall-${batchSummary.overallStatus.toLowerCase()}`}>
                {batchSummary.overallStatus}
              </p>
            </div>
          </div>

          <section className="card compact-card label-tabs-card">
            <h2>Uploaded label results</h2>
            <div className="label-tabs" role="tablist" aria-label="Uploaded label audit results">
              {audits.map((item, idx) => {
                const h = auditDisplayHeader(item, idx);
                return (
                  <button
                    key={`${h.articleNumber}-${idx}`}
                    type="button"
                    role="tab"
                    aria-selected={idx === activeIndex}
                    className={`label-tab ${idx === activeIndex ? 'active' : ''}`}
                    onClick={() => dispatch({ type: 'set-active', index: idx })}
                  >
                    <span className="tab-index">{idx + 1}</span>
                    <span className="tab-main">
                      <code>{h.articleNumber}</code>
                    </span>
                    <span className="tab-sub">
                      {h.product} · Service {h.serviceCode || 'not parsed'}
                    </span>
                    <StatusBadge status={item.summary?.overallStatus || 'UNKNOWN'} />
                  </button>
                );
              })}
            </div>
          </section>

          {activeAudit &&
            (() => {
              const sections = getAuditSections(activeAudit);
              const h = auditDisplayHeader(activeAudit, activeIndex);
              return (
                <section className="single-audit-view" key={`${h.articleNumber}-${activeIndex}`}>
                  <section className="card compact-card selected-label-header">
                    <h2>
                      Article Number: <code>{h.articleNumber}</code>
                    </h2>
                    <div className="selected-label-meta">
                      <span>
                        <strong>Mode:</strong>{' '}
                        {LABEL_FAMILY_NAMES[activeAudit.selectedAuditMode?.carrier || activeAudit.carrier] ||
                          activeAudit.carrier}{' '}
                        /{' '}
                        {LABEL_FORMAT_NAMES[activeAudit.selectedAuditMode?.labelFormat || activeAudit.labelFormat] ||
                          activeAudit.labelFormat ||
                          'standard'}
                      </span>
                      <span>
                        <strong>Product:</strong> {h.productCode ? `${h.productCode} — ${h.productName}` : h.product}
                      </span>
                      <span>
                        <strong>{activeAudit.carrier === 'startrack' ? 'Routing / service:' : 'Service Code:'}</strong>{' '}
                        {h.serviceCode || 'not parsed'}
                        {h.serviceName ? ` — ${h.serviceName}` : ''}
                      </span>
                      <span>
                        <strong>File:</strong> {h.displayFile || h.filename}
                      </span>
                    </div>
                  </section>

                  <AuditBookmarks audit={activeAudit} sections={sections} />
                  <AuditModeSection audit={activeAudit} items={sections.mode} />
                  <FullLabelImageSection audit={activeAudit} items={sections.label} onZoomLabel={setZoomImage} />
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
        </section>
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
