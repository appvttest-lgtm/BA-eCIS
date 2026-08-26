// Specification standard / example text per validation id, shown under rule rows.
import { EPARCEL_STANDARD_EXAMPLES } from '../carriers/eparcel/standards.js';
import { STARTRACK_STANDARD_EXAMPLES } from '../carriers/startrack/standards.js';

const STANDARD_EXAMPLES = { ...EPARCEL_STANDARD_EXAMPLES, ...STARTRACK_STANDARD_EXAMPLES };

export function standardForValidation(v) {
  const id = String(v?.id || '');
  const direct = STANDARD_EXAMPLES[id];
  if (direct) return direct;
  const key = Object.keys(STANDARD_EXAMPLES).find(k => id.startsWith(k));
  if (key) return STANDARD_EXAMPLES[key];
  return v?.expected || 'Follow the Australia Post eParcel label/barcode rule for this field.';
}
