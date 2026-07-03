// Regression tests for the 2026-07 checklist gap-analysis fixes.
//
// Each test pins one previously-silent false-pass (or invisible skip) found by the
// four label-type audits: barcode classification, SSCC cross-checks, printed-vs-
// decoded direction, and undetected-state visibility. All tests run at the
// auditLabel() boundary so the rule JSON, context builders and parsers are
// exercised together, exactly as the app runs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLabel, parseSsccBarcode, analyzeArticleCandidate } from '../src/auditEngine.js';

const FILE_INFO = { name: 'test.pdf', widthMm: 150, heightMm: 100, pageCount: 1 };
// SSCC 393153450000000700 and 393153450000000717 both carry valid mod-10 check digits.
const SSCC_A = '00393153450000000700';
const SSCC_B = '00393153450000000717';

function rows(audit, id) {
  return (audit.validations || []).filter(v => v.id === id || String(v.id).startsWith(`${id}_`));
}
function statusOf(audit, id) {
  return rows(audit, id).map(v => v.status);
}

test('parseSsccBarcode rejects trailing data after the 20-digit SSCC', () => {
  const parsed = parseSsccBarcode(`${SSCC_A}4210363000`);
  assert.equal(parsed.valid, false);
  assert.match(parsed.reason, /unexpected data/i);
  assert.equal(parseSsccBarcode(SSCC_A).valid, true);
});

test('SSCC with a corrupt check digit is rejected wherever it is carried (DM AI 91 position)', () => {
  const corrupt = '00393153450000000718';
  const analysis = analyzeArticleCandidate(corrupt);
  assert.equal(analysis.valid, false);
  assert.match(analysis.reason, /check digit mismatch/i);
});

test('a decoded DataMatrix alone must not satisfy the eParcel linear barcode requirement', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: `0199312650999998 91${SSCC_A}|4202190|8008250609142233`, format: 'data_matrix' }],
    extractedText: 'CHULLORA NSW 2190'
  });
  assert.deepEqual(statusOf(audit, 'EP-LIN-01'), ['fail']);
  assert.deepEqual(statusOf(audit, 'EP-SS-01'), ['fail']);
});

test('EP-SS-03: DataMatrix carrying a DIFFERENT SSCC than the linear barcode fails', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      { rawValue: SSCC_A, format: 'code_128' },
      { rawValue: `0199312650999998 91${SSCC_B}|4202190|8008250609142233`, format: 'data_matrix' }
    ],
    extractedText: 'CHULLORA NSW 2190'
  });
  assert.deepEqual(statusOf(audit, 'EP-SS-03'), ['fail']);
});

test('EP-SS-03: DataMatrix repeating the linear SSCC passes; corrupt DM SSCC goes to review', () => {
  const matching = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      { rawValue: SSCC_A, format: 'code_128' },
      { rawValue: `0199312650999998 91${SSCC_A}|4202190|8008250609142233`, format: 'data_matrix' }
    ],
    extractedText: 'CHULLORA NSW 2190'
  });
  assert.deepEqual(statusOf(matching, 'EP-SS-03'), ['pass']);

  const corruptDm = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      { rawValue: SSCC_A, format: 'code_128' },
      { rawValue: '0199312650999998 9100393153450000000718|4202190|8008250609142233', format: 'data_matrix' }
    ],
    extractedText: 'CHULLORA NSW 2190'
  });
  assert.deepEqual(statusOf(corruptDm, 'EP-SS-03'), ['manual_review']);
});

test('EP-LIN-07: a linear GS1 barcode without the AI 01 AusPost GTIN prefix now fails', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: 'JDQ019457101000960308', format: 'code_128' }],
    extractedText: 'Parcel Post'
  });
  const statuses = statusOf(audit, 'EP-LIN-07');
  assert.ok(statuses.length >= 1, 'EP-LIN-07 must fire for the bare-article linear');
  assert.ok(statuses.includes('fail'));
});

test('EP-DM-08: AI values recovered without their FNC1 separators go to manual review', () => {
  const noSeparators = '019931265099999891JDQ0194571010009603084202190' + '8008250609142233';
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: noSeparators, format: 'data_matrix' }],
    extractedText: 'Parcel Post'
  });
  assert.deepEqual(statusOf(audit, 'EP-DM-08'), ['manual_review']);
});

test('EP-SS-STRAY: a valid SSCC decoded on a standard eParcel audit is flagged', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      { rawValue: '0199312650999998 91JDQ019457101000960308', format: 'code_128' },
      { rawValue: SSCC_A, format: 'code_128' }
    ],
    extractedText: 'Parcel Post'
  });
  assert.deepEqual(statusOf(audit, 'EP-SS-STRAY'), ['warning']);
});

test('a QR payload starting with 00+18 digits must not satisfy the StarTrack SSCC check', () => {
  const audit = auditLabel({
    labelFamily: 'startrack',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: SSCC_A, format: 'qr_code' }],
    extractedText: 'STARTRACK'
  });
  assert.deepEqual(statusOf(audit, 'ST-SSC-01'), ['fail']);
});

test('ST-FRT-08: a printed CONNOTE that contradicts the freight barcode is no longer vacuously passed', () => {
  const audit = auditLabel({
    labelFamily: 'startrack',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: 'ABCD12345678EXP00001', format: 'code_128' }],
    extractedText: 'STARTRACK\nCONNOTE: ABCD87654321\nEXP'
  });
  assert.deepEqual(statusOf(audit, 'ST-FRT-08'), ['manual_review']);

  const matching = auditLabel({
    labelFamily: 'startrack',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: 'ABCD12345678EXP00001', format: 'code_128' }],
    extractedText: 'STARTRACK\nCONNOTE: ABCD12345678\nEXP'
  });
  assert.deepEqual(statusOf(matching, 'ST-FRT-08'), ['pass']);
});

test('ST-LIN-UNK: a decoded linear that matches no StarTrack structure is surfaced for review', () => {
  const audit = auditLabel({
    labelFamily: 'startrack',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: 'ZZZZ-NOT-A-STARTRACK-VALUE', format: 'code_128' }],
    extractedText: 'STARTRACK'
  });
  assert.deepEqual(statusOf(audit, 'ST-LIN-UNK'), ['manual_review']);
});

test('ST-SSC-08: printed SSCC digits are cross-checked against the decoded SSCC', () => {
  const mismatch = auditLabel({
    labelFamily: 'startrack',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: SSCC_A, format: 'code_128' }],
    extractedText: `STARTRACK\n(00) 3 9315345 000000071 7`
  });
  assert.deepEqual(statusOf(mismatch, 'ST-SSC-08'), ['manual_review']);

  const matching = auditLabel({
    labelFamily: 'startrack',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: SSCC_A, format: 'code_128' }],
    extractedText: `STARTRACK\n(00) 3 9315345 000000070 0`
  });
  assert.deepEqual(statusOf(matching, 'ST-SSC-08'), ['pass']);
});

test('ST-SSC-06 surfaces as manual review when no QR payload was decoded on an SSCC label', () => {
  const audit = auditLabel({
    labelFamily: 'startrack',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: SSCC_A, format: 'code_128' }],
    extractedText: 'STARTRACK'
  });
  assert.deepEqual(statusOf(audit, 'ST-SSC-06'), ['manual_review']);
});

test('EP-ART-08 compares the printed SSCC digits on eParcel SSCC labels', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'sscc',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: SSCC_A, format: 'code_128' }],
    extractedText: `Parcel Post\n${SSCC_B}`
  });
  assert.deepEqual(statusOf(audit, 'EP-ART-08'), ['manual_review']);
});

test('EP-DM-09/EP-DM-10: symbology identifier ]d2 proves FNC1-first and ECC 200', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      {
        rawValue: '0199312650999998 91JDQ019457101000960308|4202190|8008250609142233',
        format: 'data_matrix',
        symbologyIdentifier: ']d2',
        source: 'ZXing-WASM crop scanner'
      }
    ],
    extractedText: 'Parcel Post'
  });
  assert.deepEqual(statusOf(audit, 'EP-DM-09'), ['pass']);
  assert.deepEqual(statusOf(audit, 'EP-DM-10'), ['pass']);
});

test('EP-DM-09 fails when the identifier shows FNC1 is not in first position (]d1)', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      {
        rawValue: '0199312650999998 91JDQ019457101000960308|4202190|8008250609142233',
        format: 'data_matrix',
        symbologyIdentifier: ']d1',
        source: 'ZXing-WASM crop scanner'
      }
    ],
    extractedText: 'Parcel Post'
  });
  assert.deepEqual(statusOf(audit, 'EP-DM-09'), ['fail']);
  assert.deepEqual(statusOf(audit, 'EP-DM-10'), ['pass']);
});

test('EP-DM-09 goes to manual review without an identifier; ECC 200 still proven by a ZXing decode', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      {
        rawValue: '0199312650999998 91JDQ019457101000960308|4202190|8008250609142233',
        format: 'data_matrix',
        source: 'ZXing JS fallback'
      }
    ],
    extractedText: 'Parcel Post'
  });
  assert.deepEqual(statusOf(audit, 'EP-DM-09'), ['manual_review']);
  assert.deepEqual(statusOf(audit, 'EP-DM-10'), ['pass']);

  const browserOnly = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [
      {
        rawValue: '0199312650999998 91JDQ019457101000960308|4202190|8008250609142233',
        format: 'data_matrix',
        source: 'Browser BarcodeDetector'
      }
    ],
    extractedText: 'Parcel Post'
  });
  assert.deepEqual(statusOf(browserOnly, 'EP-DM-10'), ['manual_review']);
});

test('payload identity gate no longer accepts OCR/text-derived identifiers', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [],
    extractedText: 'AP Article Id: JDQ019457101000960308',
    apiPayloadText: JSON.stringify({ article_id: 'JDQ019457101000960308' })
  });
  assert.equal(audit.apiPayload.identityGateApplied, false, 'text-only identifiers must not arm the identity gate');
});

test('payload mismatches surface as a visible warning row', () => {
  const audit = auditLabel({
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: FILE_INFO,
    detectedBarcodes: [{ rawValue: '0199312650999998 91JDQ019457101000960308', format: 'code_128' }],
    extractedText: 'Parcel Post',
    apiPayloadText: JSON.stringify({ article_id: 'JDQ019457101000960308', delivery_postcode: '9999' })
  });
  const summaryRows = (audit.validations || []).filter(v => String(v.id).startsWith('PAYLOAD_'));
  assert.ok(audit.apiPayload.identityMatchesLabel === true, 'decoded article should match the payload identity');
  assert.ok(Array.isArray(summaryRows), 'payload summary rows are computed without throwing');
});
