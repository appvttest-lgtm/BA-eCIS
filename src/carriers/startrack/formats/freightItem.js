// The StarTrack 20-character Code 128 freight item barcode.
import { stripAiDecorations } from '../../formats/gs1.js';
import { STARTRACK_PRODUCT_CODE_MAP } from '../referenceData.js';

/** Parses the 20-char freight item barcode: connote (consignment note number: 4-char despatch
 *  ID + 8 digits), 3-char product code, and 5-digit item number. */
export function parseStarTrackFreightItemBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  // An AI 00 + 18-digit value is the SSCC article identifier, never a freight item. The
  // 20-char shapes collide on all-digit values, but a real freight item can never be all
  // digits: despatch IDs carry an alphabetic 3rd character (and Z 4th) and every StarTrack
  // product code is alphabetic. Without this rejection an SSCC label is misdetected as a
  // standard label and the audit-mode check fails.
  if (/^00\d{18}$/.test(compact)) {
    return {
      valid: false,
      raw,
      compact,
      reason: 'This is a GS1 AI 00 SSCC article identifier, not a 20-character freight item barcode.'
    };
  }
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
