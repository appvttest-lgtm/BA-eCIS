// Core audit engine: text-fact extraction, rule contexts, and the per-carrier
// audit entry points (auditLabel). Barcode format parsers and carrier reference
// data live under src/carriers/; this module re-exports them so existing
// imports (UI, scanner, tests) keep working unchanged.
import { applyNormalize, evaluateRuleSet, registerRuleFunction, resolvePath } from './ruleEngine.js';
import { AU_STATES, getRuleSet } from '../rules/index.js';
import { SERVICE_CODE_MAP, SERVICE_TO_PRODUCT_MAP } from './carriers/eparcel/referenceData.js';
import { STARTRACK_PRODUCT_CODE_MAP, STARTRACK_UNIT_TYPE_MAP } from './carriers/startrack/referenceData.js';
import { parseSsccBarcode } from './carriers/formats/gs1.js';
import { calculateEparcelCheckDigit, parseEparcelBarcode } from './carriers/eparcel/formats/article.js';
import {
  dataMatrixComplianceEvidence,
  looksLikeDataMatrix,
  parseGs1DataMatrix
} from './carriers/eparcel/formats/dataMatrix.js';
import { parseStarTrackFreightItemBarcode } from './carriers/startrack/formats/freightItem.js';
import { parseStarTrackRoutingBarcode } from './carriers/startrack/formats/routing.js';
import { parseStarTrackAtlBarcode } from './carriers/startrack/formats/atl.js';
import { parseStarTrackQrBarcode, ST_QR_MANDATORY_FIELDS } from './carriers/startrack/formats/qr.js';

export * from './carriers/eparcel/referenceData.js';
export * from './carriers/startrack/referenceData.js';
export { normalizeBarcode, parseSsccBarcode } from './carriers/formats/gs1.js';
export {
  analyzeArticleCandidate,
  calculateEparcelCheckDigit,
  parseEparcelBarcode
} from './carriers/eparcel/formats/article.js';
export { dataMatrixComplianceEvidence, parseGs1DataMatrix } from './carriers/eparcel/formats/dataMatrix.js';
export { parseStarTrackFreightItemBarcode } from './carriers/startrack/formats/freightItem.js';
export { parseStarTrackRoutingBarcode } from './carriers/startrack/formats/routing.js';
export { parseStarTrackAtlBarcode } from './carriers/startrack/formats/atl.js';
export { parseStarTrackQrBarcode, STARTRACK_QR_FIELDS } from './carriers/startrack/formats/qr.js';

const STATE_REGEX = `(?:${AU_STATES.join('|')})`;
const POSTCODE_LINE_REGEX = new RegExp(`\\b([A-Z][A-Z\\s'-]+?\\s+${STATE_REGEX}\\s+\\d{4})\\b`, 'i');
// Metro labels carry a routing block - destination country code, state and postcode -
// that the other eParcel templates do not have. Text items sharing a baseline are grouped
// into a single line upstream (PDF text layer and OCR alike), so a same-line match is the
// reliable signal; anything else stays undetected and surfaces as manual review rather
// than passing silently.
const METRO_ROUTING_REGEX = new RegExp(`^AU\\s+(${STATE_REGEX})\\s+(\\d{4})$`, 'i');
const ADDRESS_STATE_REGEX = new RegExp(`\\b(${STATE_REGEX})\\b\\s+\\d{4}\\s*$`, 'i');

/** Creates one normalized validation row consumed by both the React UI and exported HTML. */
function result(id, title, severity, category, status, message, extra = {}) {
  return { id, title, severity, category, status, message, ...extra };
}

function normalizeLabelFormat(value) {
  return value === 'sscc' ? 'sscc' : 'standard';
}

function labelFormatName(format) {
  return normalizeLabelFormat(format) === 'sscc' ? 'SSCC article identifier' : 'Standard article format';
}

function carrierName(carrier) {
  if (carrier === 'unknown') return 'unknown';
  return carrier === 'startrack' ? 'StarTrack' : 'eParcel';
}

function validateSelectedAuditMode({
  selectedCarrier = 'eparcel',
  selectedFormat = 'standard',
  detectedCarrier = 'unknown',
  detectedFormat = 'unknown',
  evidence = ''
}) {
  const validations = [];
  validations.push(
    detectedCarrier === selectedCarrier
      ? result(
          'AUDIT_MODE_CARRIER',
          'Selected carrier matches label evidence',
          'CRITICAL',
          'audit-mode',
          'pass',
          `${carrierName(selectedCarrier)} was selected and label evidence matches.`,
          { expected: carrierName(selectedCarrier), actual: carrierName(detectedCarrier), evidence }
        )
      : result(
          'AUDIT_MODE_CARRIER',
          'Selected carrier matches label evidence',
          'CRITICAL',
          'audit-mode',
          'fail',
          `${carrierName(selectedCarrier)} was selected, but decoded/text evidence indicates ${carrierName(detectedCarrier)}.`,
          {
            expected: carrierName(selectedCarrier),
            actual: detectedCarrier === 'unknown' ? 'unknown' : carrierName(detectedCarrier),
            evidence
          }
        )
  );
  validations.push(
    detectedFormat === selectedFormat
      ? result(
          'AUDIT_MODE_FORMAT',
          'Selected label format matches barcode evidence',
          'CRITICAL',
          'audit-mode',
          'pass',
          `${labelFormatName(selectedFormat)} was selected and decoded barcode evidence matches.`,
          { expected: labelFormatName(selectedFormat), actual: labelFormatName(detectedFormat), evidence }
        )
      : result(
          'AUDIT_MODE_FORMAT',
          'Selected label format matches barcode evidence',
          'CRITICAL',
          'audit-mode',
          'fail',
          `${labelFormatName(selectedFormat)} was selected, but decoded barcode evidence indicates ${detectedFormat === 'unknown' ? 'unknown format' : labelFormatName(detectedFormat)}.`,
          {
            expected: labelFormatName(selectedFormat),
            actual: detectedFormat === 'unknown' ? 'unknown' : labelFormatName(detectedFormat),
            evidence
          }
        )
  );
  return validations;
}

// Extracted text is attacker-controlled (crafted PDF text layers, OCR of
// uploaded images). Some extraction regexes backtrack quadratically on
// pathological lines, so line length and count are capped well above anything
// a real label produces.
const MAX_TEXT_LINE_LENGTH = 1000;
const MAX_TEXT_LINES = 2000;

/** Splits selectable PDF text into normalized non-empty lines for visible-content checks. */
function textLines(extractedText) {
  return String(extractedText || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/, MAX_TEXT_LINES)
    .map(line => line.trim().slice(0, MAX_TEXT_LINE_LENGTH))
    .filter(Boolean);
}

function firstLineValue(lines, regex) {
  for (const line of lines) {
    const match = line.match(regex);
    if (match) return match[1].trim();
  }
  return null;
}

function cleanAddressLine(line) {
  return String(line || '')
    .replace(/\s{3,}.*$/, '')
    .replace(/\bThe sender acknowledges\b.*$/i, '')
    .replace(/\band clearing procedures\b.*$/i, '')
    .replace(/\bthe article does not contain\b.*$/i, '')
    .replace(/\bprohibited goods\b.*$/i, '')
    .replace(/\s+Declaration$/i, '')
    .trim();
}

function isDgText(line) {
  return /Aviation\s+Security|Dangerous\s+Goods|Declaration|sender acknowledges|sender declares|carried by air|clearing procedures|does not contain|not contain|prohibited goods|explosive|incendiary|criminal offence/i.test(
    String(line || '')
  );
}

function isOperationalLine(line) {
  return /^(DELIVERY\s+INSTRUCTIONS|Delivery\s+features|Signature\b|Con(?:s(?:ignment)?)?\s*No\b|PARCEL\b|AP\s*Article|Postage\s*Paid|Dead\s*weight|Weight\b|Ph\b|PHONE\b)/i.test(
    String(line || '').trim()
  );
}

function extractToBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /^\s*(To|Deliver\s*To)\b:?/i.test(line)) {
      inBlock = true;
      line = line.replace(/^\s*(To|Deliver\s*To)\b:?/i, '').trim();
      if (/^PHONE\b/i.test(line)) continue;
      line = line.replace(/^PHONE\b:?\s*/i, '').trim();
      if (line && !isOperationalLine(line)) out.push(cleanAddressLine(line));
      continue;
    }
    if (inBlock) {
      if (isOperationalLine(line) || /^From\b|^Sender\b/i.test(line)) break;
      const cleaned = cleanAddressLine(line);
      if (cleaned && !/^PHONE\b/i.test(cleaned)) out.push(cleaned);
    }
  }
  return out.filter(Boolean);
}

function extractFromBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /^\s*(From|Sender)\b:?/i.test(line)) {
      inBlock = true;
      line = line.replace(/^\s*(From|Sender)\b:?/i, '').trim();
      line = line.replace(/Aviation\s+Security.*$/i, '').trim();
      const cleaned = cleanAddressLine(line);
      if (cleaned && !isDgText(cleaned)) out.push(cleaned);
      continue;
    }
    if (inBlock) {
      if (/^AP\s*Article|^Delivery\s*features|^DELIVER\s+TO|^TO\b/i.test(line)) break;
      const cleaned = cleanAddressLine(line);
      if (!cleaned) continue;
      if (isDgText(cleaned)) continue;
      out.push(cleaned);
      if (POSTCODE_LINE_REGEX.test(cleaned)) break;
    }
  }
  return out.filter(Boolean);
}

function extractDgBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /Aviation\s+Security.*Dangerous\s+Goods/i.test(line)) {
      inBlock = true;
      const idx = line.search(/Aviation\s+Security/i);
      out.push(line.slice(idx).trim());
      continue;
    }
    if (inBlock) {
      if (/^AP\s*Article|^DELIVER\s+TO|^TO\b|^SENDER\b|^FROM\b/i.test(line) && !isDgText(line)) break;
      let dgLine = line;
      // PDF text extraction can merge the left sender address with the right DG declaration.
      // Remove the address prefix so DG evidence stays in the declaration block only.
      dgLine = dgLine.replace(/^Australia Postal Corporation\s+/i, '');
      dgLine = dgLine.replace(/^Level\s+[^\t]{1,40}?\s{2,}/i, '');
      dgLine = dgLine.replace(new RegExp(`^[A-Z][A-Z\\s'-]+\\s+${STATE_REGEX}\\s+\\d{4}\\s{2,}`, 'i'), '');
      dgLine = dgLine.trim();
      if (dgLine && isDgText(dgLine)) out.push(dgLine);
      if (/criminal offence/i.test(dgLine)) break;
    }
  }
  return out.filter(Boolean);
}

function extractPostcodeLines(lines) {
  const found = [];
  for (const line of lines) {
    const m = String(line || '')
      .toUpperCase()
      .match(POSTCODE_LINE_REGEX);
    if (m) found.push(m[1].replace(/\s+/g, ' ').trim());
  }
  return [...new Set(found)];
}

/** Extracts the Metro routing block (country code, state and postcode) from a single line. */
function extractRoutingDetails(lines) {
  for (const line of lines) {
    const match = String(line || '')
      .trim()
      .match(METRO_ROUTING_REGEX);
    if (match) {
      return {
        routingLine: match[0].replace(/\s+/g, ' '),
        routingState: match[1].toUpperCase(),
        routingPostcode: match[2]
      };
    }
  }
  return { routingLine: null, routingState: null, routingPostcode: null };
}

/** Reads the state from a "SUBURB STATE POSTCODE" line so routing details can be cross-checked. */
function addressState(line) {
  const match = String(line || '').match(ADDRESS_STATE_REGEX);
  return match ? match[1].toUpperCase() : null;
}

/** Reads the visible "n of N" article count, which may sit under an Article/Parcel heading. */
function extractArticleCountLine(lines) {
  const inline = firstLineValue(lines, /(?:Article|Parcel)\s+(\d+\s+of\s+\d+)/i);
  if (inline) return inline.replace(/\s+/g, ' ');
  const idx = lines.findIndex(line => /^(?:Article|Parcel)s?$/i.test(String(line).trim()));
  const next = idx >= 0 ? String(lines[idx + 1] || '').trim() : '';
  return /^\d+\s+of\s+\d+$/i.test(next) ? next.replace(/\s+/g, ' ') : null;
}

// Matches a visible article ID: AI 00 SSCC (00 + 18 digits), or an eParcel article
// (3- or 5-char MLID followed by exactly 18 digits). This is tighter than a generic
// [A-Z0-9]{21|23} and avoids capturing watermark text.
const EPARCEL_ARTICLE_RE = /\b(00\d{18}|[A-Z0-9]{3}\d{18}|[A-Z0-9]{5}\d{18})\b/g;

function extractArticleIdsFromLines(lines) {
  const ids = [];
  // Primary pass: labelled lines are most reliable (avoids watermark false-positives).
  for (const line of lines) {
    if (!/(?:AP\s*)?Article\s*Id/i.test(line)) continue;
    const after = String(line)
      .replace(/^.*?(?:AP\s*)?Article\s*Id\s*:?\s*/i, '')
      .toUpperCase();
    const matches = after.match(EPARCEL_ARTICLE_RE) || [];
    ids.push(...matches);
  }
  // Secondary pass: barcode human-readable text appears above/below the symbol
  // without a heading, often space-grouped (e.g. "00 39312 65000 00012 3"), so
  // match with the line's spacing removed. Scan all lines but apply the stricter
  // pattern and require the candidate to dominate the line (reduces watermark noise).
  if (ids.length === 0) {
    for (const line of lines) {
      if (/(?:AP\s*)?Article\s*Id/i.test(line)) continue;
      const stripped = String(line).toUpperCase().replace(/\s/g, '');
      const matches = stripped.match(EPARCEL_ARTICLE_RE) || [];
      for (const m of matches) {
        if (stripped.startsWith(m) || stripped.endsWith(m)) {
          ids.push(m);
        }
      }
    }
  }
  return [...new Set(ids)];
}

/** Extracts visible eParcel label facts: address blocks, article IDs, weight, and DG text. */
export function extractLabelFacts(extractedText) {
  const lines = textLines(extractedText);
  const joined = lines.join('\n');
  const upper = joined.toUpperCase();

  const articleIds = extractArticleIdsFromLines(lines);

  let consNo = firstLineValue(lines, /Con(?:s(?:ignment)?)?\s*No\s*:?\s*([A-Z0-9]+)/i);
  if (!consNo) {
    const idx = lines.findIndex(line => /Con(?:s(?:ignment)?)?\s*No\s*:?\s*$/i.test(line));
    if (idx >= 0 && lines[idx + 1] && /^[A-Z0-9]{6,16}$/i.test(lines[idx + 1])) consNo = lines[idx + 1];
  }
  const phone = firstLineValue(lines, /(?:Ph|Phone)\s*:?\s*([0-9 +()-]+)/i);
  const weightRaw =
    firstLineValue(lines, /(?:Dead\s*weight|Weight)\s*([0-9.]+)\s*kg/i) ||
    firstLineValue(lines, /\b([0-9]+(?:\.[0-9]+)?)\s*kg\b/i);
  const dateCodeLine = [...lines].reverse().find(line => /^\d{4}$/.test(line));
  const dateCode = dateCodeLine || null;

  const toBlock = extractToBlock(lines);
  const fromBlock = extractFromBlock(lines);
  const dgBlock = extractDgBlock(lines);
  const postcodeLines = extractPostcodeLines(lines);
  const routing = extractRoutingDetails(lines);
  const articleCountLine = extractArticleCountLine(lines);

  let labelType = null;
  if (/EXPRESS\s+POST/.test(upper)) labelType = 'Express Post';
  else if (/PARCEL\s+POST/.test(upper)) labelType = 'Parcel Post';
  else if (/\bM2M\b/.test(upper)) labelType = 'Metro (M2M)';
  else if (/EPARCEL/.test(upper)) labelType = 'eParcel';

  return {
    lines,
    labelType,
    articleIds: [...new Set(articleIds)],
    consignmentIds: consNo ? [consNo.toUpperCase()] : [],
    phone,
    weightKg: weightRaw || null,
    dateCodeMMDD: dateCode || null,
    toBlock,
    fromBlock,
    dgBlock,
    postcodeLines,
    ...routing,
    articleCountLine,
    dangerousGoodsDeclarationPresent:
      dgBlock.length > 0 ||
      /Aviation\s+Security\s+and\s+Dangerous\s+Goods\s+Declaration/i.test(joined) ||
      /dangerous\s+goods/i.test(joined),
    postagePaidPresent: /Postage\s+Paid/i.test(joined),
    extractedLineCount: lines.length
  };
}

/** Pulls barcode-looking strings from visible text as diagnostic evidence only, not as barcode proof. */
export function extractTextBarcodeCandidates(extractedText) {
  const facts = extractLabelFacts(extractedText);
  return facts.articleIds;
}

function decodedRawValues(detectedBarcodes) {
  return detectedBarcodes.map(b => b.rawValue || b.raw || b.text || '').filter(Boolean);
}

// The SSCC is an article identifier that, per spec, must be carried by the linear
// (Code 128 / GS1-128) barcode. A GS1 Data Matrix on the same label legitimately
// repeats AI (00) SSCC, so parsing SSCC from any decoded symbol would let the Data
// Matrix stand in for an absent or unreadable linear barcode. Classify by decoded
// symbology only (never by payload content - a real SSCC's digits can coincidentally
// contain "8008"/"420") so the SSCC check reflects the linear scan being to spec.
function decodedLinearRawValues(detectedBarcodes) {
  return detectedBarcodes
    .filter(b => {
      const fmt = String(b.format || b.symbology || '');
      if (/data[_\s-]?matrix|qr/i.test(fmt)) return false;
      return /code[_\s-]?128|gs1/i.test(fmt) || b.kind === 'linear';
    })
    .map(b => b.rawValue || b.raw || b.text || '')
    .filter(Boolean);
}

// Manual entries are useful for investigation counts, but never substitute for decoded barcode proof.
function diagnosticManualValues(manualBarcodes) {
  return String(manualBarcodes || '')
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);
}

function decodedLinearPresent(detectedBarcodes) {
  return detectedBarcodes.some(b => {
    const fmt = String(b.format || b.symbology || '');
    // A decoded DataMatrix/QR must never satisfy the "linear barcode present"
    // requirement - the linear symbol has to be readable in its own right.
    if (/data[_\s-]?matrix|qr|aztec|pdf417/i.test(fmt)) return false;
    if (/code[_\s-]?128|gs1/i.test(fmt) || b.kind === 'linear') return true;
    // Content fallback only when the scanner reported no usable symbology.
    return !fmt && parseEparcelBarcode(b.rawValue || '').hasAi91;
  });
}

function decodedDataMatrixPresent(detectedBarcodes) {
  return detectedBarcodes.some(b => looksLikeDataMatrix(b.rawValue || '', b.format || b.symbology || ''));
}

function validateLabelFacts(facts) {
  const validations = [];
  validations.push(
    facts.extractedLineCount > 0
      ? result(
          'TEXT_EXTRACTED',
          'PDF/text content extracted',
          'INFO',
          'label-layout',
          'pass',
          `${facts.extractedLineCount} text line(s) were extracted from the file.`,
          { evidence: facts.lines.slice(0, 40).join('\n') }
        )
      : result(
          'TEXT_EXTRACTED',
          'PDF/text content extracted',
          'WARNING',
          'label-layout',
          'manual_review',
          'No selectable or OCR text was extracted from this label.'
        )
  );

  validations.push(
    facts.labelType
      ? result(
          'LABEL_TYPE',
          'Label product branding / header',
          'INFO',
          'label-layout',
          'pass',
          `Detected label header text: ${facts.labelType}.`,
          { actual: facts.labelType }
        )
      : result(
          'LABEL_TYPE',
          'Label product branding / header',
          'INFO',
          'label-layout',
          'not_applicable',
          'Product branding/header was not exposed in the PDF text layer. Product family is assessed from the decoded product code instead.'
        )
  );

  validations.push(
    facts.articleIds.length
      ? result(
          'VISIBLE_ARTICLE_ID',
          'Visible AP Article ID text',
          'INFO',
          'address-format',
          'pass',
          `Visible AP Article ID value(s) extracted: ${facts.articleIds.join(', ')}.`,
          { actual: facts.articleIds.join(', ') }
        )
      : result(
          'VISIBLE_ARTICLE_ID',
          'Visible AP Article ID text',
          'INFO',
          'address-format',
          'warning',
          'No visible AP Article ID was extracted from text.'
        )
  );

  validations.push(
    facts.consignmentIds.length
      ? result(
          'VISIBLE_CONS_NO',
          'Visible Cons No text',
          'INFO',
          'address-format',
          'pass',
          `Visible consignment number extracted: ${facts.consignmentIds.join(', ')}.`,
          { actual: facts.consignmentIds.join(', ') }
        )
      : result(
          'VISIBLE_CONS_NO',
          'Visible Cons No text',
          'INFO',
          'address-format',
          'manual_review',
          'No visible Cons No value was extracted.'
        )
  );

  validations.push(
    facts.weightKg
      ? result(
          'WEIGHT_PRESENT',
          'Weight value visible',
          'INFO',
          'label-layout',
          'pass',
          `Weight value found: ${facts.weightKg}kg.`,
          { actual: `${facts.weightKg}kg` }
        )
      : result(
          'WEIGHT_PRESENT',
          'Weight value visible',
          'INFO',
          'label-layout',
          'manual_review',
          'Weight value was not extracted from the text layer or decoded barcode payload.'
        )
  );

  return validations;
}

function summarizeValidations(validations) {
  const summary = {
    overallStatus: 'PASS',
    total: validations.length,
    critical: 0,
    errors: 0,
    warnings: 0,
    manualReview: 0,
    failed: 0,
    passed: 0
  };
  for (const validation of validations) {
    if (validation.severity === 'CRITICAL') summary.critical += 1;
    if (validation.severity === 'ERROR') summary.errors += 1;
    if (validation.severity === 'WARNING') summary.warnings += 1;
    if (validation.status === 'manual_review') summary.manualReview += 1;
    if (validation.status === 'fail') summary.failed += 1;
    if (validation.status === 'pass') summary.passed += 1;
    if (validation.status === 'fail' && (validation.severity === 'CRITICAL' || validation.severity === 'ERROR')) {
      summary.overallStatus = 'FAIL';
    } else if (
      summary.overallStatus !== 'FAIL' &&
      (validation.status === 'warning' || validation.status === 'manual_review')
    ) {
      summary.overallStatus = 'REVIEW';
    }
  }
  return summary;
}

registerRuleFunction('pageSizeWithin', (page, { args }) => {
  const widthMm = page?.widthMm;
  const heightMm = page?.heightMm;
  if (!widthMm || !heightMm) {
    return {
      pass: false,
      status: args?.unverifiedStatus || 'manual_review',
      message: 'Physical dimensions could not be determined from this file.'
    };
  }
  const tolerance = args?.toleranceMm ?? 5;
  const sizes = args?.sizesMm || [];
  const pass = sizes.some(
    ([w, h]) =>
      (Math.abs(widthMm - w) <= tolerance && Math.abs(heightMm - h) <= tolerance) ||
      (Math.abs(widthMm - h) <= tolerance && Math.abs(heightMm - w) <= tolerance)
  );
  return {
    pass,
    expected: `${sizes.map(([w, h]) => `${w}mm x ${h}mm`).join(' or ')} (within ${tolerance}mm, either orientation)`,
    actual: `${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm`
  };
});

registerRuleFunction('requiredDecode', (value, { context, args }) => {
  if (value === true) return { pass: true };
  const visible = args?.visiblePath ? Boolean(resolvePath(args.visiblePath, context)) : false;
  const page = context.page || {};
  const parts = [];
  parts.push(
    visible
      ? `${args?.label || 'The required barcode'} appears visible on the label, but it was not decoded by the scanner pipeline.`
      : `${args?.label || 'The required barcode'} was not decoded from the uploaded file.`
  );
  if (page.isRasterImage && page.estimatedDpi && page.estimatedDpi < MIN_LINEAR_DECODE_DPI) {
    parts.push(
      `The uploaded image is roughly ${page.estimatedDpi} DPI (${page.pixelWidth}x${page.pixelHeight}px). At this resolution the narrow bars and spaces of linear barcodes are usually destroyed and cannot be decoded. Upload the original PDF, or export the label image at 300 DPI or higher.`
    );
  }
  return { pass: false, message: parts.join(' ') };
});

registerRuleFunction('inPathList', (value, { context, item, args }) => {
  const raw = resolvePath(args?.path, context, item);
  const list = (Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw])
    .map(v => applyNormalize(v, args?.normalize))
    .filter(Boolean);
  if (!list.length) {
    return {
      pass: false,
      status: 'manual_review',
      expected: `a matching value in ${args?.path}`,
      actual: 'no comparison values available',
      message: `No values were available at ${args?.path} to compare against.`
    };
  }
  const needle = applyNormalize(value, args?.normalize);
  return { pass: list.includes(needle), expected: list.join(', '), actual: needle || 'missing' };
});

registerRuleFunction('eparcelCheckDigit', article => {
  if (!article?.withoutCheckDigit) {
    return { pass: false, status: 'manual_review', message: 'Article body unavailable for check digit calculation.' };
  }
  const cd = calculateEparcelCheckDigit(article.withoutCheckDigit);
  const pass = cd.checkDigit === article.checkDigit;
  return {
    pass,
    expected: cd.checkDigit,
    actual: article.checkDigit,
    evidence: cd.steps,
    message: pass
      ? `Check digit is valid: ${article.checkDigit}.`
      : `Check digit mismatch. Expected ${cd.checkDigit}, got ${article.checkDigit}.`
  };
});

registerRuleFunction('serviceProductCompatible', article => {
  const service = SERVICE_CODE_MAP[article?.serviceCode];
  if (!service) {
    return {
      pass: true,
      message: `Service code ${article?.serviceCode || 'unknown'} is not recognised; the known-service rule reports that separately.`
    };
  }
  const validProducts = SERVICE_TO_PRODUCT_MAP[article.serviceCode] || [];
  const pass = validProducts.includes(article.productCode);
  return {
    pass,
    expected: validProducts.join(', '),
    actual: article.productCode,
    message: pass
      ? `Service ${article.serviceCode} (${service.name}) supports product ${article.productCode}.`
      : `Service ${article.serviceCode} (${service.name}) does not support product ${article.productCode}.`
  };
});

registerRuleFunction('linearDmAgreement', derived => {
  const linear = [...new Set(derived?.linearArticleIds || [])];
  const dm = [...new Set(derived?.dmArticleIds || [])];
  const pass = dm.every(id => linear.includes(id)) && linear.every(id => dm.includes(id));
  return {
    pass,
    expected: 'identical article numbers in both symbols',
    actual: `linear: ${linear.join(', ') || 'none'} | datamatrix: ${dm.join(', ') || 'none'}`,
    message: pass
      ? 'The linear barcode and DataMatrix encode the same article number(s).'
      : 'The linear barcode and DataMatrix do not encode the same article number(s).'
  };
});

registerRuleFunction('routeProductMatch', (route, { context }) => {
  const product = resolvePath('derived.primaryProductCode', context);
  const expectedLabelCode = STARTRACK_PRODUCT_CODE_MAP[product]?.labelCode;
  if (!expectedLabelCode) {
    return { pass: true, message: `Product ${product || 'unknown'} has no routing label code mapping to assert.` };
  }
  const pass = route?.labelCode === expectedLabelCode;
  return {
    pass,
    expected: expectedLabelCode,
    actual: route?.labelCode || 'missing',
    message: pass
      ? `Routing label code ${route.labelCode} matches product ${product}.`
      : `Routing label code ${route?.labelCode || 'missing'} does not match product ${product}.`
  };
});

// One-way cross-check of the printed RC/R1/R2 receiver location codes against the values
// derived from decoded barcodes (MOS v9 1.009-1.011.1). Text is only compared AGAINST the
// decoded routing/QR data, never used as a value source; a miss is manual review because
// text extraction is a soft signal.
registerRuleFunction('receiverLocationCodesShown', (codes, { context }) => {
  const upper = (context?.text?.lines || []).join('\n').toUpperCase();
  const tokens = [...new Set([codes?.rc, codes?.r1, codes?.r2].filter(Boolean))];
  const missing = tokens.filter(token => !new RegExp(`\\b${token}\\b`).test(upper));
  const expected = `RC=${codes?.rc || '?'}, R1=${codes?.r1 || 'blank'}, R2=${codes?.r2 || 'blank'}`;
  const pass = tokens.length > 0 && missing.length === 0;
  return {
    pass,
    expected,
    actual: pass ? `found in label text: ${tokens.join(' ')}` : `not found in extracted text: ${missing.join(', ')}`,
    message: pass
      ? `Receiver location codes found in the label text and consistent with the decoded routing/QR data (${expected}). Location Master File validity cannot be checked digitally.`
      : `Expected receiver location code(s) ${missing.join(', ')} - derived from the decoded routing barcode depot/port and QR destination depot - were not found in the extracted label text. Confirm the RC/R1/R2 line next to the routing barcode on the preview.`
  };
});

registerRuleFunction('qrMandatoryFields', fields => {
  const missing = ST_QR_MANDATORY_FIELDS.filter(([key]) => !String(fields?.[key] || '').trim()).map(
    ([, label]) => label
  );
  return {
    pass: missing.length === 0,
    expected: 'all mandatory QR fields populated',
    actual: missing.length ? `missing: ${missing.join(', ')}` : 'all populated',
    message: missing.length
      ? `QR mandatory fields missing: ${missing.join(', ')}.`
      : 'Mandatory QR fields are populated.'
  };
});

registerRuleFunction('startrackUnitPermitted', fields => {
  const unitType = fields?.unitType;
  const allowed = STARTRACK_UNIT_TYPE_MAP[unitType] || [];
  const pass = Boolean(allowed.length && (!fields?.productCode || allowed.includes(fields.productCode)));
  return {
    pass,
    expected: allowed.length ? `unit ${unitType} permitted for: ${allowed.join(', ')}` : 'a known Appendix A unit type',
    actual: `${unitType || 'blank'} for product ${fields?.productCode || 'unknown'}`,
    message: pass
      ? `Unit type ${unitType} is permitted${fields?.productCode ? ` for ${fields.productCode}` : ''}.`
      : `Unit type ${unitType || 'blank'} could not be confirmed against product ${fields?.productCode || 'unknown'}.`
  };
});

function lastAddressLine(block = []) {
  return [...block].reverse().find(line => /\d{4}\s*$/.test(String(line))) || block[block.length - 1] || '';
}

/** Page geometry context shared by both carriers, including raster-image DPI estimation. */
// Raster uploads carry no physical size: DPI is estimated against the standard
// 100mm short edge, and linear barcodes are typically unrecoverable below
// about 200 DPI (narrow bars collapse to under a pixel).
const ASSUMED_LABEL_SHORT_EDGE_MM = 100;
const MIN_LINEAR_DECODE_DPI = 200;

function buildPageContext(fileInfo) {
  const pixelWidth = fileInfo?.pixelWidth || null;
  const pixelHeight = fileInfo?.pixelHeight || null;
  const isRasterImage = Boolean(pixelWidth && !fileInfo?.widthMm);
  // Raster uploads carry no physical size; estimate DPI by assuming the short
  // side is a standard 100mm label edge so low-resolution exports can be flagged.
  const estimatedDpi =
    isRasterImage && pixelWidth && pixelHeight
      ? Math.round(Math.min(pixelWidth, pixelHeight) / (ASSUMED_LABEL_SHORT_EDGE_MM / 25.4))
      : null;
  return {
    widthMm: fileInfo?.widthMm,
    heightMm: fileInfo?.heightMm,
    pageCount: fileInfo?.pageCount || 1,
    pixelWidth,
    pixelHeight,
    isRasterImage,
    estimatedDpi
  };
}

function buildEparcelRuleContext({
  fileInfo,
  facts,
  selectedFormat,
  parsed,
  dmParses,
  articles,
  invalidAnalyses,
  validSsccs,
  invalidSsccs,
  decodedLinear,
  decodedDm,
  visualEvidence
}) {
  const linearParses = parsed.filter(p => p.hasAi01 !== undefined);
  const gs1Items = [
    ...linearParses.map(p => ({ parse: p, sourceType: 'linear' })),
    ...dmParses
      .map(p => p.base)
      .filter(Boolean)
      .map(p => ({ parse: p, sourceType: 'datamatrix' }))
  ].map(({ parse: p, sourceType }) => ({
    raw: p.raw,
    compact: p.compact,
    prefix16: (p.compact || '').slice(0, 16),
    hasAi01: Boolean(p.hasAi01),
    hasAi91: Boolean(p.hasAi91),
    hasAusPostGtin: Boolean(p.hasAusPostGtin),
    sourceType
  }));
  const toBlock = facts.toBlock || [];
  const fromBlock = facts.fromBlock || [];
  const toPostcodes = [...new Set(toBlock.flatMap(line => String(line).match(/\b\d{4}\b/g) || []))];
  const postcodes4 = [
    ...new Set([...(facts.postcodeLines || []), ...toBlock].flatMap(line => String(line).match(/\b\d{4}\b/g) || []))
  ];
  return {
    page: buildPageContext(fileInfo),
    text: {
      ...facts,
      toLastLine: lastAddressLine(toBlock),
      fromLastLine: lastAddressLine(fromBlock),
      toPostcodes,
      toState: addressState(lastAddressLine(toBlock)),
      postcodes4,
      labelDates: facts.dateCodeMMDD ? [facts.dateCodeMMDD] : [],
      dgPresent: Boolean(facts.dangerousGoodsDeclarationPresent),
      dgBlock: (facts.dgBlock || []).join('\n')
    },
    barcodes: {
      linearPresent: Boolean(decodedLinear),
      dataMatrixPresent: Boolean(decodedDm),
      linearVisible: Boolean(visualEvidence?.linearBarcodeVisible),
      dataMatrixVisible: Boolean(visualEvidence?.dataMatrixVisible),
      gs1: gs1Items,
      datamatrix: dmParses,
      sscc: { valid: validSsccs, invalid: invalidSsccs }
    },
    articles,
    derived: {
      linearArticleIds: linearParses.map(p => p.article?.articleId).filter(Boolean),
      dmArticleIds: dmParses.map(p => p.base?.article?.articleId).filter(Boolean),
      linearSsccIds: validSsccs.map(s => s.articleId).filter(Boolean),
      invalidArticleReasons: invalidAnalyses.map(a => `${a.candidate}: ${a.reason}`).join('\n'),
      invalidSsccReasons: invalidSsccs.map(s => s.reason).join('\n')
    },
    selected: { carrier: 'eparcel', format: selectedFormat }
  };
}

function selectEparcelVariant(selectedFormat, articles, facts) {
  if (selectedFormat === 'sscc') return 'sscc';
  const products = articles.filter(a => a.type === 'eparcel-standard').map(a => a.productCode);
  if (products.some(code => code === '00065' || code === '00068')) return 'returns';
  if (products.some(code => code === '00096' || code === '00087')) return 'express-post';
  if (products.some(code => code === '00121' || code === '00120')) return 'metro';
  if (products.length) return 'parcel-post';
  if (/m2m|metro/i.test(facts?.labelType || '')) return 'metro';
  if (/express/i.test(facts?.labelType || '')) return 'express-post';
  if (/parcel/i.test(facts?.labelType || '')) return 'parcel-post';
  return 'base';
}

function buildStarTrackRuleContext({
  fileInfo,
  facts,
  rawFacts = null,
  selectedFormat,
  qrParses,
  freightParses,
  routingParses,
  atlParses,
  validSsccs,
  invalidSsccs,
  unclassifiedLinear = [],
  expectedAtlNumbers,
  atlExpected,
  visualEvidence
}) {
  const lines = facts.lines || [];
  const hasStarTrackHeaderText = lines.some(l => /STAR\s*TRACK|STARTRACK/i.test(l));
  // A decoded StarTrack barcode is authoritative proof of label identity, so it
  // confirms the StarTrack header without needing OCR of the logo wordmark.
  const starTrackBarcodeDecoded =
    qrParses.length > 0 ||
    freightParses.length > 0 ||
    routingParses.length > 0 ||
    atlParses.length > 0 ||
    validSsccs.length > 0;
  const primaryProductCode = freightParses[0]?.productCode || qrParses[0]?.productCode || '';
  // Receiver location codes RC/R1/R2 printed with the routing barcode (MOS v9 1.009-1.011.1):
  // expectations derive from decoded data only. Premium-group products print R1 = Primary
  // Port (the routing barcode depot segment) and R2 = Secondary Port (the QR destination
  // depot); Express/Special Services print R2 = Nearest Depot (the routing depot segment);
  // NZ Premium (routing postcode 9901) prints the fixed NZ/SYD/ZNA trio. LMF validity
  // cannot be checked digitally - this only pins the values the label must repeat.
  const routeWithDepot = routingParses.find(r => r.depotOrPort) || null;
  const qrDepot =
    String(qrParses[0]?.fields?.destinationDepot || '')
      .trim()
      .toUpperCase() || null;
  let receiverLocationCodes = null;
  if (routeWithDepot) {
    const premiumGroup =
      STARTRACK_PRODUCT_CODE_MAP[primaryProductCode]?.group === 'Premium services' ||
      (!primaryProductCode && ['PRM', 'ARL'].includes(routeWithDepot.labelCode));
    const routeDepot = String(routeWithDepot.depotOrPort).toUpperCase();
    receiverLocationCodes =
      routeWithDepot.postcode === '9901'
        ? { rc: 'NZ', r1: 'SYD', r2: 'ZNA' }
        : premiumGroup
          ? { rc: 'AU', r1: routeDepot, r2: qrDepot }
          : { rc: 'AU', r1: null, r2: routeDepot };
  }
  // Pre-enrichment (print-only) facts back the visible-content checks; the enriched
  // facts remain available for rules where decoded data is a legitimate source.
  const visible = rawFacts || facts;
  return {
    page: buildPageContext(fileInfo),
    text: {
      ...facts,
      hasStarTrackHeader: hasStarTrackHeaderText,
      returnTransferIndicator: ((lines.join('\n').match(/\*\s*(RETURN|TRANSFER)\s*\*/i) || [])[0] || '').trim(),
      visibleLabelCode: visible.labelCode || '',
      visibleConsignmentIds: visible.consignmentIds || [],
      visibleArticleIds: visible.articleIds || [],
      visibleWeightKg: visible.weightKg || '',
      visibleCube: visible.cube || '',
      visibleUnit: visible.unit || '',
      visibleSsccIds: visible.visibleSsccIds || []
    },
    barcodes: {
      qrPresent: qrParses.length > 0,
      freightPresent: freightParses.length > 0,
      routingPresent: routingParses.length > 0,
      linearVisible: Boolean(visualEvidence?.linearBarcodeVisible),
      dataMatrixVisible: Boolean(visualEvidence?.dataMatrixVisible),
      qr: qrParses,
      freight: freightParses,
      routing: routingParses,
      atl: atlParses,
      linearUnclassified: unclassifiedLinear,
      sscc: { valid: validSsccs, invalid: invalidSsccs }
    },
    derived: {
      qrPostcodes: uniqueNonEmpty(qrParses.map(q => q.fields?.receiverPostcode)),
      freightConnotes: uniqueNonEmpty(freightParses.map(f => f.connoteNumber)),
      freightIds: uniqueNonEmpty(freightParses.map(f => f.freightItemId)),
      primaryProductCode,
      receiverLocationCodes,
      expectedAtlNumbers,
      atlExpected: Boolean(atlExpected),
      starTrackConfirmed: starTrackBarcodeDecoded || hasStarTrackHeaderText,
      invalidSsccReasons: invalidSsccs.map(s => s.reason).join('\n'),
      // Print-only evidence: the receiver block must actually be printed on the
      // label, so QR-backfilled address data must not satisfy this check.
      receiverEvidence: [...(visible.toBlock || []), ...(visible.postcodeLines || [])]
    },
    selected: { carrier: 'startrack', format: selectedFormat }
  };
}

function selectStarTrackVariant(selectedFormat, productCodes) {
  if (selectedFormat === 'sscc') return 'sscc';
  const codes = productCodes.filter(Boolean);
  if (codes.some(c => c === 'FPP' || c === 'FPA')) return 'fpp';
  if (codes.some(c => ['PRM', 'APT', 'ARL'].includes(c))) return 'premium';
  if (codes.some(c => ['EXP', 'TSE', 'RET', 'RE2'].includes(c))) return 'express';
  return 'base';
}

function auditEparcelLabel({
  fileInfo,
  detectedBarcodes = [],
  manualBarcodes = '',
  extractedText = '',
  visualEvidence = null,
  labelFormat = 'standard'
}) {
  const validations = [];
  const selectedFormat = normalizeLabelFormat(labelFormat);
  const facts = extractLabelFacts(extractedText);
  const manualValues = diagnosticManualValues(manualBarcodes);
  const decodedValues = decodedRawValues(detectedBarcodes);

  validations.push(...validateLabelFacts(facts));

  const decodedLinear = decodedLinearPresent(detectedBarcodes);
  const decodedDm = decodedDataMatrixPresent(detectedBarcodes);

  const parsed = detectedBarcodes
    .map(b => ({
      raw: b.rawValue || b.raw || b.text || '',
      format: b.format || b.symbology || '',
      symbologyIdentifier: b.symbologyIdentifier || '',
      decoderSource: b.source || ''
    }))
    .filter(s => s.raw)
    .map(s =>
      looksLikeDataMatrix(s.raw, s.format)
        ? { ...parseGs1DataMatrix(s.raw), ...dataMatrixComplianceEvidence(s) }
        : parseEparcelBarcode(s.raw)
    );
  // SSCC is proven by the linear barcode only (EP-SS-01); never let a GS1 Data
  // Matrix that repeats AI (00) SSCC stand in for the linear scan.
  const ssccParses = decodedLinearRawValues(detectedBarcodes)
    .map(parseSsccBarcode)
    .filter(p => p.type === 'sscc' && p.valid !== undefined && p.raw);
  const validSsccs = ssccParses.filter(p => p.valid);
  const invalidSsccs = ssccParses.filter(p => !p.valid);
  const articleMap = new Map();
  for (const article of parsed.map(p => p.article || p.base?.article).filter(Boolean)) {
    articleMap.set(article.articleId || article.sscc, article);
  }
  const allArticles = [...articleMap.values()];
  const standardArticles = allArticles.filter(article => article.type === 'eparcel-standard');
  const articles =
    selectedFormat === 'sscc' ? allArticles.filter(article => article.type === 'sscc') : standardArticles;
  const invalidMap = new Map();
  for (const invalid of parsed.map(p => p.articleAnalysis || p.base?.articleAnalysis).filter(a => a && !a.valid)) {
    invalidMap.set(invalid.candidate, invalid);
  }
  const invalidAnalyses = [...invalidMap.values()];
  const dmParses = parsed.filter(p => 'hasAi420' in p);
  const detectedCarrier = standardArticles.length || dmParses.length || validSsccs.length ? 'eparcel' : 'unknown';
  const detectedFormat =
    validSsccs.length && !standardArticles.length
      ? 'sscc'
      : standardArticles.length
        ? 'standard'
        : validSsccs.length
          ? 'sscc'
          : 'unknown';
  const modeEvidence = [
    standardArticles.length ? `standard eParcel article(s): ${standardArticles.map(a => a.articleId).join(', ')}` : '',
    validSsccs.length ? `SSCC barcode(s): ${validSsccs.map(s => `00${s.sscc}`).join(', ')}` : '',
    dmParses.length ? `GS1 DataMatrix parse(s): ${dmParses.length}` : ''
  ]
    .filter(Boolean)
    .join('\n');
  validations.unshift(
    ...validateSelectedAuditMode({
      selectedCarrier: 'eparcel',
      selectedFormat,
      detectedCarrier,
      detectedFormat,
      evidence: modeEvidence || decodedValues.join('\n')
    })
  );

  for (const [i, article] of articles.entries()) {
    if (article.type === 'sscc') {
      validations.push(
        result(
          `SSCC_${i}`,
          'SSCC article detected',
          'INFO',
          'sscc',
          'pass',
          `SSCC detected: ${article.sscc}. Embedded product/service/check-digit validation does not apply.`,
          { actual: article.sscc }
        )
      );
    }
  }

  const ruleContext = buildEparcelRuleContext({
    fileInfo,
    facts,
    selectedFormat,
    parsed,
    dmParses,
    articles,
    invalidAnalyses,
    validSsccs,
    invalidSsccs,
    decodedLinear,
    decodedDm,
    visualEvidence
  });
  const ruleVariant = selectEparcelVariant(selectedFormat, articles, facts);
  const ruleSet = getRuleSet('eparcel', ruleVariant);
  validations.push(...evaluateRuleSet(ruleSet, ruleContext));

  const summary = summarizeValidations(validations);

  return {
    generatedAt: new Date().toISOString(),
    fileInfo,
    labelFacts: facts,
    visualEvidence,
    detectedBarcodes,
    manualBarcodeCount: manualValues.length,
    selectedAuditMode: { carrier: 'eparcel', labelFormat: selectedFormat },
    ruleSet: { id: ruleSet.id, name: ruleSet.name, variant: ruleVariant, spec: ruleSet.spec || null },
    parsed,
    articles,
    invalidArticleCandidates: invalidAnalyses,
    summary,
    validations
  };
}

// Pulls a heading-labelled numeric measure (weight, cube) from visible text. Tolerant of
// label variation: "CUBE: 0.015 m3", "CUBE 0.015", "CUBIC VOLUME 0.02 m3", the value on the
// next line under a heading, or a bare "0.015 m3" with no heading at all. Position is not
// assumed - the heading anchors the value - so the parse survives layout changes. Returns the
// numeric string or null.
function findLabelledMeasure(lines, headingRe, unitPattern) {
  const num = '(\\d+(?:\\.\\d+)?)';
  const standaloneRe = new RegExp(`^\\s*${num}\\s*(?:${unitPattern})?\\s*$`, 'i');
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '');
    const heading = line.match(headingRe);
    if (!heading) continue;
    const sameLine = line.slice((heading.index || 0) + heading[0].length).match(new RegExp(num));
    if (sameLine) return sameLine[1];
    // No value beside the heading: check the next non-empty line, but only accept it when it
    // is essentially just the measure, so an unrelated next field is never mis-captured.
    for (let j = i + 1; j < lines.length && j <= i + 2; j += 1) {
      const next = String(lines[j] || '').trim();
      if (!next) continue;
      const standalone = next.match(standaloneRe);
      if (standalone) return standalone[1];
      break;
    }
  }
  const bare = lines.join('\n').match(new RegExp(`${num}\\s*(?:${unitPattern})`, 'i'));
  return bare ? bare[1] : null;
}

/** Extracts visible StarTrack facts from selectable PDF text before decoded data backfills gaps. */
function extractStarTrackFacts(extractedText) {
  const lines = textLines(extractedText);
  const joined = lines.join('\n');
  const upper = joined.toUpperCase();
  const labelCode = (joined.match(/\b(TSE|RET|RE2|APT|PRM|FPP|ARL|FPA|EXP)\b/i) || [])[1]?.toUpperCase() || null;
  const sameLineConnote =
    (joined.match(/(?:CONNOTE|CON\s*NO|CONSIGNMENT(?:\s+NUMBER)?)\s*:?\s*([A-Z0-9]{8,20})/i) || [])[1]?.toUpperCase() ||
    null;
  const nextLineConnote =
    (joined.match(/(?:CONNOTE|CON\s*NO|CONSIGNMENT(?:\s+NUMBER)?)\s*:?\s*(?:\r?\n|\s{2,})([A-Z0-9]{8,20})/i) ||
      [])[1]?.toUpperCase() || null;
  const nearbyConnote = (() => {
    const idx = lines.findIndex(l => /CONNOTE|CON\s*NO|CONSIGNMENT/i.test(l));
    if (idx < 0) return null;
    for (let offset = 0; offset <= 3; offset += 1) {
      const candidateLine = String(lines[idx + offset] || '').toUpperCase();
      const candidate = (candidateLine.match(/\b[A-Z0-9]{4}\d{8}\b/) || [])[0];
      if (candidate && !/CONNOTE|CONSIGNMENT/.test(candidate)) return candidate;
    }
    return null;
  })();
  // Primary: labelled line. Secondary: bare 20-char freight item pattern on its own line.
  const labelledArticle =
    (joined.match(/(?:ARTICLE\s*ID|FREIGHT\s*ITEM(?:\s*ID)?)\s*:?\s*([A-Z0-9\s]{12,30})/i) || [])[1]
      ?.replace(/\s+/g, '')
      .toUpperCase() || null;
  const bareArticle = !labelledArticle
    ? (() => {
        for (const line of lines) {
          const t = line.trim().replace(/\s+/g, '').toUpperCase();
          if (/^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(t)) return t;
        }
        return null;
      })()
    : null;
  const articleId = labelledArticle || bareArticle;
  const connoteFromArticle =
    articleId && /^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(articleId) ? articleId.slice(0, 12) : null;
  const connote = sameLineConnote || nextLineConnote || nearbyConnote || connoteFromArticle || null;
  const weight = findLabelledMeasure(lines, /\b(?:DEAD\s*WEIGHT|WEIGHT|WT)\b\s*:?\s*/i, 'kg');
  const cube = findLabelledMeasure(lines, /\b(?:CUBE|CUBIC(?:\s*(?:VOLUME|METRES?))?)\b\s*:?\s*/i, 'm\\s*(?:3|³)');
  const unit = (joined.match(/\b(BAG|CTN|ITM|JIF|PAL|SAT|SKI)\b/i) || [])[1]?.toUpperCase() || null;
  const destinationLooksNz = /\bNZ\b/.test(upper);
  const dgPresent = /DANGEROUS\s+GOODS|DG\s*[:-]|AVIATION\s+SECURITY|IATA|UN\s?\d{4}/i.test(joined);
  const authorityToLeavePresent = /AUTHORITY\s+TO\s+LEAVE|\bATL\b/i.test(joined);
  const visibleAtlNumbers = [...new Set((joined.match(/\bC\d{9}\b/gi) || []).map(v => v.toUpperCase()))];
  // Human-readable SSCC digits are printed beneath the AI 00 symbol, often space-grouped
  // (e.g. "(00) 3 9312650 00000123 4"), so match on each line with spacing removed.
  const visibleSsccIds = [
    ...new Set(
      lines
        .map(line => String(line).replace(/[^A-Z0-9]/gi, ''))
        .flatMap(cleaned => {
          const m = cleaned.match(/(?:^|[A-Z])(00\d{18})(?:[A-Z]|$)/i) || cleaned.match(/^(00\d{18})$/);
          return m ? [m[1]] : [];
        })
    )
  ];
  return {
    lines,
    labelType: 'StarTrack',
    labelCode,
    connoteNumber: connote,
    articleIds: articleId ? [articleId] : [],
    consignmentIds: connote ? [connote] : [],
    weightKg: weight,
    cube,
    unit,
    toBlock: extractToBlock(lines),
    fromBlock: extractFromBlock(lines),
    postcodeLines: extractPostcodeLines(lines),
    dangerousGoodsDeclarationPresent: dgPresent,
    authorityToLeavePresent,
    visibleAtlNumbers,
    visibleSsccIds,
    dgBlock: extractDgBlock(lines),
    destinationLooksNz,
    extractedLineCount: lines.length
  };
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}

function normalizeQrWeight(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = text.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  return String(Number(numeric));
}

function normalizeQrCube(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = text.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  if (/^\d+$/.test(numeric)) {
    const cube = Number(numeric) / 1000;
    return cube > 0 ? cube.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : null;
  }
  return String(Number(numeric));
}

/** Backfills visible-fact fields from decoded barcode data when the PDF text layer is sparse. */
function enrichStarTrackFactsFromDecodedData(
  facts,
  { qrParses = [], freightParses = [], routingParses = [], validSsccs = [] } = {}
) {
  const qrFields = qrParses[0]?.fields || {};
  const firstFreight = freightParses[0] || null;
  const firstRoute = routingParses[0] || null;

  const connoteIds = uniqueNonEmpty([
    ...(facts.consignmentIds || []),
    facts.connoteNumber,
    firstFreight?.connoteNumber,
    qrFields.connoteNumber
  ]);
  const articleIds = uniqueNonEmpty([
    ...(facts.articleIds || []),
    firstFreight?.freightItemId,
    qrFields.freightItemNumber,
    ...validSsccs.map(s => `00${s.sscc}`)
  ]);
  const qrReceiverBlock = uniqueNonEmpty([
    qrFields.receiverName1,
    qrFields.receiverName2,
    qrFields.receiverAddress1,
    qrFields.receiverAddress2,
    [qrFields.receiverSuburb, qrFields.receiverPostcode].filter(Boolean).join(' ')
  ]);
  const qrPostcodeLines = uniqueNonEmpty([
    qrFields.receiverPostcode ? [qrFields.receiverSuburb, qrFields.receiverPostcode].filter(Boolean).join(' ') : ''
  ]);

  return {
    ...facts,
    labelCode:
      facts.labelCode ||
      firstRoute?.labelCode ||
      firstFreight?.expectedLabelCode ||
      qrParses[0]?.expectedLabelCode ||
      qrFields.productCode ||
      null,
    connoteNumber: facts.connoteNumber || connoteIds[0] || null,
    articleIds,
    consignmentIds: connoteIds,
    weightKg: facts.weightKg || normalizeQrWeight(qrFields.consignmentWeight),
    cube: facts.cube || normalizeQrCube(qrFields.consignmentCube),
    unit: facts.unit || qrFields.unitType || null,
    toBlock: facts.toBlock && facts.toBlock.length ? facts.toBlock : qrReceiverBlock,
    postcodeLines: facts.postcodeLines && facts.postcodeLines.length ? facts.postcodeLines : qrPostcodeLines,
    decodedDataUsedForFacts: Boolean(
      qrParses.length || freightParses.length || routingParses.length || validSsccs.length
    )
  };
}

/** Validates StarTrack visible-content facts before the barcode-specific checks are added. */
function validateStarTrackTextFacts(facts) {
  const validations = [];
  validations.push(
    facts.extractedLineCount > 0
      ? result(
          'ST_TEXT_EXTRACTED',
          'Visible text extracted',
          'INFO',
          'startrack-label-layout',
          'pass',
          `${facts.extractedLineCount} text line(s) were extracted from the file.`,
          { evidence: facts.lines.slice(0, 50).join('\n') }
        )
      : result(
          'ST_TEXT_EXTRACTED',
          'Visible text extracted',
          'WARNING',
          'startrack-label-layout',
          'manual_review',
          'No selectable text was extracted. Barcode evidence is still assessed from the rendered image.'
        )
  );
  return validations;
}

/** Runs the full StarTrack rule set against one rendered label/page. */
function auditStarTrackLabel({
  fileInfo,
  detectedBarcodes = [],
  manualBarcodes = '',
  extractedText = '',
  visualEvidence = null,
  labelFormat = 'standard'
}) {
  const validations = [];
  const selectedFormat = normalizeLabelFormat(labelFormat);
  let facts = extractStarTrackFacts(extractedText);
  const manualValues = diagnosticManualValues(manualBarcodes);
  const decodedValues = decodedRawValues(detectedBarcodes);
  // 2D formats are excluded outright: "qr_code" would otherwise match /code/, letting
  // a QR payload that starts with "00" + 18 digits masquerade as the SSCC linear symbol.
  const linearBarcodes = detectedBarcodes.filter(b => {
    const fmt = String(b.format || b.symbology || '');
    if (/qr|data[_\s-]?matrix|aztec|pdf417/i.test(fmt)) return false;
    return /128|code/i.test(fmt) || b.kind === 'linear';
  });
  const linearValues = linearBarcodes.map(b => b.rawValue).filter(Boolean);
  const qrValues = detectedBarcodes
    .filter(b => /qr/i.test(String(b.format || b.symbology || '')) || b.kind === 'qr')
    .map(b => b.rawValue)
    .filter(Boolean);

  const qrParses = qrValues.map(parseStarTrackQrBarcode).filter(p => p.valid);
  // The scan pipeline measures the bar count of Code 128 symbols; it rides
  // along with the parsed freight item as encodation evidence (ST-FRT-09).
  const freightParses = linearBarcodes
    .filter(b => b.rawValue)
    .map(b => {
      const parsed = parseStarTrackFreightItemBarcode(b.rawValue);
      return parsed.valid && Number.isInteger(b.barCount) ? { ...parsed, barCount: b.barCount } : parsed;
    })
    .filter(p => p.valid);
  // SSCC is an article identifier carried by the linear (Code 128) freight barcode,
  // so parse it from linear decodes only. Sourcing from every decoded value would let
  // a "00" + 18-digit run inside the QR payload masquerade as an SSCC article.
  const ssccParses = linearValues
    .map(parseSsccBarcode)
    .filter(p => p.type === 'sscc' && p.valid !== undefined && p.raw);
  const validSsccs = ssccParses.filter(p => p.valid);
  const invalidSsccs = ssccParses.filter(p => !p.valid);
  const routingParses = linearValues.map(parseStarTrackRoutingBarcode).filter(p => p.valid);
  const atlParses = linearValues.map(parseStarTrackAtlBarcode).filter(p => p.valid);
  // Linear symbols that decoded but match no StarTrack structure are surfaced for
  // review instead of silently disappearing as "not decoded" - the symbol DID read,
  // its content is just malformed or foreign.
  const classifiedLinearValues = new Set(
    [...freightParses, ...routingParses, ...atlParses, ...ssccParses].map(p => p.raw)
  );
  const unclassifiedLinear = uniqueNonEmpty(linearValues.filter(v => !classifiedLinearValues.has(v))).map(value => ({
    value,
    reasons: [
      parseStarTrackFreightItemBarcode(value).reason,
      parseStarTrackRoutingBarcode(value).reason,
      parseStarTrackAtlBarcode(value).reason,
      parseSsccBarcode(value).reason
    ]
      .filter(Boolean)
      .join('\n')
  }));
  const expectedAtlNumbers = uniqueNonEmpty([
    ...(facts.visibleAtlNumbers || []),
    ...qrParses.map(q => q.fields?.atlNumber).filter(Boolean)
  ]);
  const atlExpected = Boolean(facts.authorityToLeavePresent || expectedAtlNumbers.length);
  const ssccOnly = selectedFormat === 'sscc' || (validSsccs.length > 0 && freightParses.length === 0);
  const detectedCarrier =
    qrParses.length ||
    freightParses.length ||
    routingParses.length ||
    atlParses.length ||
    validSsccs.length ||
    /STAR\s*TRACK|STARTRACK/i.test(extractedText || '')
      ? 'startrack'
      : 'unknown';
  const detectedFormat =
    validSsccs.length && !freightParses.length
      ? 'sscc'
      : freightParses.length
        ? 'standard'
        : validSsccs.length
          ? 'sscc'
          : 'unknown';
  const modeEvidence = [
    qrParses.length ? `StarTrack QR payload(s): ${qrParses.length}` : '',
    freightParses.length ? `freight item barcode(s): ${freightParses.map(f => f.freightItemId).join(', ')}` : '',
    validSsccs.length ? `SSCC barcode(s): ${validSsccs.map(s => `00${s.sscc}`).join(', ')}` : '',
    routingParses.length ? `routing barcode(s): ${routingParses.map(r => r.raw).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  // Keep the pre-enrichment facts: rules that verify what is PRINTED on the label
  // must compare against text-only evidence, never against values backfilled from
  // the very barcodes they are meant to cross-check.
  const rawFacts = facts;
  facts = enrichStarTrackFactsFromDecodedData(facts, { qrParses, freightParses, routingParses, validSsccs });
  validations.push(
    ...validateSelectedAuditMode({
      selectedCarrier: 'startrack',
      selectedFormat,
      detectedCarrier,
      detectedFormat,
      evidence: modeEvidence || decodedValues.join('\n')
    })
  );
  validations.push(...validateStarTrackTextFacts(facts));
  // SSCC validation only runs when the user explicitly selected SSCC mode, or when
  // auto-detection found only SSCC barcodes (no freight item barcodes). SSCC is now
  // parsed from linear decodes only, but the gate still keeps a coincidental "00" +
  // 18-digit linear run on a standard label from raising false CRITICAL failures.
  if (ssccOnly) {
    for (const [i, sscc] of validSsccs.entries()) {
      validations.push(
        result(
          `ST_SSCC_${i}`,
          'SSCC freight item detected',
          'INFO',
          'startrack-sscc',
          'pass',
          `Valid AI 00 SSCC detected: 00${sscc.sscc}.`,
          { actual: `00${sscc.sscc}` }
        )
      );
    }
    for (const [i, sscc] of invalidSsccs.entries()) {
      validations.push(
        result(`ST_SSCC_INVALID_${i}`, 'SSCC check digit', 'CRITICAL', 'startrack-sscc', 'fail', sscc.reason, {
          expected: sscc.expectedCheckDigit,
          actual: sscc.checkDigit
        })
      );
    }
    if (selectedFormat !== 'sscc') {
      validations.push(
        result(
          'ST_SSCC_PRODUCT_RULE',
          'SSCC product handling',
          'INFO',
          'startrack-sscc',
          'pass',
          'SSCC freight labels encode AI 00 SSCC data. StarTrack product may be supplied by QR/routing data, but it is not embedded in the SSCC article identifier.'
        )
      );
    }
  }

  const ruleContext = buildStarTrackRuleContext({
    fileInfo,
    facts,
    rawFacts,
    selectedFormat,
    qrParses,
    freightParses,
    routingParses,
    atlParses,
    validSsccs,
    invalidSsccs,
    unclassifiedLinear,
    expectedAtlNumbers,
    atlExpected,
    visualEvidence
  });
  const ruleVariant = selectStarTrackVariant(selectedFormat, [
    ...freightParses.map(f => f.productCode),
    ...qrParses.map(q => q.productCode),
    facts.labelCode
  ]);
  const ruleSet = getRuleSet('startrack', ruleVariant);
  validations.push(...evaluateRuleSet(ruleSet, ruleContext));

  const summary = summarizeValidations(validations);
  const articles = [
    ...freightParses.map(f => ({ type: 'startrack-code128-freight', articleId: f.freightItemId, ...f })),
    ...validSsccs.map(s => ({ type: 'sscc', articleId: `00${s.sscc}`, sscc: `00${s.sscc}`, ...s }))
  ];
  return {
    generatedAt: new Date().toISOString(),
    carrier: 'startrack',
    fileInfo,
    labelFacts: facts,
    visualEvidence,
    detectedBarcodes,
    manualBarcodeCount: manualValues.length,
    selectedAuditMode: { carrier: 'startrack', labelFormat: selectedFormat },
    ruleSet: { id: ruleSet.id, name: ruleSet.name, variant: ruleVariant, spec: ruleSet.spec || null },
    parsed: [...qrParses, ...freightParses, ...routingParses, ...atlParses, ...validSsccs],
    startrack: { qrParses, freightParses, routingParses, ssccParses: validSsccs, atlParses, ssccOnly },
    articles,
    invalidArticleCandidates: [],
    summary,
    validations
  };
}

/** Entry point for one rendered label/page; dispatches to the carrier rule set. */
export function auditLabel(input = {}) {
  return input.labelFamily === 'startrack' || input.carrier === 'startrack'
    ? auditStarTrackLabel(input)
    : { ...auditEparcelLabel(input), carrier: 'eparcel' };
}

/** Groups raw validation rows into the report sections rendered by both UI and exported HTML. */
export function groupValidations(validations) {
  const displayCategory = category => {
    if (category === 'gs1-128' || category === 'barcode-structure' || category === 'check-digit')
      return 'linear barcode analysis';
    if (category === 'datamatrix') return 'DataMatrix barcode analysis';
    if (category === 'audit-mode') return 'audit-mode';
    if (category === 'startrack-qr') return 'StarTrack QR barcode';
    if (category === 'startrack-freight' || category === 'startrack-sscc') return 'StarTrack freight item barcode';
    if (category === 'startrack-routing') return 'StarTrack routing barcode';
    if (category === 'startrack-atl') return 'StarTrack ATL barcode';
    if (category === 'startrack-product') return 'StarTrack product/article data';
    if (category === 'startrack-label-layout') return 'label-layout';
    if (category === 'startrack-text') return 'address-format';
    return category;
  };
  return validations.reduce((acc, item) => {
    const key = displayCategory(item.category);
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...item, originalCategory: item.category });
    return acc;
  }, {});
}
