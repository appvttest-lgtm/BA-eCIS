// The Australia Post GS1 DataMatrix payload: extraction of AIs 420/92/8008 (AI = GS1
// Application Identifier, the numeric prefix that names a field), forensics on FNC1
// separators (the GS1 control character that ends a variable-length field), and ISO
// symbology-identifier compliance evidence.
import { normalizeBarcode } from '../../formats/gs1.js';
import { parseEparcelBarcode } from './article.js';

/** Parses GS1 DataMatrix content and extracts Australia Post-specific AIs where available. */
export function parseGs1DataMatrix(raw) {
  const normalized = normalizeBarcode(raw);
  const segments = normalized.split('|');
  const parts = segments.filter(Boolean);
  const compact = normalized.replace(/\|/g, '');
  // An empty segment means two separators ran together, or one trailed the payload -
  // most often AI 92 removed without removing its FNC1 (PP&EP v1.4 p28). A LEADING
  // empty is ignored: that is a scanner transmitting the symbol's own start FNC1 as
  // data, not a producer error.
  const emptySeparatorSegments = segments.slice(1).filter(part => part === '').length;
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

  // Compact fallbacks recover AI values when the scanner dropped the FNC1 group
  // separators. Each recovery is recorded: a conforming symbol positions a
  // separator before AI 420 and AI 8008 (EP-DM-08), so needing the fallback is
  // itself evidence the separators are missing or misplaced.
  const aiSeparatorFallbacks = [];
  if (!hasAi420) {
    const m = compact.match(/420(\d{4})/);
    if (m) {
      hasAi420 = true;
      postcode = m[1];
      aiSeparatorFallbacks.push('420');
    }
  }
  if (!hasAi92) {
    const m = compact.match(/92(\d{8})/);
    if (m) {
      hasAi92 = true;
      dpid = m[1];
      aiSeparatorFallbacks.push('92');
    }
  }
  if (!hasAi8008) {
    const m = compact.match(/8008(\d{12})/);
    if (m) {
      hasAi8008 = true;
      dateTime = m[1];
      aiSeparatorFallbacks.push('8008');
    }
  }

  // A separator position holding printed text ($, _1, the word FNC1) or any other
  // non-alphanumeric character instead of the ASCII 29 control character.
  const literalAtStart = (normalized.match(/^(?:\$|_1|FNC1)/i) || [])[0] || null;
  const literalBeforeAi = (normalized.match(/(?:\$|_1|FNC1|[^0-9A-Za-z|])(?=420\d|92\d|8008\d)/i) || [])[0] || null;
  const literalSeparatorMarker = literalAtStart || literalBeforeAi;

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
    aiSeparatorFallbacks,
    emptySeparatorSegments,
    literalSeparatorMarker,
    invalidLiteralSeparators: Boolean(literalSeparatorMarker)
  };
}

/**
 * GS1 DataMatrix carrier-compliance evidence (GS1 DataMatrix Guideline; ISO/IEC 16022/15424).
 * A GS1 DataMatrix is Data Matrix ECC 200 with FNC1 in the first codeword position. The
 * leading FNC1 is NOT transmitted as data - scanners signal it through the ISO/IEC 15424
 * symbology identifier: ]d2 / ]d5 mean ECC 200 + FNC1 first (GS1); ]d1/]d3/]d4/]d6 are
 * ECC 200 without FNC1 first; ]d0 is the non-permitted ECC 000-140 family. When no
 * identifier is available, a decode by either ZXing engine still proves ECC 200 because
 * ZXing only reads ECC 200 symbols; FNC1-first then stays unknown (null).
 */
export function dataMatrixComplianceEvidence({ raw = '', symbologyIdentifier = '', decoderSource = '' } = {}) {
  const identifier = String(symbologyIdentifier || '') || (String(raw).match(/^\]d\d/) || [])[0] || '';
  let fnc1FirstPosition = null;
  if (identifier === ']d2' || identifier === ']d5') fnc1FirstPosition = true;
  else if (/^\]d\d$/.test(identifier)) fnc1FirstPosition = false;
  let ecc200 = null;
  if (/^\]d[1-6]$/.test(identifier)) ecc200 = true;
  else if (identifier === ']d0') ecc200 = false;
  else if (/zxing/i.test(String(decoderSource))) ecc200 = true;
  return { symbologyIdentifier: identifier, fnc1FirstPosition, ecc200, decoderSource: String(decoderSource || '') };
}

/** Identifies likely DataMatrix content when a scanner returns incomplete symbology metadata. */
export function looksLikeDataMatrix(raw, format = '') {
  const fmt = String(format || '');
  if (/data[_\s-]?matrix/i.test(fmt)) return true;
  // Explicit non-DataMatrix symbology metadata is authoritative: an article's
  // digits can coincidentally contain "420"/"8008", so content sniffing is only
  // a fallback for scanners that report no usable format.
  if (/code[_\s-]?128|gs1|qr|ean|upc|pdf417|aztec|itf|codabar|code[_\s-]?39|code[_\s-]?93/i.test(fmt)) return false;
  const n = normalizeBarcode(raw);
  return n.includes('420') || n.includes('8008') || n.includes('|92') || n.includes('|420');
}
