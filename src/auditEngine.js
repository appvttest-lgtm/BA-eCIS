// Core reference data used by the audit rules. Keep these maps close to the parser
// code because decoded barcode fields are resolved directly against them.
import { evaluateRuleSet, registerRuleFunction, resolvePath } from './ruleEngine.js';
import { getRuleSet } from '../rules/index.js';

export const PRODUCT_CODE_MAP = {
  '00091': 'Parcel Post (Non-Signature)',
  '00093': 'Parcel Post + Signature',
  '00096': 'Express Post + Signature',
  '00087': 'Express Post (Non-Signature)',
  '00065': 'Parcel Post Return',
  '00068': 'Express Post Return'
};

// eParcel service codes also define the delivery flags we expect to see in a matching
// Get Shipments payload.
export const SERVICE_CODE_MAP = {
  '03': {
    name: 'Signature Required',
    description: 'Signature on delivery always required. If signature cannot be obtained, parcel must be carded to Post Office.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  '08': {
    name: 'Authority To Leave',
    description: 'Authority to leave if unattended.',
    authority_to_leave: true,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  '45': {
    name: 'Partial Delivery Allowed',
    description: 'Signature required with partial delivery allowed.',
    authority_to_leave: false,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '15': {
    name: 'ATL + Partial Delivery',
    description: 'Authority to leave enabled with partial delivery allowed.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '50': {
    name: 'Safe Drop Enabled',
    description: 'Signature required with safe drop enabled.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: true
  },
  '51': {
    name: 'Safe Drop + Partial Delivery',
    description: 'Safe drop enabled with partial delivery allowed.',
    authority_to_leave: false,
    allow_partial_delivery: true,
    safe_drop_enabled: true
  },
  '09': {
    name: 'Non-Signature + ATL',
    description: 'Authority to leave with non-signature service.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '49': {
    name: 'Wine Delivery - Addressee Only',
    description: 'Wine delivery requiring identity on delivery and addressee-only delivery.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false,
    requires_identity_on_delivery: true,
    id_capture_type: 'addressee'
  },
  '81': {
    name: 'Wine Delivery - Signature',
    description: 'Wine delivery with mandatory signature.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  '82': {
    name: 'Wine Delivery - ATL',
    description: 'Wine delivery with authority to leave enabled.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  '83': {
    name: 'Wine Delivery - Safe Drop',
    description: 'Wine delivery with safe drop enabled.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: true
  }
};

// Standard eParcel article IDs encode both service and product. This matrix rejects
// combinations that can decode successfully but are not valid together.
export const SERVICE_TO_PRODUCT_MAP = {
  '03': ['00093', '00096', '00065', '00068'],
  '08': ['00093', '00096', '00065', '00068'],
  '45': ['00093', '00096'],
  '15': ['00093', '00096'],
  '50': ['00093', '00096'],
  '51': ['00093', '00096'],
  '09': ['00091', '00087'],
  '49': ['00093'],
  '81': ['00093'],
  '82': ['00093'],
  '83': ['00093']
};

// StarTrack freight product codes and the routing label code each product should use.
export const STARTRACK_PRODUCT_CODE_MAP = {
  TSE: { name: 'Tradeshow Express', group: 'Special Services', labelCode: 'TSE' },
  RET: { name: 'Express Tail-Lift', group: 'Special Services', labelCode: 'RET' },
  RE2: { name: 'Express Tail-Lift 2 man', group: 'Special Services', labelCode: 'RE2' },
  APT: { name: 'Premium Tail-Lift', group: 'Special Services', labelCode: 'APT' },
  PRM: { name: 'Premium', group: 'Premium services', labelCode: 'PRM' },
  FPP: { name: '1, 3 & 5Kg Fixed Price Premium', group: 'Premium services', labelCode: 'PRM' },
  ARL: { name: 'Airlock', group: 'Premium services', labelCode: 'ARL' },
  FPA: { name: '1, 3 & 5Kg Fixed Price Airlock', group: 'Premium services', labelCode: 'ARL' },
  EXP: { name: 'Express', group: 'Express services', labelCode: 'EXP' }
};

// Reverse lookup used when the routing barcode is decoded before the freight/QR data.
export const STARTRACK_LABEL_CODE_MAP = Object.entries(STARTRACK_PRODUCT_CODE_MAP).reduce((acc, [code, meta]) => {
  if (!acc[meta.labelCode]) acc[meta.labelCode] = [];
  acc[meta.labelCode].push(code);
  return acc;
}, {});

// Unit types accepted for each StarTrack product family when the fixed-width QR payload
// includes unit data.
export const STARTRACK_UNIT_TYPE_MAP = {
  BAG: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  CTN: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  ITM: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  JIF: ['EXP','PRM','RET','RE2','FPP','ARL','FPA'],
  PAL: ['EXP','PRM','RET','RE2'],
  SAT: ['FPP','FPA'],
  SKI: ['EXP','PRM','RET','RE2']
};

const STATE_REGEX = '(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)';
const POSTCODE_LINE_REGEX = new RegExp(`\\b([A-Z][A-Z\\s'-]+?\\s+${STATE_REGEX}\\s+\\d{4})\\b`, 'i');

/** Resolves an eParcel product code for report display; unknown values stay explicit. */
export function getProductCodeDescription(code) {
  return PRODUCT_CODE_MAP[code] || 'Unknown product code';
}

/** Resolves an eParcel service code into the report wording used by validation rows. */
export function getServiceCodeDescription(code) {
  const service = SERVICE_CODE_MAP[code];
  return service ? `${service.name} - ${service.description}` : 'Unknown service code';
}

/** Returns the service rule object used by payload comparison and service-matrix UI. */
export function getServiceCodeRules(code) {
  return SERVICE_CODE_MAP[code] || null;
}

/** Creates one normalized validation row consumed by both the React UI and exported HTML. */
function result(id, title, severity, category, status, message, extra = {}) {
  return { id, title, severity, category, status, message, ...extra };
}

function normalizeLabelFormat(value) {
  return value === 'sscc' ? 'sscc' : 'standard';
}

function normalizeSsccExtensionDigitInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return { provided: false, raw: '', extensionDigit: '', reason: '' };
  const digits = raw.replace(/\D/g, '');
  const extensionDigit = digits.startsWith('00') ? digits.slice(2, 3) : digits.slice(0, 1);
  if (!/^\d$/.test(extensionDigit)) {
    return { provided: true, raw, extensionDigit: '', reason: 'Enter the SSCC extension digit, for example 3 or 003.' };
  }
  return { provided: true, raw, extensionDigit, reason: '' };
}

function normalizeSsccCompanyPrefixInput(input, extensionDigitInput = '') {
  const raw = String(input || '').trim();
  const extension = normalizeSsccExtensionDigitInput(extensionDigitInput);
  if (!raw && !extension.provided) return { provided: false, raw: '', extensionDigit: '', companyPrefix: '', reason: '' };
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    if (digits.length > 0) digits = digits.slice(1);
  }
  if (!raw) {
    return { provided: extension.provided, raw, extensionDigit: extension.extensionDigit, companyPrefix: '', reason: extension.reason };
  }
  if (!digits) {
    return { provided: true, raw, companyPrefix: '', reason: 'Enter the GS1 Company Prefix digits, for example 9315345.' };
  }
  if (digits.length < 4 || digits.length > 12) {
    return { provided: true, raw, extensionDigit: extension.extensionDigit, companyPrefix: digits, reason: 'GS1 Company Prefix should usually be 4 to 12 digits.' };
  }
  return { provided: true, raw, extensionDigit: extension.extensionDigit, companyPrefix: digits, reason: extension.reason || '' };
}

function validateExpectedSsccPrefix({ expectedSscc, validSsccs = [], invalidSsccs = [], category = 'sscc', idPrefix = 'SSCC_EXPECTED' }) {
  if (!expectedSscc?.provided) return [];
  const validations = [];
  if (expectedSscc.reason) {
    validations.push(result(
      `${idPrefix}_PREFIX_INPUT`,
      'SSCC extension / company prefix input',
      'ERROR',
      category,
      'fail',
      expectedSscc.reason || 'The supplied SSCC GS1 Company Prefix is not usable.',
      { actual: expectedSscc.raw }
    ));
    return validations;
  }

  validations.push(validSsccs.length
    ? result(`${idPrefix}_DECODED`, 'AI 00 SSCC barcode decoded', 'CRITICAL', category, 'pass', `${validSsccs.length} valid AI 00 SSCC barcode(s) decoded.`, { actual: validSsccs.map(s => `00${s.sscc}`).join(', ') })
    : result(`${idPrefix}_DECODED`, 'AI 00 SSCC barcode decoded', 'CRITICAL', category, 'fail', invalidSsccs.length ? invalidSsccs[0].reason : 'SSCC assessment was selected, but no valid AI 00 SSCC barcode was decoded.', { expected: expectedSscc.companyPrefix ? `AI 00 SSCC with GS1 Company Prefix ${expectedSscc.companyPrefix}` : 'AI 00 SSCC', actual: invalidSsccs.map(s => s.raw).filter(Boolean).join(', ') || 'not decoded' }));

  if (validSsccs.length && expectedSscc.extensionDigit) {
    const matches = validSsccs.filter(s => s.extensionDigit === expectedSscc.extensionDigit);
    validations.push(matches.length
      ? result(`${idPrefix}_EXTENSION_DIGIT`, 'SSCC extension digit', 'ERROR', category, 'pass', `Decoded SSCC extension digit matches ${expectedSscc.extensionDigit}.`, { expected: expectedSscc.extensionDigit, actual: matches.map(s => `00${s.sscc}`).join(', ') })
      : result(`${idPrefix}_EXTENSION_DIGIT`, 'SSCC extension digit', 'ERROR', category, 'fail', `No decoded SSCC uses extension digit ${expectedSscc.extensionDigit}.`, { expected: expectedSscc.extensionDigit, actual: validSsccs.map(s => s.extensionDigit).join(', ') }));
  }

  if (validSsccs.length && expectedSscc.companyPrefix) {
    const matches = validSsccs.filter(s => String(s.companyPrefixAndSerial || '').startsWith(expectedSscc.companyPrefix) || String(s.sscc || '').startsWith(expectedSscc.companyPrefix));
    validations.push(matches.length
      ? result(`${idPrefix}_COMPANY_PREFIX`, 'SSCC GS1 Company Prefix', 'ERROR', category, 'pass', `Decoded SSCC company prefix matches ${expectedSscc.companyPrefix}.`, { expected: expectedSscc.companyPrefix, actual: matches.map(s => `00${s.sscc}`).join(', ') })
      : result(`${idPrefix}_COMPANY_PREFIX`, 'SSCC GS1 Company Prefix', 'ERROR', category, 'fail', `No decoded SSCC starts with GS1 Company Prefix ${expectedSscc.companyPrefix}.`, { expected: expectedSscc.companyPrefix, actual: validSsccs.map(s => s.sscc).join(', ') }));
  }

  return validations;
}

function labelFormatName(format) {
  return normalizeLabelFormat(format) === 'sscc' ? 'SSCC article identifier' : 'Standard article format';
}

function carrierName(carrier) {
  if (carrier === 'unknown') return 'unknown';
  return carrier === 'startrack' ? 'StarTrack' : 'eParcel';
}

function validateSelectedAuditMode({ selectedCarrier = 'eparcel', selectedFormat = 'standard', detectedCarrier = 'unknown', detectedFormat = 'unknown', evidence = '' }) {
  const validations = [];
  validations.push(detectedCarrier === selectedCarrier
    ? result('AUDIT_MODE_CARRIER', 'Selected carrier matches label evidence', 'CRITICAL', 'audit-mode', 'pass', `${carrierName(selectedCarrier)} was selected and label evidence matches.`, { expected: carrierName(selectedCarrier), actual: carrierName(detectedCarrier), evidence })
    : result('AUDIT_MODE_CARRIER', 'Selected carrier matches label evidence', 'CRITICAL', 'audit-mode', 'fail', `${carrierName(selectedCarrier)} was selected, but decoded/text evidence indicates ${carrierName(detectedCarrier)}.`, { expected: carrierName(selectedCarrier), actual: detectedCarrier === 'unknown' ? 'unknown' : carrierName(detectedCarrier), evidence }));
  validations.push(detectedFormat === selectedFormat
    ? result('AUDIT_MODE_FORMAT', 'Selected label format matches barcode evidence', 'CRITICAL', 'audit-mode', 'pass', `${labelFormatName(selectedFormat)} was selected and decoded barcode evidence matches.`, { expected: labelFormatName(selectedFormat), actual: labelFormatName(detectedFormat), evidence })
    : result('AUDIT_MODE_FORMAT', 'Selected label format matches barcode evidence', 'CRITICAL', 'audit-mode', 'fail', `${labelFormatName(selectedFormat)} was selected, but decoded barcode evidence indicates ${detectedFormat === 'unknown' ? 'unknown format' : labelFormatName(detectedFormat)}.`, { expected: labelFormatName(selectedFormat), actual: detectedFormat === 'unknown' ? 'unknown' : labelFormatName(detectedFormat), evidence }));
  return validations;
}

/** Normalizes scanner output before parsing GS1 application identifiers and separators. */
export function normalizeBarcode(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\]C1/, '')
    .replace(/^\]d2/, '')
    .replace(/\u001d/g, '|')
    .replace(/\x1d/g, '|')
    .replace(/\u001e/g, '|')
    .replace(/\x1e/g, '|')
    .replace(/\u001c/g, '|')
    .replace(/\x1c/g, '|')
    .replace(/\(00\)/g, '00')
    .replace(/\(01\)/g, '01')
    .replace(/\(91\)/g, '91')
    .replace(/\(420\)/g, '|420')
    .replace(/\(92\)/g, '|92')
    .replace(/\(8008\)/g, '|8008')
    .replace(/[\t ]+/g, '')
    .replace(/\r?\n/g, '|');
}

/** Converts eParcel alpha characters to the digits used by the article check-digit algorithm. */
export function alphaToAsciiLastDigit(ch) {
  if (/^[A-Z]$/.test(ch)) return String(ch.charCodeAt(0)).slice(-1);
  return ch;
}

/** Calculates the eParcel article check digit and returns the working steps for report evidence. */
export function calculateEparcelCheckDigit(articleWithoutCheckDigit) {
  const input = String(articleWithoutCheckDigit || '').toUpperCase();
  const converted = input.split('').map(alphaToAsciiLastDigit).join('');
  if (!/^\d+$/.test(converted)) {
    return {
      validInput: false,
      converted,
      weightedSum: null,
      checkDigit: null,
      steps: `Input contains invalid characters after alpha substitution: ${converted}`
    };
  }
  let sum = 0;
  const terms = [];
  let positionFromRight = 1;
  for (let i = converted.length - 1; i >= 0; i -= 1) {
    const digit = Number(converted[i]);
    const weight = positionFromRight % 2 === 1 ? 3 : 1;
    const value = digit * weight;
    terms.push(`${digit}x${weight}=${value}`);
    sum += value;
    positionFromRight += 1;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return {
    validInput: true,
    converted,
    weightedSum: sum,
    checkDigit: String(checkDigit),
    steps: `Converted=${converted}; ${terms.join(' + ')}; sum=${sum}; checkDigit=${checkDigit}`
  };
}

/** Parses a cleaned eParcel article or SSCC candidate once its outer structure is plausible. */
function parseValidArticleId(cleaned) {
  if (/^00\d{18}$/.test(cleaned)) {
    return { type: 'sscc', articleId: cleaned, sscc: cleaned, valid: true };
  }

  const candidates = [];
  if (/^[A-Z0-9]{21}$/.test(cleaned)) candidates.push(3);
  if (/^[A-Z0-9]{23}$/.test(cleaned)) candidates.push(5);

  for (const mlidLength of candidates) {
    const mlid = cleaned.slice(0, mlidLength);
    const consignmentSuffix = cleaned.slice(mlidLength, mlidLength + 7);
    const articleCount = cleaned.slice(mlidLength + 7, mlidLength + 9);
    const productCode = cleaned.slice(mlidLength + 9, mlidLength + 14);
    const serviceCode = cleaned.slice(mlidLength + 14, mlidLength + 16);
    const postagePaidIndicator = cleaned.slice(mlidLength + 16, mlidLength + 17);
    const checkDigit = cleaned.slice(mlidLength + 17, mlidLength + 18);
    const withoutCheckDigit = cleaned.slice(0, -1);
    if (/^[A-Z0-9]+$/.test(mlid) && /^\d{7}$/.test(consignmentSuffix) && /^\d{2}$/.test(articleCount)) {
      return {
        type: 'eparcel-standard',
        articleId: cleaned,
        mlid,
        consignmentSuffix,
        consignmentId: `${mlid}${consignmentSuffix}`,
        articleCount,
        productCode,
        productDescription: getProductCodeDescription(productCode),
        serviceCode,
        serviceDescription: getServiceCodeDescription(serviceCode),
        postagePaidIndicator,
        checkDigit,
        withoutCheckDigit,
        mlidLength,
        valid: true
      };
    }
  }

  return null;
}

/** Validates an article-like string and returns a reviewer-friendly failure reason when invalid. */
export function analyzeArticleCandidate(candidate) {
  const cleaned = String(candidate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  const valid = parseValidArticleId(cleaned);
  if (valid) return { valid: true, article: valid, candidate: cleaned, reason: null };

  let reason = 'Article string does not match a standard eParcel article ID or SSCC structure.';
  if (/^00\d+$/.test(cleaned) && cleaned.length !== 20) {
    reason = `SSCC article IDs must be 20 digits including AI 00. Detected length ${cleaned.length}.`;
  } else if (/^\d+$/.test(cleaned) || /^[A-Z0-9]+$/.test(cleaned)) {
    reason = `Standard eParcel article IDs must be 21 characters for 3-character MLID or 23 characters for 5-character MLID. Detected length ${cleaned.length}.`;
  }
  return { valid: false, article: null, candidate: cleaned, reason };
}

/** Keeps the valid article prefix when scanner output has extra trailing GS1 data. */
function trimArticleCandidate(candidate) {
  const cleaned = String(candidate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  // Standard eParcel article IDs are 21 chars with a 3-char MLID or 23 chars with a 5-char MLID.
  for (const len of [21, 23]) {
    const slice = cleaned.slice(0, len);
    if (analyzeArticleCandidate(slice)?.valid) return slice;
  }
  return cleaned;
}

/** Extracts the eParcel article component from normalized GS1 AI 91 content. */
function extractArticleCandidateFromGs1Normalized(normalized, compact) {
  const n = String(normalized || '');
  const c = String(compact || '');

  if (n.startsWith('0199312650999998') && n.slice(16, 18) === '91') {
    return trimArticleCandidate(n.slice(18).split('|')[0]);
  }

  const normalizedAi91 = n.match(/(?:^|\|)91([A-Z0-9]{21,23})(?:\||$)/i);
  if (normalizedAi91) return trimArticleCandidate(normalizedAi91[1]);

  // Some scanners drop GS1 group separators. Keep this fallback narrow so random text
  // is not promoted into a valid article candidate.
  const ai91Index = c.indexOf('91', 14);
  if (c.startsWith('01') && ai91Index >= 14) return trimArticleCandidate(c.slice(ai91Index + 2));
  return null;
}

/** Parses eParcel GS1-128, article-like, and SSCC barcode strings into structured fields. */
export function parseEparcelBarcode(raw) {
  const normalized = normalizeBarcode(raw);
  const compact = normalized.replace(/\|/g, '');
  const isSscc = /^00\d{18}$/.test(compact);
  if (isSscc) {
    const analysis = analyzeArticleCandidate(compact);
    return { symbologyType: 'GS1-128/SSCC', raw, normalized, compact, isSscc: true, article: analysis?.article || null, articleAnalysis: analysis };
  }

  const hasAi01 = compact.startsWith('01');
  const hasAusPostGtin = compact.startsWith('0199312650999998');
  const hasAi91 = hasAusPostGtin ? compact.slice(16, 18) === '91' : compact.includes('91');

  let articleCandidate = extractArticleCandidateFromGs1Normalized(normalized, compact);
  if (!articleCandidate && /^[A-Z0-9]{10,30}$/.test(compact)) articleCandidate = trimArticleCandidate(compact);

  const articleAnalysis = articleCandidate ? analyzeArticleCandidate(articleCandidate) : null;

  return {
    symbologyType: normalized.includes('420') || normalized.includes('8008') ? 'GS1-DataMatrix-like' : 'GS1-128/Article-like',
    raw,
    normalized,
    compact,
    hasAi01,
    hasAi91,
    hasAusPostGtin,
    articleCandidate,
    articleCandidateLength: articleCandidate?.length || 0,
    isSscc: Boolean(articleAnalysis?.article?.type === 'sscc'),
    article: articleAnalysis?.article || null,
    articleAnalysis
  };
}

/** Parses GS1 DataMatrix content and extracts Australia Post-specific AIs where available. */
export function parseGs1DataMatrix(raw) {
  const normalized = normalizeBarcode(raw);
  const parts = normalized.split('|').filter(Boolean);
  const compact = normalized.replace(/\|/g, '');
  const baseParse = parseEparcelBarcode(raw);

  let postcode = null;
  let dpid = null;
  let dateTime = null;
  let hasAi420 = false;
  let hasAi92 = false;
  let hasAi8008 = false;

  for (const part of parts) {
    if (part.startsWith('420')) {
      hasAi420 = true;
      postcode = part.slice(3, 7);
    }
    if (part.startsWith('92')) {
      hasAi92 = true;
      dpid = part.slice(2, 10);
    }
    if (part.startsWith('8008')) {
      hasAi8008 = true;
      dateTime = part.slice(4, 16);
    }
  }

  if (!hasAi420) {
    const m = compact.match(/420(\d{4})/);
    if (m) { hasAi420 = true; postcode = m[1]; }
  }
  if (!hasAi92) {
    const m = compact.match(/92(\d{8})/);
    if (m) { hasAi92 = true; dpid = m[1]; }
  }
  if (!hasAi8008) {
    const m = compact.match(/8008(\d{12})/);
    if (m) { hasAi8008 = true; dateTime = m[1]; }
  }

  return {
    raw,
    normalized,
    compact,
    parts,
    base: baseParse,
    article: baseParse.article,
    articleAnalysis: baseParse.articleAnalysis,
    hasAi420,
    postcode,
    hasAi92,
    dpid,
    hasAi8008,
    dateTime,
    invalidLiteralSeparators: /FNC1|_1|\$/i.test(String(raw || ''))
  };
}

/** Identifies likely DataMatrix content when a scanner returns incomplete symbology metadata. */
function looksLikeDataMatrix(raw, format = '') {
  const n = normalizeBarcode(raw);
  return /data[_\s-]?matrix/i.test(format) || n.includes('420') || n.includes('8008') || n.includes('|92') || n.includes('|420');
}

/** Splits selectable PDF text into normalized non-empty lines for visible-content checks. */
function textLines(extractedText) {
  return String(extractedText || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function firstLineValue(lines, regex) {
  for (const line of lines) {
    const match = line.match(regex);
    if (match) return match[1].trim();
  }
  return null;
}

function blockAfter(lines, startRegex, stopRegexes) {
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (!inBlock && startRegex.test(line)) {
      inBlock = true;
      const remainder = line.replace(startRegex, '').trim();
      if (remainder) out.push(remainder);
      continue;
    }
    if (inBlock) {
      if (stopRegexes.some(r => r.test(line))) break;
      out.push(line);
    }
  }
  return out;
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
  return /Aviation\s+Security|Dangerous\s+Goods|Declaration|sender acknowledges|sender declares|carried by air|clearing procedures|does not contain|not contain|prohibited goods|explosive|incendiary|criminal offence/i.test(String(line || ''));
}

function isOperationalLine(line) {
  return /^(DELIVERY\s+INSTRUCTIONS|Delivery\s+features|Signature\b|Con\s*No\b|Cons\s*No\b|PARCEL\b|AP\s*Article|Postage\s*Paid|Dead\s*weight|Weight\b|Ph\b|PHONE\b)/i.test(String(line || '').trim());
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
      dgLine = dgLine.replace(/^[A-Z][A-Z\s'-]+\s+(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+\d{4}\s{2,}/i, '');
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
    const m = String(line || '').toUpperCase().match(POSTCODE_LINE_REGEX);
    if (m) found.push(m[1].replace(/\s+/g, ' ').trim());
  }
  return [...new Set(found)];
}

function extractArticleIdsFromLines(lines) {
  const ids = [];
  for (const line of lines) {
    if (!/(?:AP\s*)?Article\s*Id/i.test(line)) continue;
    const after = String(line).replace(/^.*?(?:AP\s*)?Article\s*Id\s*:?\s*/i, '').toUpperCase();
    const matches = after.match(/(00\d{18}|[A-Z0-9]{21}|[A-Z0-9]{23})/g) || [];
    ids.push(...matches);
  }
  return [...new Set(ids)];
}

/** Extracts visible eParcel label facts: address blocks, article IDs, weight, and DG text. */
export function extractLabelFacts(extractedText) {
  const lines = textLines(extractedText);
  const joined = lines.join('\n');
  const upper = joined.toUpperCase();

  const articleIds = extractArticleIdsFromLines(lines);

  let consNo = firstLineValue(lines, /Con(?:s)?\s*No\s*:?\s*([A-Z0-9]+)/i);
  if (!consNo) {
    const idx = lines.findIndex(line => /Cons\s*No\s*:?\s*$/i.test(line));
    if (idx >= 0 && lines[idx + 1] && /^[A-Z0-9]{6,16}$/i.test(lines[idx + 1])) consNo = lines[idx + 1];
  }
  const phone = firstLineValue(lines, /(?:Ph|Phone)\s*:?\s*([0-9 +()-]+)/i);
  const weightRaw = firstLineValue(lines, /(?:Dead\s*weight|Weight)\s*([0-9.]+)\s*kg/i) || firstLineValue(lines, /\b([0-9]+(?:\.[0-9]+)?)\s*kg\b/i);
  const dateCodeLine = [...lines].reverse().find(line => /^\d{4}$/.test(line));
  const dateCode = dateCodeLine || null;

  const toBlock = extractToBlock(lines);
  const fromBlock = extractFromBlock(lines);
  const dgBlock = extractDgBlock(lines);
  const postcodeLines = extractPostcodeLines(lines);

  let labelType = null;
  if (/EXPRESS\s+POST/.test(upper)) labelType = 'Express Post';
  else if (/PARCEL\s+POST/.test(upper)) labelType = 'Parcel Post';
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
    dangerousGoodsDeclarationPresent: dgBlock.length > 0 || /Aviation\s+Security\s+and\s+Dangerous\s+Goods\s+Declaration/i.test(joined) || /dangerous\s+goods/i.test(joined),
    postagePaidPresent: /Postage\s+Paid/i.test(joined),
    extractedLineCount: lines.length
  };
}

/** Pulls barcode-looking strings from visible text as diagnostic evidence only, not as barcode proof. */
export function extractTextBarcodeCandidates(extractedText) {
  const facts = extractLabelFacts(extractedText);
  return facts.articleIds;
}

/** Validates the product/service pair embedded in a standard eParcel article ID. */
export function validateServiceProduct(article) {
  const results = [];
  if (!article || article.type === 'sscc') return results;
  const service = SERVICE_CODE_MAP[article.serviceCode];
  const validProducts = SERVICE_TO_PRODUCT_MAP[article.serviceCode] || [];

  results.push(service
    ? result('SERVICE_KNOWN', 'Known service code', 'ERROR', 'service-code', 'pass', `Service ${article.serviceCode}: ${service.name}`, { actual: article.serviceCode })
    : result('SERVICE_KNOWN', 'Known service code', 'ERROR', 'service-code', 'fail', `Unknown service code ${article.serviceCode}`, { actual: article.serviceCode }));

  results.push(PRODUCT_CODE_MAP[article.productCode]
    ? result('PRODUCT_KNOWN', 'Known product code', 'ERROR', 'service-code', 'pass', `Product ${article.productCode}: ${PRODUCT_CODE_MAP[article.productCode]}`, { actual: article.productCode })
    : result('PRODUCT_KNOWN', 'Known product code', 'ERROR', 'service-code', 'fail', `Unknown product code ${article.productCode}`, { actual: article.productCode }));

  if (service) {
    const ok = validProducts.includes(article.productCode);
    results.push(ok
      ? result('SERVICE_PRODUCT_MATCH', 'Service/product compatibility', 'ERROR', 'service-code', 'pass', `Service ${article.serviceCode} supports product ${article.productCode}.`, { expected: validProducts.join(', '), actual: article.productCode })
      : result('SERVICE_PRODUCT_MATCH', 'Service/product compatibility', 'ERROR', 'service-code', 'fail', `Service ${article.serviceCode} does not support product ${article.productCode}.`, { expected: validProducts.join(', '), actual: article.productCode }));
  }
  return results;
}

function decodedRawValues(detectedBarcodes) {
  return detectedBarcodes.map(b => b.rawValue || b.raw || b.text || '').filter(Boolean);
}

// Manual entries are useful for investigation counts, but never substitute for decoded barcode proof.
function diagnosticManualValues(manualBarcodes) {
  return String(manualBarcodes || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

function decodedLinearPresent(detectedBarcodes) {
  return detectedBarcodes.some(b => /code[_\s-]?128|gs1/i.test(String(b.format || '')) || parseEparcelBarcode(b.rawValue || '').hasAi91);
}

function decodedDataMatrixPresent(detectedBarcodes) {
  return detectedBarcodes.some(b => looksLikeDataMatrix(b.rawValue || '', b.format || ''));
}

function validateLabelFacts(facts) {
  const validations = [];
  validations.push(facts.extractedLineCount > 0
    ? result('TEXT_EXTRACTED', 'PDF/text content extracted', 'INFO', 'label-layout', 'pass', `${facts.extractedLineCount} text line(s) were extracted from the file.`, { evidence: facts.lines.slice(0, 40).join('\n') })
    : result('TEXT_EXTRACTED', 'PDF/text content extracted', 'WARNING', 'label-layout', 'manual_review', 'No selectable or OCR text was extracted from this label.'));

  validations.push(facts.labelType
    ? result('LABEL_TYPE', 'Label product branding / header', 'INFO', 'label-layout', 'pass', `Detected label header text: ${facts.labelType}.`, { actual: facts.labelType })
    : result('LABEL_TYPE', 'Label product branding / header', 'INFO', 'label-layout', 'not_applicable', 'Product branding/header was not exposed in the PDF text layer. Product family is assessed from the decoded product code instead.'));

  validations.push(facts.articleIds.length
    ? result('VISIBLE_ARTICLE_ID', 'Visible AP Article ID text', 'INFO', 'address-format', 'pass', `Visible AP Article ID value(s) extracted: ${facts.articleIds.join(', ')}.`, { actual: facts.articleIds.join(', ') })
    : result('VISIBLE_ARTICLE_ID', 'Visible AP Article ID text', 'INFO', 'address-format', 'warning', 'No visible AP Article ID was extracted from text.'));

  validations.push(facts.consignmentIds.length
    ? result('VISIBLE_CONS_NO', 'Visible Cons No text', 'INFO', 'address-format', 'pass', `Visible consignment number extracted: ${facts.consignmentIds.join(', ')}.`, { actual: facts.consignmentIds.join(', ') })
    : result('VISIBLE_CONS_NO', 'Visible Cons No text', 'INFO', 'address-format', 'manual_review', 'No visible Cons No value was extracted.'));

  validations.push(facts.weightKg
    ? result('WEIGHT_PRESENT', 'Weight value visible', 'INFO', 'label-layout', 'pass', `Weight value found: ${facts.weightKg}kg.`, { actual: `${facts.weightKg}kg` })
    : result('WEIGHT_PRESENT', 'Weight value visible', 'INFO', 'label-layout', 'manual_review', 'Weight value was not extracted from the text layer or decoded barcode payload.'));

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
    } else if (summary.overallStatus !== 'FAIL' && (validation.status === 'warning' || validation.status === 'manual_review')) {
      summary.overallStatus = 'REVIEW';
    }
  }
  return summary;
}

/** Parses JSON or plain-text Get Shipments snippets into local evidence for comparison. */
function parseApiPayloadText(payloadText) {
  const rawText = String(payloadText || '').trim();
  if (!rawText) return { provided: false, rawText: '', parsed: null, parseError: null, flat: [], normalizedText: '' };
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(rawText.slice(start, end + 1)); }
      catch (err2) { parseError = err2.message || String(err2); }
    } else {
      parseError = err.message || String(err);
    }
  }

  const flat = [];
  const walk = (value, path = '') => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, `${path}[${idx}]`));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => walk(item, path ? `${path}.${key}` : key));
      return;
    }
    const text = String(value);
    flat.push({
      path,
      value,
      text,
      normalizedPath: normalizePayloadText(path),
      normalizedValue: normalizePayloadText(text)
    });
  };
  if (parsed !== null) walk(parsed);
  const normalizedText = normalizePayloadText(rawText);
  return {
    provided: true,
    rawText,
    parsed,
    parseError,
    flat,
    normalizedText,
    normalizedValueText: flat.map(item => item.normalizedValue).filter(Boolean).join('|'),
    normalizedPathText: flat.map(item => item.normalizedPath).filter(Boolean).join('|')
  };
}

function normalizePayloadText(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}


function uniquePayloadEvidenceLines(lines = []) {
  return [...new Set(lines.map(line => String(line || '').trim()).filter(Boolean))].slice(0, 12);
}

function payloadEvidenceForValues(ctx, values = []) {
  if (!ctx?.provided) return '';
  const cleaned = [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
  if (!cleaned.length) return '';
  const lines = [];
  if (ctx.flat?.length) {
    for (const item of ctx.flat) {
      const itemValue = String(item.value ?? '');
      const itemNormalized = item.normalizedValue || normalizePayloadText(itemValue);
      for (const value of cleaned) {
        const valueNormalized = normalizePayloadText(value);
        if (!valueNormalized || valueNormalized.length < 2) continue;
        if (itemNormalized.includes(valueNormalized) || valueNormalized.includes(itemNormalized) && itemNormalized.length >= 3) {
          lines.push(`${item.path || '(root)'}: ${itemValue}`);
          break;
        }
      }
    }
  }
  if (!lines.length && payloadContainsAny(ctx, cleaned) === true) {
    lines.push(`raw_payload: contains ${cleaned.join(', ')}`);
  }
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadEvidenceForPathPatterns(ctx, patterns = []) {
  if (!ctx?.provided || !ctx.flat?.length) return '';
  const lines = [];
  for (const item of ctx.flat) {
    const path = String(item.path || '');
    if (patterns.some(pattern => pattern.test(path))) {
      lines.push(`${path || '(root)'}: ${String(item.value ?? '')}`);
    }
  }
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadEvidenceForTokens(ctx, tokens = []) {
  if (!ctx?.provided) return '';
  const cleaned = [...new Set(tokens.map(v => String(v || '').trim()).filter(Boolean))];
  if (!cleaned.length) return '';
  const lines = [];
  if (ctx.flat?.length) {
    for (const item of ctx.flat) {
      const itemValue = String(item.value ?? '');
      const itemNormalized = item.normalizedValue || normalizePayloadText(itemValue);
      const matched = cleaned.filter(token => itemNormalized.includes(normalizePayloadText(token)));
      if (matched.length) lines.push(`${item.path || '(root)'}: ${itemValue}  [matched: ${matched.join(', ')}]`);
    }
  }
  if (!lines.length) lines.push(`matched_tokens: ${cleaned.join(', ')}`);
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadContainsValue(ctx, value) {
  const normalized = normalizePayloadText(value);
  if (!ctx?.provided || !normalized || normalized.length < 2) return null;
  return ctx.normalizedText.includes(normalized);
}

function payloadContainsAny(ctx, values = []) {
  const cleaned = values.map(v => String(v || '').trim()).filter(Boolean);
  if (!ctx?.provided || !cleaned.length) return null;
  return cleaned.some(value => payloadContainsValue(ctx, value) === true);
}


function payloadComparableFieldName(v) {
  const id = String(v?.id || '').toUpperCase();
  if (/CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE|EP-ART-03|EP-ART-07|ST-QR-F03|ST-X-01/.test(id)) return 'consignment_id';
  if (/ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|ST_FREIGHT_BARCODE_PRESENT|DATAMATRIX_PRESENT|GS1_128_PRESENT|EP-ART-0[124568]|EP-LIN|EP-SS-|EP-DM-01|ST-FRT|ST-SSC|ST-X-02|ST-QR-F04/.test(id)) return 'article_id';
  if (/PRODUCT|ST_QR_PRODUCT|ST_PRODUCT_KNOWN|EP-SVC-02|EP-SVC-07|ST-PRD|ST-QR-F05/.test(id)) return 'product_code';
  if (/SERVICE|SERVICE_PRODUCT_MATCH|EP-SVC-01|EP-SVC-03|EP-RET-01/.test(id)) return 'service_code';
  if (/ROUTE|ROUTING|ST_ROUTE|ST-RTE-02A|ST-RTE-03/.test(id)) return 'routing_code';
  if (/POSTCODE|DM_POSTCODE|ST_QR_POSTCODE|EP-DM-05|EP-TO-08|ST-QR-F02|ST-RTE-02B|ST-RTE-04/.test(id)) return 'delivery_postcode';
  if (/WEIGHT|ST_WEIGHT|ST-QR-F09|ST-ITM-04/.test(id)) return 'weight';
  if (/CUBE|CUBIC|ST-ITM-05/.test(id)) return 'cubic_volume';
  if (/DG|DANGEROUS|EP-LAY-07|ST-QR-F19/.test(id)) return 'dangerous_goods';
  if (/ADDR_TO|RECEIVER|EP-TO-|ST-RCV/.test(id)) return 'receiver_address';
  if (/ADDR_FROM|SENDER|LODGE|LODGEMENT|EP-FR-|ST-SND/.test(id)) return 'lodgement_address';
  if (/DATE|8008|EP-DM-07|EP-LAY-06|ST-QR-F11/.test(id)) return 'label_generation_datetime';
  if (/LABEL_CODE|BRAND|LOGO|HEADER|EP-LAY-05|ST-HDR-0[12]/.test(id)) return 'label_branding';
  return '';
}

function tokeniseComparableText(values = []) {
  const stop = new Set(['THE','AND','FOR','WITH','FROM','TO','PH','PHONE','AU','AUS','NSW','VIC','QLD','SA','WA','TAS','ACT','NT','KG','M3','POST','PARCEL','EXPRESS','STARTRACK','AUSTRALIA']);
  return [...new Set(values
    .flatMap(value => String(value || '').toUpperCase().match(/[A-Z0-9]{3,}/g) || [])
    .filter(token => !stop.has(token) && !/^0+$/.test(token)))];
}

function payloadTokenCoverage(ctx, values = [], options = {}) {
  if (!ctx?.provided) return null;
  const tokens = tokeniseComparableText(values);
  if (!tokens.length) return null;
  const matches = tokens.filter(token => payloadContainsValue(ctx, token) === true);
  const minTokens = options.minTokens ?? Math.min(3, Math.max(1, Math.ceil(tokens.length * 0.45)));
  const postcodeTokens = tokens.filter(token => /^\d{4}$/.test(token));
  const postcodeOk = !postcodeTokens.length || postcodeTokens.some(token => matches.includes(token));
  return { ok: matches.length >= minTokens && postcodeOk, tokens, matches, minTokens, postcodeOk };
}

function payloadBool(ctx, patterns = []) {
  if (!ctx?.provided || !ctx.flat?.length) return null;
  for (const item of ctx.flat) {
    const path = String(item.path || '');
    const normalizedPath = item.normalizedPath || normalizePayloadText(path);
    if (!patterns.some(pattern => pattern.test(path) || pattern.test(normalizedPath))) continue;
    if (typeof item.value === 'boolean') return item.value;
    const text = String(item.value).trim().toLowerCase();
    if (['true', 'y', 'yes', '1', 'enabled'].includes(text)) return true;
    if (['false', 'n', 'no', '0', 'disabled'].includes(text)) return false;
  }
  return null;
}

function payloadMatchResult(match, detail = '') {
  if (match === true) return { label: 'Match', status: 'match', detail };
  if (match === false) return { label: 'Does not match', status: 'mismatch', detail };
  return { label: 'N/A', status: 'na', detail: '' };
}

function serviceFlagPayloadMatch(article, ctx) {
  if (!article?.serviceCode || !SERVICE_CODE_MAP[article.serviceCode]) return null;
  const service = SERVICE_CODE_MAP[article.serviceCode];
  const comparisons = [];
  const atl = payloadBool(ctx, [/authority[_\s-]*to[_\s-]*leave/i, /atl/i]);
  const partial = payloadBool(ctx, [/allow[_\s-]*partial[_\s-]*delivery/i, /partial[_\s-]*delivery/i]);
  const safeDrop = payloadBool(ctx, [/safe[_\s-]*drop/i]);
  if (atl !== null) comparisons.push(atl === Boolean(service.authority_to_leave));
  if (partial !== null) comparisons.push(partial === Boolean(service.allow_partial_delivery));
  if (safeDrop !== null) comparisons.push(safeDrop === Boolean(service.safe_drop_enabled));
  if (!comparisons.length) return null;
  return comparisons.every(Boolean);
}


function auditIdentityValues(audit) {
  const facts = audit?.labelFacts || {};
  const articles = audit?.articles || [];
  const startrack = audit?.startrack || {};
  return uniqueNonEmpty([
    ...(facts.articleIds || []),
    ...(facts.consignmentIds || []),
    ...articles.flatMap(a => [a.articleId, a.freightItemId, a.sscc, a.consignmentId]),
    ...(audit?.parsed || []).flatMap(p => [p.articleId, p.article, p.articleIdValue, p.consignmentId, p.sscc, p.freightItemId, p.connoteNumber]),
    ...(startrack.freightParses || []).flatMap(f => [f.freightItemId, f.connoteNumber]),
    ...(startrack.qrParses || []).flatMap(q => [q.fields?.freightItemNumber, q.fields?.connoteNumber]),
    ...(startrack.ssccParses || []).flatMap(s => [`00${s.sscc}`, s.sscc])
  ]).filter(v => normalizePayloadText(v).length >= 6);
}

/** Gates payload comparisons so fields are compared only when the payload matches this label. */
function applyPayloadIdentityGate(audit, apiPayload) {
  const identityValues = auditIdentityValues(audit);
  const identityMatchesLabel = identityValues.length ? payloadContainsAny(apiPayload, identityValues) === true : null;
  return {
    ...apiPayload,
    identityValues,
    identityGateApplied: identityValues.length > 0,
    identityMatchesLabel,
    identityEvidence: identityMatchesLabel ? payloadEvidenceForValues(apiPayload, identityValues) : ''
  };
}

function payloadIdentityRule(id) {
  return /ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|GS1_PREFIX|DATAMATRIX_PRESENT|GS1_128_PRESENT|ST_FREIGHT_BARCODE_PRESENT|ST_SSCC|CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE|EP-ART|EP-LIN|EP-SS|EP-DM-01|ST-FRT|ST-SSC|ST-X-0[12]|ST-QR-F0[34]/i.test(String(id || ''));
}

/** Compares one validation row against matched Get Shipments evidence where a field mapping exists. */
function compareValidationToApiPayload(v, audit, ctx) {
  if (!ctx?.provided) return undefined;
  const id = String(v?.id || '');
  const canonicalField = payloadComparableFieldName(v);
  const facts = audit?.labelFacts || {};
  const articles = audit?.articles || [];
  const eparcelArticles = articles.filter(a => a?.type !== 'sscc');
  const ssccArticles = articles.filter(a => a?.type === 'sscc');
  const startrack = audit?.startrack || {};

  const withField = (match, detail = '', evidence = '') => ({ ...payloadMatchResult(match, detail), field: canonicalField, evidence });

  if (ctx.identityGateApplied && ctx.identityMatchesLabel === false && !payloadIdentityRule(id)) {
    return withField(null, 'Get Shipments payload identity did not match this label; secondary field comparison suppressed.');
  }

  if (/ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|GS1_PREFIX|DATAMATRIX_PRESENT|GS1_128_PRESENT|ST_FREIGHT_BARCODE_PRESENT|ST_SSCC|EP-ART-0[124568]|EP-LIN|EP-SS-|EP-DM-01|ST-FRT|ST-SSC|ST-X-02|ST-QR-F04/i.test(id)) {
    const articleValues = [
      ...articles.map(a => a.articleId || a.freightItemId || a.sscc).filter(Boolean),
      ...ssccArticles.map(a => a.sscc).filter(Boolean),
      ...(facts.articleIds || []),
      ...(startrack.freightParses || []).map(f => f.freightItemId),
      ...(startrack.ssccParses || []).flatMap(s => [`00${s.sscc}`, s.sscc])
    ];
    const match = payloadContainsAny(ctx, articleValues);
    return withField(match, articleValues.length ? `Compared article_id values: ${articleValues.join(', ')}` : '', payloadEvidenceForValues(ctx, articleValues));
  }

  if (/CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE|EP-ART-03|EP-ART-07|ST-QR-F03|ST-X-01/i.test(id)) {
    const connoteValues = [
      ...(facts.consignmentIds || []),
      ...eparcelArticles.map(a => a.consignmentId).filter(Boolean),
      ...(startrack.freightParses || []).map(f => f.connoteNumber),
      ...(startrack.qrParses || []).map(q => q.fields?.connoteNumber).filter(Boolean)
    ];
    const match = payloadContainsAny(ctx, connoteValues);
    return withField(match, connoteValues.length ? `Compared consignment_id values: ${connoteValues.join(', ')}` : '', payloadEvidenceForValues(ctx, connoteValues));
  }

  if (/PRODUCT|SERVICE_KNOWN|SERVICE_PRODUCT_MATCH|ST_QR_PRODUCT|ST_ROUTE_PRODUCT_MATCH|EP-SVC|EP-RET-01|ST-PRD|ST-QR-F05|ST-RTE-03/i.test(id)) {
    const productCodes = [
      ...eparcelArticles.map(a => a.productCode).filter(Boolean),
      ...(startrack.freightParses || []).map(f => f.productCode),
      ...(startrack.qrParses || []).map(q => q.productCode).filter(Boolean)
    ];
    const serviceCodes = eparcelArticles.map(a => a.serviceCode).filter(Boolean);
    const labelCodes = [
      ...(startrack.routingParses || []).map(r => r.labelCode),
      ...(startrack.freightParses || []).map(f => f.expectedLabelCode),
      facts.labelCode
    ].filter(Boolean);
    const hasProductOrService = payloadContainsAny(ctx, [...productCodes, ...serviceCodes, ...labelCodes]);
    const serviceFlagMatch = eparcelArticles.length ? serviceFlagPayloadMatch(eparcelArticles[0], ctx) : null;
    const finalMatch = serviceFlagMatch === null ? hasProductOrService : (hasProductOrService === true && serviceFlagMatch === true);
    return withField(finalMatch, `Compared product_code/service_code/label_code values: ${[...productCodes, ...serviceCodes, ...labelCodes].join(', ') || 'none'}.`, payloadEvidenceForValues(ctx, [...productCodes, ...serviceCodes, ...labelCodes]));
  }

  if (/ROUTE|ROUTING|POSTCODE|DM_POSTCODE|ST_QR_POSTCODE|EP-DM-05|EP-TO-08|ST-QR-F02|ST-RTE/i.test(id)) {
    const postcodes = [
      ...((facts.postcodeLines || []).join(' ').match(/\b\d{4}\b/g) || []),
      ...(audit?.parsed || []).map(p => p.postcode).filter(Boolean),
      ...(startrack.routingParses || []).map(r => r.postcode),
      ...(startrack.qrParses || []).map(q => q.fields?.receiverPostcode).filter(Boolean)
    ];
    const match = payloadContainsAny(ctx, [...new Set(postcodes)]);
    return withField(match, postcodes.length ? `Compared delivery_postcode values: ${[...new Set(postcodes)].join(', ')}` : '', payloadEvidenceForValues(ctx, [...new Set(postcodes)]));
  }

  if (/WEIGHT|ST_WEIGHT|ST-QR-F09|ST-ITM-04/i.test(id)) {
    const weights = [facts.weightKg, ...(startrack.qrParses || []).map(q => q.fields?.consignmentWeight)].filter(Boolean);
    const normalizedWeights = weights.flatMap(w => {
      const asText = String(w).trim();
      const noZeros = asText.replace(/\.0+$/, '');
      return [asText, noZeros, `${noZeros}KG`, `${asText}KG`];
    });
    const match = payloadContainsAny(ctx, normalizedWeights);
    return withField(match, weights.length ? `Compared weight values: ${weights.join(', ')}` : '', payloadEvidenceForValues(ctx, normalizedWeights));
  }

  if (/CUBE|CUBIC|ST-ITM-05/i.test(id)) {
    const cubes = [facts.cube, ...(startrack.qrParses || []).map(q => q.fields?.consignmentCube)].filter(Boolean);
    const match = payloadContainsAny(ctx, cubes);
    return withField(match, cubes.length ? `Compared cubic_volume values: ${cubes.join(', ')}` : '', payloadEvidenceForValues(ctx, cubes));
  }

  if (/DG|DANGEROUS|EP-LAY-07|ST-QR-F19/i.test(id)) {
    const apiDg = payloadBool(ctx, [/dangerous[_\s-]*goods/i, /dg[_\s-]*indicator/i, /contains[_\s-]*dangerous/i]);
    if (apiDg === null) return withField(null);
    const labelDg = Boolean(facts.dangerousGoodsDeclarationPresent || (startrack.qrParses || []).some(q => q.fields?.dangerousGoodsIndicator === 'Y'));
    return withField(apiDg === labelDg, `API dangerous_goods=${apiDg}; label dangerous_goods=${labelDg}.`, payloadEvidenceForPathPatterns(ctx, [/dangerous[_\s-]*goods/i, /dg[_\s-]*indicator/i, /contains[_\s-]*dangerous/i]));
  }

  if (/ADDR_TO|RECEIVER|EP-TO-|ST-RCV/i.test(id)) {
    const receiverValues = [...(facts.toBlock || []), ...(facts.postcodeLines || [])];
    const coverage = payloadTokenCoverage(ctx, receiverValues, { minTokens: 3 });
    if (!coverage) return withField(null);
    return withField(coverage.ok, `receiver_address token match ${coverage.matches.length}/${coverage.tokens.length}: ${coverage.matches.slice(0, 8).join(', ')}`, payloadEvidenceForTokens(ctx, coverage.matches));
  }

  if (/ADDR_FROM|SENDER|LODGE|LODGEMENT|EP-FR-|ST-SND/i.test(id)) {
    const senderValues = [...(facts.fromBlock || [])];
    const coverage = payloadTokenCoverage(ctx, senderValues, { minTokens: 3 });
    if (!coverage) return withField(null);
    return withField(coverage.ok, `lodgement_address token match ${coverage.matches.length}/${coverage.tokens.length}: ${coverage.matches.slice(0, 8).join(', ')}`, payloadEvidenceForTokens(ctx, coverage.matches));
  }

  if (/DATE|8008|EP-DM-07|EP-LAY-06|ST-QR-F11/i.test(id)) {
    const dates = [v.actual, ...(audit?.parsed || []).map(p => p.dateTime).filter(Boolean)].filter(Boolean);
    const match = payloadContainsAny(ctx, dates);
    return withField(match, dates.length ? `Compared label_generation_datetime values: ${dates.join(', ')}` : '', payloadEvidenceForValues(ctx, dates));
  }

  if (/LABEL_CODE|BRAND|LOGO|HEADER|EP-LAY-05|ST-HDR-0[12]/i.test(id)) {
    const values = [facts.labelType, facts.labelCode, audit?.carrier === 'startrack' ? 'StarTrack' : 'Australia Post'].filter(Boolean);
    const match = payloadContainsAny(ctx, values);
    return withField(match, values.length ? `Compared label_branding values: ${values.join(', ')}` : '', payloadEvidenceForValues(ctx, values));
  }

  return withField(null);
}

/** Adds payload-comparison metadata to validation rows without changing the original scan evidence. */
function attachApiPayloadComparison(audit, payloadText) {
  const parsedPayload = parseApiPayloadText(payloadText);
  if (!parsedPayload.provided) return { ...audit, apiPayload: parsedPayload };
  const apiPayload = applyPayloadIdentityGate(audit, parsedPayload);
  const withPayload = { ...audit, apiPayload };
  const validations = (audit.validations || []).map(v => ({
    ...v,
    apiPayloadMatch: compareValidationToApiPayload(v, withPayload, apiPayload)
  }));
  return { ...withPayload, validations };
}

/** Runs the full eParcel rule set against one rendered label/page. */
// --- JSON rule-set support ---------------------------------------------------
// Custom assert functions referenced by name from the /rules JSON files, plus
// the evidence-context builders the declarative rules resolve their paths against.

function normalizeForCompare(value, steps = []) {
  let out = value === undefined || value === null ? '' : String(value);
  for (const step of steps) {
    if (step === 'stripSpaces') out = out.replace(/\s+/g, '');
    if (step === 'upper') out = out.toUpperCase();
    if (step === 'trim') out = out.trim();
    if (step === 'digitsOnly') out = out.replace(/\D+/g, '');
  }
  return out;
}

registerRuleFunction('pageSizeWithin', (page, { args }) => {
  const widthMm = page?.widthMm;
  const heightMm = page?.heightMm;
  if (!widthMm || !heightMm) {
    return { pass: false, status: 'manual_review', message: 'Physical dimensions could not be determined from this file.' };
  }
  const tolerance = args?.toleranceMm ?? 5;
  const sizes = args?.sizesMm || [];
  const pass = sizes.some(([w, h]) =>
    (Math.abs(widthMm - w) <= tolerance && Math.abs(heightMm - h) <= tolerance) ||
    (Math.abs(widthMm - h) <= tolerance && Math.abs(heightMm - w) <= tolerance));
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
  parts.push(visible
    ? `${args?.label || 'The required barcode'} appears visible on the label, but it was not decoded by the scanner pipeline.`
    : `${args?.label || 'The required barcode'} was not decoded from the uploaded file.`);
  if (page.isRasterImage && page.estimatedDpi && page.estimatedDpi < 200) {
    parts.push(`The uploaded image is roughly ${page.estimatedDpi} DPI (${page.pixelWidth}x${page.pixelHeight}px). At this resolution the narrow bars and spaces of linear barcodes are usually destroyed and cannot be decoded. Upload the original PDF, or export the label image at 300 DPI or higher.`);
  }
  return { pass: false, message: parts.join(' ') };
});

registerRuleFunction('inPathList', (value, { context, item, args }) => {
  const raw = resolvePath(args?.path, context, item);
  const list = (Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw]))
    .map(v => normalizeForCompare(v, args?.normalize)).filter(Boolean);
  if (!list.length) {
    return { pass: false, status: 'manual_review', expected: `a matching value in ${args?.path}`, actual: 'no comparison values available', message: `No values were available at ${args?.path} to compare against.` };
  }
  const needle = normalizeForCompare(value, args?.normalize);
  return { pass: list.includes(needle), expected: list.join(', '), actual: needle || 'missing' };
});

registerRuleFunction('eparcelCheckDigit', (article) => {
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
    message: pass ? `Check digit is valid: ${article.checkDigit}.` : `Check digit mismatch. Expected ${cd.checkDigit}, got ${article.checkDigit}.`
  };
});

registerRuleFunction('serviceProductCompatible', (article) => {
  const service = SERVICE_CODE_MAP[article?.serviceCode];
  if (!service) {
    return { pass: true, message: `Service code ${article?.serviceCode || 'unknown'} is not recognised; the known-service rule reports that separately.` };
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

registerRuleFunction('linearDmAgreement', (derived) => {
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

const ST_QR_MANDATORY_FIELDS = [
  ['receiverSuburb', 'Receiver suburb'], ['receiverPostcode', 'Receiver postcode'], ['connoteNumber', 'Consignment number'],
  ['freightItemNumber', 'Freight item number'], ['productCode', 'Product code'], ['consignmentQuantity', 'Consignment quantity'],
  ['consignmentWeight', 'Consignment weight'], ['despatchDate', 'Despatch date'], ['receiverName1', 'Receiver name'],
  ['unitType', 'Unit type'], ['destinationDepot', 'Destination depot'], ['receiverAddress1', 'Receiver address line 1'],
  ['dangerousGoodsIndicator', 'Dangerous goods indicator'], ['movementTypeIndicator', 'Movement type indicator']
];

registerRuleFunction('qrMandatoryFields', (fields) => {
  const missing = ST_QR_MANDATORY_FIELDS.filter(([key]) => !String(fields?.[key] || '').trim()).map(([, label]) => label);
  return {
    pass: missing.length === 0,
    expected: 'all mandatory QR fields populated',
    actual: missing.length ? `missing: ${missing.join(', ')}` : 'all populated',
    message: missing.length ? `QR mandatory fields missing: ${missing.join(', ')}.` : 'Mandatory QR fields are populated.'
  };
});

registerRuleFunction('startrackUnitPermitted', (fields) => {
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
function buildPageContext(fileInfo) {
  const pixelWidth = fileInfo?.pixelWidth || null;
  const pixelHeight = fileInfo?.pixelHeight || null;
  const isRasterImage = Boolean(pixelWidth && !fileInfo?.widthMm);
  // Raster uploads carry no physical size; estimate DPI by assuming the short
  // side is a standard 100mm label edge so low-resolution exports can be flagged.
  const estimatedDpi = isRasterImage && pixelWidth && pixelHeight
    ? Math.round(Math.min(pixelWidth, pixelHeight) / (100 / 25.4))
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

function buildEparcelRuleContext({ fileInfo, facts, selectedFormat, parsed, dmParses, articles, invalidAnalyses, validSsccs, invalidSsccs, decodedLinear, decodedDm, visualEvidence }) {
  const linearParses = parsed.filter(p => p.hasAi01 !== undefined);
  const gs1Items = [...linearParses, ...dmParses.map(p => p.base).filter(Boolean)].map(p => ({
    raw: p.raw,
    compact: p.compact,
    prefix16: (p.compact || '').slice(0, 16),
    hasAi01: Boolean(p.hasAi01),
    hasAi91: Boolean(p.hasAi91),
    hasAusPostGtin: Boolean(p.hasAusPostGtin)
  }));
  const toBlock = facts.toBlock || [];
  const fromBlock = facts.fromBlock || [];
  const postcodes4 = [...new Set([...(facts.postcodeLines || []), ...toBlock].flatMap(line => String(line).match(/\b\d{4}\b/g) || []))];
  return {
    page: buildPageContext(fileInfo),
    text: {
      ...facts,
      toLastLine: lastAddressLine(toBlock),
      fromLastLine: lastAddressLine(fromBlock),
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
  if (products.length) return 'parcel-post';
  if (/express/i.test(facts?.labelType || '')) return 'express-post';
  if (/parcel/i.test(facts?.labelType || '')) return 'parcel-post';
  return 'base';
}

function buildStarTrackRuleContext({ fileInfo, facts, selectedFormat, qrParses, freightParses, routingParses, atlParses, validSsccs, invalidSsccs, expectedAtlNumbers, atlExpected, visualEvidence }) {
  const lines = facts.lines || [];
  return {
    page: buildPageContext(fileInfo),
    text: {
      ...facts,
      hasStarTrackHeader: lines.some(l => /STAR\s*TRACK|STARTRACK/i.test(l)),
      returnTransferIndicator: ((lines.join('\n').match(/\*\s*(RETURN|TRANSFER)\s*\*/i) || [])[0] || '').trim()
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
      sscc: { valid: validSsccs, invalid: invalidSsccs }
    },
    derived: {
      qrPostcodes: uniqueNonEmpty(qrParses.map(q => q.fields?.receiverPostcode)),
      freightConnotes: uniqueNonEmpty(freightParses.map(f => f.connoteNumber)),
      freightIds: uniqueNonEmpty(freightParses.map(f => f.freightItemId)),
      primaryProductCode: freightParses[0]?.productCode || qrParses[0]?.productCode || '',
      expectedAtlNumbers,
      atlExpected: Boolean(atlExpected),
      invalidSsccReasons: invalidSsccs.map(s => s.reason).join('\n'),
      receiverEvidence: [...(facts.toBlock || []), ...(facts.postcodeLines || [])]
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

function auditEparcelLabel({ fileInfo, detectedBarcodes = [], manualBarcodes = '', manifestJson = '', extractedText = '', visualEvidence = null, ssccCompanyPrefix = '', ssccExtensionDigit = '', labelFormat = 'standard' }) {
  const validations = [];
  const selectedFormat = normalizeLabelFormat(labelFormat);
  const expectedSscc = {
    ...normalizeSsccCompanyPrefixInput(ssccCompanyPrefix, ssccExtensionDigit),
    provided: selectedFormat === 'sscc'
  };
  const facts = extractLabelFacts(extractedText);
  const manualValues = diagnosticManualValues(manualBarcodes);
  const decodedValues = decodedRawValues(detectedBarcodes);
  const allRawBarcodes = [...decodedValues];

  validations.push(...validateLabelFacts(facts));

  const decodedLinear = decodedLinearPresent(detectedBarcodes);
  const decodedDm = decodedDataMatrixPresent(detectedBarcodes);

  const parsed = allRawBarcodes.map(raw => looksLikeDataMatrix(raw) ? parseGs1DataMatrix(raw) : parseEparcelBarcode(raw));
  const ssccParses = allRawBarcodes.map(parseSsccBarcode).filter(p => p.type === 'sscc' && p.valid !== undefined && p.raw);
  const validSsccs = ssccParses.filter(p => p.valid);
  const invalidSsccs = ssccParses.filter(p => !p.valid);
  const articleMap = new Map();
  for (const article of parsed.map(p => p.article || p.base?.article).filter(Boolean)) {
    articleMap.set(article.articleId || article.sscc, article);
  }
  const allArticles = [...articleMap.values()];
  const standardArticles = allArticles.filter(article => article.type === 'eparcel-standard');
  const articles = selectedFormat === 'sscc' ? allArticles.filter(article => article.type === 'sscc') : standardArticles;
  const invalidMap = new Map();
  for (const invalid of parsed.map(p => p.articleAnalysis || p.base?.articleAnalysis).filter(a => a && !a.valid)) {
    invalidMap.set(invalid.candidate, invalid);
  }
  const invalidAnalyses = [...invalidMap.values()];
  const dmParses = parsed.filter(p => 'hasAi420' in p);
  const detectedCarrier = standardArticles.length || dmParses.length || validSsccs.length ? 'eparcel' : 'unknown';
  const detectedFormat = validSsccs.length && !standardArticles.length ? 'sscc' : standardArticles.length ? 'standard' : validSsccs.length ? 'sscc' : 'unknown';
  const modeEvidence = [
    standardArticles.length ? `standard eParcel article(s): ${standardArticles.map(a => a.articleId).join(', ')}` : '',
    validSsccs.length ? `SSCC barcode(s): ${validSsccs.map(s => `00${s.sscc}`).join(', ')}` : '',
    dmParses.length ? `GS1 DataMatrix parse(s): ${dmParses.length}` : ''
  ].filter(Boolean).join('\n');
  validations.unshift(...validateSelectedAuditMode({
    selectedCarrier: 'eparcel',
    selectedFormat,
    detectedCarrier,
    detectedFormat,
    evidence: modeEvidence || decodedValues.join('\n')
  }));
  validations.push(...validateExpectedSsccPrefix({ expectedSscc, validSsccs, invalidSsccs, category: 'sscc', idPrefix: 'SSCC_EXPECTED' }));

  for (const [i, article] of articles.entries()) {
    if (article.type === 'sscc') {
      validations.push(result(`SSCC_${i}`, 'SSCC article detected', 'INFO', 'sscc', 'pass', `SSCC detected: ${article.sscc}. Embedded product/service/check-digit validation does not apply.`, { actual: article.sscc }));
    }
  }

  const ruleContext = buildEparcelRuleContext({ fileInfo, facts, selectedFormat, parsed, dmParses, articles, invalidAnalyses, validSsccs, invalidSsccs, decodedLinear, decodedDm, visualEvidence });
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
    expectedSscc,
    selectedAuditMode: { carrier: 'eparcel', labelFormat: selectedFormat },
    ruleSet: { id: ruleSet.id, name: ruleSet.name, variant: ruleVariant, spec: ruleSet.spec || null },
    parsed,
    articles,
    invalidArticleCandidates: invalidAnalyses,
    summary,
    validations
  };
}


/** Calculates the GS1 mod-10 check digit used by SSCC barcodes. */
function gs1Mod10CheckDigit(numberWithoutCheckDigit) {
  const digits = String(numberWithoutCheckDigit || '').replace(/\D/g, '');
  if (!digits) return null;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

function stripAiDecorations(raw) {
  return String(raw || '')
    .replace(/^\]C1/, '')
    .replace(/^\]d2/, '')
    .replace(/[\u001d\x1d\u001e\x1e\u001c\x1c|]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

/** Parses a GS1 AI 00 SSCC barcode and validates the embedded check digit. */
export function parseSsccBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/\(00\)/g, '00');
  const match = compact.match(/(?:^|[^0-9])?00(\d{18})(?:$|[^0-9])?/);
  if (!match) return { valid: false, raw, reason: 'No AI 00 + 18 digit SSCC found.' };
  const sscc = match[1];
  const body = sscc.slice(0, -1);
  const checkDigit = sscc.slice(-1);
  const expected = gs1Mod10CheckDigit(body);
  return {
    valid: expected === checkDigit,
    type: 'sscc',
    raw,
    ai: '00',
    sscc,
    articleId: `00${sscc}`,
    extensionDigit: sscc[0],
    companyPrefixAndSerial: sscc.slice(1, -1),
    checkDigit,
    expectedCheckDigit: expected,
    reason: expected === checkDigit ? 'Valid SSCC check digit.' : `SSCC check digit mismatch. Expected ${expected}, got ${checkDigit}.`
  };
}

/** Parses a standard StarTrack freight item barcode into connote, product, and item parts. */
export function parseStarTrackFreightItemBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  if (!/^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(compact)) {
    return { valid: false, raw, compact, reason: 'Not a StarTrack 20-character freight item barcode.' };
  }
  const despatchId = compact.slice(0, 4);
  const connoteNumber = compact.slice(0, 12);
  const consignmentSequence = compact.slice(4, 12);
  const productCode = compact.slice(12, 15);
  const itemNumber = compact.slice(15, 20);
  const product = STARTRACK_PRODUCT_CODE_MAP[productCode] || null;
  return {
    valid: true,
    type: 'startrack-code128-freight',
    raw,
    articleId: compact,
    freightItemId: compact,
    despatchId,
    consignmentSequence,
    connoteNumber,
    productCode,
    productName: product?.name || 'Unknown StarTrack product code',
    productGroup: product?.group || 'Unknown',
    expectedLabelCode: product?.labelCode || null,
    itemNumber
  };
}

/** Parses StarTrack routing barcodes, including the supported GS1 routing form for SSCC labels. */
export function parseStarTrackRoutingBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  const gs1Route = compact.match(/421(036)(\d{4})403([A-Z0-9]{3})/);
  if (gs1Route) {
    if (!STARTRACK_LABEL_CODE_MAP[gs1Route[3]]) {
      return { valid: false, raw, compact, reason: `Unknown StarTrack GS1 routing label code ${gs1Route[3]}.` };
    }
    return {
      valid: true,
      type: 'gs1-421-routing',
      raw,
      countryCode: gs1Route[1],
      postcode: gs1Route[2],
      labelCode: gs1Route[3],
      supportedProducts: STARTRACK_LABEL_CODE_MAP[gs1Route[3]] || [],
      depotOrPort: '',
      formatDescription: 'GS1 421 routing barcode for AU Domestic SSCC labels'
    };
  }
  const match = compact.match(/^([A-Z0-9]{3})(\d{4})([A-Z0-9]{2,3})$/);
  if (!match) return { valid: false, raw, compact, reason: 'Not a StarTrack routing barcode.' };
  if (!STARTRACK_LABEL_CODE_MAP[match[1]]) {
    return { valid: false, raw, compact, reason: `Unknown StarTrack routing label code ${match[1]}.` };
  }
  return {
    valid: true,
    type: 'startrack-routing',
    raw,
    labelCode: match[1],
    postcode: match[2],
    depotOrPort: match[3],
    supportedProducts: STARTRACK_LABEL_CODE_MAP[match[1]] || [],
    formatDescription: 'StarTrack routing barcode SSS9999DD/DDD'
  };
}

/** Parses the optional StarTrack Authority To Leave barcode used when ATL is requested. */
export function parseStarTrackAtlBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  const match = compact.match(/^C(\d{9})$/);
  return match
    ? { valid: true, raw, atlNumber: compact, counter: match[1], counterNumber: Number(match[1]) }
    : { valid: false, raw, reason: 'Not a StarTrack ATL barcode.' };
}

function fixed(raw, start, length) {
  return String(raw || '').slice(start - 1, start - 1 + length);
}

/** Parses the StarTrack fixed-width QR payload into named fields used by validation and reports. */
export function parseStarTrackQrBarcode(raw) {
  const text = String(raw || '').replace(/^\]Q[0-9]/, '');
  if (text.length < 290) return { valid: false, raw, length: text.length, reason: 'Not a StarTrack fixed-width QR payload.' };
  const fields = {
    receiverSuburb: fixed(text, 1, 30).trim(),
    receiverPostcode: fixed(text, 31, 4).trim(),
    connoteNumber: fixed(text, 35, 12).trim(),
    freightItemNumber: fixed(text, 47, 20).trim(),
    productCode: fixed(text, 67, 3).trim(),
    payerAccount: fixed(text, 70, 8).trim(),
    senderAccount: fixed(text, 78, 8).trim(),
    consignmentQuantity: fixed(text, 86, 4).trim(),
    consignmentWeight: fixed(text, 90, 5).trim(),
    consignmentCube: fixed(text, 95, 5).trim(),
    despatchDate: fixed(text, 100, 8).trim(),
    receiverName1: fixed(text, 108, 40).trim(),
    receiverName2: fixed(text, 148, 40).trim(),
    unitType: fixed(text, 188, 3).trim(),
    destinationDepot: fixed(text, 191, 4).trim(),
    receiverAddress1: fixed(text, 195, 40).trim(),
    receiverAddress2: fixed(text, 235, 40).trim(),
    receiverPhone: fixed(text, 275, 14).trim(),
    dangerousGoodsIndicator: fixed(text, 289, 1).trim(),
    movementTypeIndicator: fixed(text, 290, 1).trim(),
    notBeforeDate: fixed(text, 291, 12).trim(),
    notAfterDate: fixed(text, 303, 12).trim(),
    atlNumber: fixed(text, 315, 10).trim(),
    raNumber: fixed(text, 325, 10).trim()
  };
  const product = STARTRACK_PRODUCT_CODE_MAP[fields.productCode] || null;
  return {
    valid: true,
    type: 'startrack-qr',
    raw,
    length: text.length,
    fields,
    productCode: fields.productCode,
    productName: product?.name || 'Unknown StarTrack product code',
    productGroup: product?.group || 'Unknown',
    expectedLabelCode: product?.labelCode || null
  };
}

/** Extracts visible StarTrack facts from selectable PDF text before decoded data backfills gaps. */
function extractStarTrackFacts(extractedText) {
  const lines = String(extractedText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const joined = lines.join('\n');
  const upper = joined.toUpperCase();
  const labelCode = (joined.match(/\b(TSE|RET|RE2|APT|PRM|FPP|ARL|FPA|EXP)\b/i) || [])[1]?.toUpperCase() || null;
  const sameLineConnote = (joined.match(/(?:CONNOTE|CON\s*NO|CONSIGNMENT(?:\s+NUMBER)?)\s*:?\s*([A-Z0-9]{8,20})/i) || [])[1]?.toUpperCase() || null;
  const nextLineConnote = (joined.match(/(?:CONNOTE|CON\s*NO|CONSIGNMENT(?:\s+NUMBER)?)\s*:?\s*(?:\r?\n|\s{2,})([A-Z0-9]{8,20})/i) || [])[1]?.toUpperCase() || null;
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
  const articleId = (joined.match(/(?:ARTICLE\s*ID|FREIGHT\s*ITEM(?:\s*ID)?)\s*:?\s*([A-Z0-9\s]{12,30})/i) || [])[1]?.replace(/\s+/g, '').toUpperCase() || null;
  const connoteFromArticle = articleId && /^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(articleId) ? articleId.slice(0, 12) : null;
  const connote = sameLineConnote || nextLineConnote || nearbyConnote || connoteFromArticle || null;
  const weight = (joined.match(/\b([0-9]+(?:\.[0-9]+)?)\s*kg\b/i) || [])[1] || null;
  const cube = (joined.match(/\b([0-9]+(?:\.[0-9]+)?)\s*m3\b/i) || [])[1] || null;
  const unit = (joined.match(/\b(BAG|CTN|ITM|JIF|PAL|SAT|SKI)\b/i) || [])[1]?.toUpperCase() || null;
  const destinationLooksNz = /\bNZ\b/.test(upper);
  const dgPresent = /DANGEROUS\s+GOODS|DG\s*[:\-]|AVIATION\s+SECURITY|IATA|UN\s?\d{4}/i.test(joined);
  const authorityToLeavePresent = /AUTHORITY\s+TO\s+LEAVE|\bATL\b/i.test(joined);
  const visibleAtlNumbers = [...new Set((joined.match(/\bC\d{9}\b/gi) || []).map(v => v.toUpperCase()))];
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
function enrichStarTrackFactsFromDecodedData(facts, { qrParses = [], freightParses = [], routingParses = [], validSsccs = [] } = {}) {
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
    labelCode: facts.labelCode || firstRoute?.labelCode || firstFreight?.expectedLabelCode || qrParses[0]?.expectedLabelCode || qrFields.productCode || null,
    connoteNumber: facts.connoteNumber || connoteIds[0] || null,
    articleIds,
    consignmentIds: connoteIds,
    weightKg: facts.weightKg || normalizeQrWeight(qrFields.consignmentWeight),
    cube: facts.cube || normalizeQrCube(qrFields.consignmentCube),
    unit: facts.unit || qrFields.unitType || null,
    toBlock: (facts.toBlock && facts.toBlock.length) ? facts.toBlock : qrReceiverBlock,
    postcodeLines: (facts.postcodeLines && facts.postcodeLines.length) ? facts.postcodeLines : qrPostcodeLines,
    decodedDataUsedForFacts: Boolean(qrParses.length || freightParses.length || routingParses.length || validSsccs.length)
  };
}

/** Validates StarTrack visible-content facts before the barcode-specific checks are added. */
function validateStarTrackTextFacts(facts) {
  const validations = [];
  validations.push(facts.extractedLineCount > 0
    ? result('ST_TEXT_EXTRACTED', 'Visible text extracted', 'INFO', 'startrack-label-layout', 'pass', `${facts.extractedLineCount} text line(s) were extracted from the file.`, { evidence: facts.lines.slice(0, 50).join('\n') })
    : result('ST_TEXT_EXTRACTED', 'Visible text extracted', 'WARNING', 'startrack-label-layout', 'manual_review', 'No selectable text was extracted. Barcode evidence is still assessed from the rendered image.'));
  return validations;
}

/** Runs the full StarTrack rule set against one rendered label/page. */
function auditStarTrackLabel({ fileInfo, detectedBarcodes = [], manualBarcodes = '', manifestJson = '', extractedText = '', visualEvidence = null, ssccCompanyPrefix = '', ssccExtensionDigit = '', labelFormat = 'standard' }) {
  const validations = [];
  const selectedFormat = normalizeLabelFormat(labelFormat);
  const expectedSscc = {
    ...normalizeSsccCompanyPrefixInput(ssccCompanyPrefix, ssccExtensionDigit),
    provided: selectedFormat === 'sscc'
  };
  let facts = extractStarTrackFacts(extractedText);
  const manualValues = diagnosticManualValues(manualBarcodes);
  const decodedValues = decodedRawValues(detectedBarcodes);
  const linearValues = detectedBarcodes.filter(b => /128|code/i.test(String(b.format || b.symbology || '')) || b.kind === 'linear').map(b => b.rawValue).filter(Boolean);
  const qrValues = detectedBarcodes.filter(b => /qr/i.test(String(b.format || b.symbology || '')) || b.kind === 'qr').map(b => b.rawValue).filter(Boolean);

  const qrParses = qrValues.map(parseStarTrackQrBarcode).filter(p => p.valid);
  const freightParses = linearValues.map(parseStarTrackFreightItemBarcode).filter(p => p.valid);
  const ssccParses = decodedValues.map(parseSsccBarcode).filter(p => p.type === 'sscc' && p.valid !== undefined && p.raw);
  const validSsccs = ssccParses.filter(p => p.valid);
  const invalidSsccs = ssccParses.filter(p => !p.valid);
  const routingParses = linearValues.map(parseStarTrackRoutingBarcode).filter(p => p.valid);
  const atlParses = linearValues.map(parseStarTrackAtlBarcode).filter(p => p.valid);
  const expectedAtlNumbers = uniqueNonEmpty([
    ...(facts.visibleAtlNumbers || []),
    ...qrParses.map(q => q.fields?.atlNumber).filter(Boolean)
  ]);
  const atlExpected = Boolean(facts.authorityToLeavePresent || expectedAtlNumbers.length);
  const ssccOnly = selectedFormat === 'sscc' || (validSsccs.length > 0 && freightParses.length === 0);
  const visualLinear = Boolean(visualEvidence?.linearBarcodeVisible);
  const detectedCarrier = qrParses.length || freightParses.length || routingParses.length || atlParses.length || validSsccs.length || /STAR\s*TRACK|STARTRACK/i.test(extractedText || '') ? 'startrack' : 'unknown';
  const detectedFormat = validSsccs.length && !freightParses.length ? 'sscc' : freightParses.length ? 'standard' : validSsccs.length ? 'sscc' : 'unknown';
  const modeEvidence = [
    qrParses.length ? `StarTrack QR payload(s): ${qrParses.length}` : '',
    freightParses.length ? `freight item barcode(s): ${freightParses.map(f => f.freightItemId).join(', ')}` : '',
    validSsccs.length ? `SSCC barcode(s): ${validSsccs.map(s => `00${s.sscc}`).join(', ')}` : '',
    routingParses.length ? `routing barcode(s): ${routingParses.map(r => r.raw).join(', ')}` : ''
  ].filter(Boolean).join('\n');

  facts = enrichStarTrackFactsFromDecodedData(facts, { qrParses, freightParses, routingParses, validSsccs });
  validations.push(...validateSelectedAuditMode({
    selectedCarrier: 'startrack',
    selectedFormat,
    detectedCarrier,
    detectedFormat,
    evidence: modeEvidence || decodedValues.join('\n')
  }));
  validations.push(...validateStarTrackTextFacts(facts));
  validations.push(...validateExpectedSsccPrefix({ expectedSscc, validSsccs, invalidSsccs, category: 'startrack-sscc', idPrefix: 'ST_SSCC_EXPECTED' }));

  for (const [i, sscc] of validSsccs.entries()) {
    validations.push(result(`ST_SSCC_${i}`, 'SSCC freight item detected', 'INFO', 'startrack-sscc', 'pass', `Valid AI 00 SSCC detected: 00${sscc.sscc}.`, { actual: `00${sscc.sscc}` }));
  }
  for (const [i, sscc] of invalidSsccs.entries()) {
    validations.push(result(`ST_SSCC_INVALID_${i}`, 'SSCC check digit', 'CRITICAL', 'startrack-sscc', 'fail', sscc.reason, { expected: sscc.expectedCheckDigit, actual: sscc.checkDigit }));
  }
  if (ssccOnly && selectedFormat !== 'sscc') {
    validations.push(result('ST_SSCC_PRODUCT_RULE', 'SSCC product handling', 'INFO', 'startrack-sscc', 'pass', 'SSCC freight labels encode AI 00 SSCC data. StarTrack product may be supplied by QR/routing data, but it is not embedded in the SSCC article identifier.'));
  }

  const ruleContext = buildStarTrackRuleContext({ fileInfo, facts, selectedFormat, qrParses, freightParses, routingParses, atlParses, validSsccs, invalidSsccs, expectedAtlNumbers, atlExpected, visualEvidence });
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
    expectedSscc,
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

/** Entry point for one rendered label/page; dispatches to carrier rules and attaches payload comparison. */
export function auditLabel(input = {}) {
  const baseAudit = (input.labelFamily === 'startrack' || input.carrier === 'startrack')
    ? auditStarTrackLabel(input)
    : { ...auditEparcelLabel(input), carrier: 'eparcel' };
  return attachApiPayloadComparison(baseAudit, input.manifestJson || input.apiPayloadText || '');
}

/** Groups raw validation rows into the report sections rendered by both UI and exported HTML. */
export function groupValidations(validations) {
  const displayCategory = (category) => {
    if (category === 'gs1-128' || category === 'barcode-structure' || category === 'check-digit') return 'linear barcode analysis';
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
