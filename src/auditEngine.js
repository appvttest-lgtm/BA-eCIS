// Public audit API. The carrier packs under src/carriers/ hold the actual
// logic (facts, contexts, rules, formats); this module dispatches auditLabel
// to the selected carrier and re-exports the pack internals so existing
// imports (UI, scanner, tests) keep working unchanged.
import { CARRIERS } from './carriers/index.js';

export * from './carriers/eparcel/referenceData.js';
export * from './carriers/startrack/referenceData.js';
export { gs1LinearComplianceEvidence, normalizeBarcode, parseSsccBarcode } from './carriers/formats/gs1.js';
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
export { extractLabelFacts, extractTextBarcodeCandidates } from './carriers/eparcel/facts.js';

/** Entry point for one rendered label/page; dispatches to the selected carrier pack. */
export function auditLabel(input = {}) {
  const id = input.labelFamily === 'startrack' || input.carrier === 'startrack' ? 'startrack' : 'eparcel';
  return CARRIERS[id].audit(input);
}

// Merged from each pack's displayCategories, so shared code never names a carrier.
const DISPLAY_CATEGORIES = Object.assign({}, ...Object.values(CARRIERS).map(c => c.displayCategories || {}));

/** Groups raw validation rows into the report sections rendered by both UI and exported HTML. */
export function groupValidations(validations) {
  return validations.reduce((acc, item) => {
    const key = DISPLAY_CATEGORIES[item.category] || item.category;
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...item, originalCategory: item.category });
    return acc;
  }, {});
}
