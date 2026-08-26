// StarTrack routing barcodes: the SSS9999DD/DDD form and the GS1 421/403
// routing form used on AU Domestic SSCC labels.
import { stripAiDecorations } from '../../formats/gs1.js';
import { STARTRACK_LABEL_CODE_MAP } from '../referenceData.js';

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
