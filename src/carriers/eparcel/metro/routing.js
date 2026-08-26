// Metro-only routing block extraction. This code exists because of the Metro
// label type: its "AU STATE POSTCODE" routing line does not appear on the
// other eParcel templates.
import { STATE_REGEX } from '../../shared/text.js';

// Metro labels carry a routing block - destination country code, state and postcode -
// that the other eParcel templates do not have. Text items sharing a baseline are grouped
// into a single line upstream (PDF text layer and OCR alike), so a same-line match is the
// reliable signal; anything else stays undetected and surfaces as manual review rather
// than passing silently.
const METRO_ROUTING_REGEX = new RegExp(`^AU\\s+(${STATE_REGEX})\\s+(\\d{4})$`, 'i');

/** Extracts the Metro routing block (country code, state and postcode) from a single line. */
export function extractRoutingDetails(lines) {
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
