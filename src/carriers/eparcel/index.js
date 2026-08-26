// The eParcel carrier pack: everything the registry needs to audit and report
// on an eParcel label. Adding a label type (variant) means a rules.json in a
// new variant folder plus a ruleSets.js entry - not new code here.
import { auditEparcelLabel } from './audit.js';
import { RULE_SETS } from './ruleSets.js';

const eparcel = {
  id: 'eparcel',
  name: 'eParcel',
  audit: auditEparcelLabel,
  ruleSets: RULE_SETS,
  // Maps this carrier's validation categories to report section headings.
  displayCategories: {
    'gs1-128': 'linear barcode analysis',
    'barcode-structure': 'linear barcode analysis',
    'check-digit': 'linear barcode analysis',
    datamatrix: 'DataMatrix barcode analysis'
  }
};

export default eparcel;
