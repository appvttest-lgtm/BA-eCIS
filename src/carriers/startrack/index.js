// The StarTrack carrier pack: everything the registry needs to audit and
// report on a StarTrack label. Adding a label type (variant) means a
// rules.json in a new variant folder plus a ruleSets.js entry - not new code here.
import { auditStarTrackLabel } from './audit.js';
import { RULE_SETS } from './ruleSets.js';

const startrack = {
  id: 'startrack',
  name: 'StarTrack',
  audit: auditStarTrackLabel,
  ruleSets: RULE_SETS,
  // Maps this carrier's validation categories to report section headings.
  displayCategories: {
    'startrack-qr': 'StarTrack QR barcode',
    'startrack-freight': 'StarTrack freight item barcode',
    'startrack-sscc': 'StarTrack freight item barcode',
    'startrack-routing': 'StarTrack routing barcode',
    'startrack-atl': 'StarTrack ATL barcode',
    'startrack-product': 'StarTrack product/article data',
    'startrack-label-layout': 'label-layout',
    'startrack-text': 'address-format'
  }
};

export default startrack;
