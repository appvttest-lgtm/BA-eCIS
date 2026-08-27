// The eParcel article barcode format: the alpha-substitution check digit, the
// 21/23-character article ID structure (MLID - the merchant location ID Australia
// Post assigns - plus consignment, product and service fields), and the GS1-128
// article parser. Code exists here because of the eParcel article layout;
// SSCC/GS1 primitives come from ../../formats/gs1.js.
import { gs1Mod10CheckDigit, normalizeBarcode } from '../../formats/gs1.js';
import { getProductCodeDescription, getServiceCodeDescription } from '../referenceData.js';

/** Converts eParcel alpha characters to the digits used by the article check-digit algorithm. */
function alphaToAsciiLastDigit(ch) {
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
    // The SSCC mod-10 check digit must hold wherever the SSCC is carried,
    // including the AI 91 article position inside a GS1 DataMatrix.
    const ssccDigits = cleaned.slice(2);
    if (gs1Mod10CheckDigit(ssccDigits.slice(0, -1)) !== ssccDigits.slice(-1)) return null;
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
  const cleaned = String(candidate || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  const valid = parseValidArticleId(cleaned);
  if (valid) return { valid: true, article: valid, candidate: cleaned, reason: null };

  let reason = 'Article string does not match a standard eParcel article ID or SSCC structure.';
  if (/^00\d{18}$/.test(cleaned)) {
    const ssccDigits = cleaned.slice(2);
    reason = `SSCC check digit mismatch. Expected ${gs1Mod10CheckDigit(ssccDigits.slice(0, -1))}, got ${ssccDigits.slice(-1)}.`;
  } else if (/^00\d+$/.test(cleaned) && cleaned.length !== 20) {
    reason = `SSCC article IDs must be 20 digits including AI 00. Detected length ${cleaned.length}.`;
  } else if (/^\d+$/.test(cleaned) || /^[A-Z0-9]+$/.test(cleaned)) {
    reason = `Standard eParcel article IDs must be 21 characters for 3-character MLID or 23 characters for 5-character MLID. Detected length ${cleaned.length}.`;
  }
  return { valid: false, article: null, candidate: cleaned, reason };
}

/** Keeps the valid article prefix when scanner output has extra trailing GS1 data. */
function trimArticleCandidate(candidate) {
  const cleaned = String(candidate || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  // A separator-bounded field of exactly 21/23 chars that fully validates as a standard
  // article IS the article - never truncate it. Without this, an all-numeric article whose
  // MLID starts "00" can be mis-read as an SSCC when its first 20 digits pass mod-10.
  if ((cleaned.length === 21 || cleaned.length === 23) && analyzeArticleCandidate(cleaned)?.valid) {
    return cleaned;
  }
  // An SSCC in the article position is exactly 20 digits (AI 00 + 18-digit SSCC). Try that
  // shape before the 21/23-character standard slices: its GS1 check digit gates false
  // matches, and without it a separator-less decode lets the 21-character slice swallow the
  // first digit of the NEXT field (the spec's own SSCC DataMatrix example fails that way).
  if (/^00\d{18}/.test(cleaned) && analyzeArticleCandidate(cleaned.slice(0, 20))?.valid) {
    return cleaned.slice(0, 20);
  }
  // Standard eParcel article IDs are 21 chars with a 3-char MLID or 23 chars with a 5-char MLID.
  for (const len of [21, 23]) {
    const slice = cleaned.slice(0, len);
    if (analyzeArticleCandidate(slice)?.valid) return slice;
  }
  return cleaned;
}

/** Extracts the article carried under GS1 AI 91 (Application Identifier, the numeric field prefix). */
function extractArticleCandidateFromGs1Normalized(normalized, compact) {
  // A leading FNC1 normalizes to '|'; strip it so the AusPost-GTIN fast path (which
  // correctly bounds the article at the next separator) still recognises the payload.
  const n = String(normalized || '').replace(/^\|+/, '');
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
    return {
      symbologyType: 'GS1-128/SSCC',
      raw,
      normalized,
      compact,
      isSscc: true,
      article: analysis?.article || null,
      articleAnalysis: analysis
    };
  }

  const hasAi01 = compact.startsWith('01');
  const hasAusPostGtin = compact.startsWith('0199312650999998');
  const hasAi91 = hasAusPostGtin ? compact.slice(16, 18) === '91' : compact.includes('91');

  let articleCandidate = extractArticleCandidateFromGs1Normalized(normalized, compact);
  if (!articleCandidate && /^[A-Z0-9]{10,30}$/.test(compact)) articleCandidate = trimArticleCandidate(compact);

  const articleAnalysis = articleCandidate ? analyzeArticleCandidate(articleCandidate) : null;

  return {
    symbologyType:
      normalized.includes('420') || normalized.includes('8008') ? 'GS1-DataMatrix-like' : 'GS1-128/Article-like',
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
