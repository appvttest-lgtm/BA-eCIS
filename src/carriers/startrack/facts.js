// Visible-text fact extraction for StarTrack labels, plus the decoded-data
// backfill used when the PDF text layer is sparse.
import {
  extractDgBlock,
  extractFromBlock,
  extractPostcodeLines,
  extractToBlock,
  textLines,
  uniqueNonEmpty
} from '../shared/text.js';

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
export function extractStarTrackFacts(extractedText) {
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
export function enrichStarTrackFactsFromDecodedData(
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
