// Audit-level regression tests for the eParcel SSCC FNC1-in-first-position rule
// (EP-SS-09): the linear SSCC barcode must be GS1-128, proven by the decoder's
// ISO/IEC 15424 symbology identifier ]C1 — mirroring StarTrack's ST-SSC-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLabel } from '../src/auditEngine.js';

const VALID_SSCC = '00000000000000000017'; // AI 00 + 18 digits, mod-10 check digit 7

function runEparcelSsccAudit(detectedBarcodes) {
  return auditLabel({
    fileInfo: {},
    detectedBarcodes,
    extractedText: '',
    labelFormat: 'sscc'
  });
}

function findValidation(audit, ruleId) {
  return audit.validations.find(v => v.id === ruleId || String(v.id).startsWith(`${ruleId}_`));
}

test('EP-SS-09 passes when the decoder reports ]C1 (FNC1 in first position)', () => {
  const audit = runEparcelSsccAudit([
    { rawValue: VALID_SSCC, format: 'code_128', symbologyIdentifier: ']C1', source: 'ZXing-WASM crop scanner' }
  ]);
  const row = findValidation(audit, 'EP-SS-09');
  assert.ok(row, 'expected an EP-SS-09 validation row');
  assert.equal(row.status, 'pass');
  assert.match(row.message, /FNC1 is encoded in the first position/);
  assert.match(row.evidence, /\]C1/);
});

test('EP-SS-09 fails when the identifier shows plain Code 128 (no leading FNC1)', () => {
  const audit = runEparcelSsccAudit([
    { rawValue: VALID_SSCC, format: 'code_128', symbologyIdentifier: ']C0', source: 'ZXing-WASM crop scanner' }
  ]);
  const row = findValidation(audit, 'EP-SS-09');
  assert.equal(row.status, 'fail');
  assert.match(row.message, /does NOT start with FNC1/);
  assert.match(row.evidence, /\]C0/);
});

test('EP-SS-09 defers to manual review when no symbology identifier was reported', () => {
  const audit = runEparcelSsccAudit([{ rawValue: VALID_SSCC, format: 'code_128', source: 'Browser BarcodeDetector' }]);
  const row = findValidation(audit, 'EP-SS-09');
  assert.equal(row.status, 'manual_review');
  assert.match(row.message, /could not be verified digitally/);
});

test('EP-SS-09 never lets a DataMatrix repeat of the SSCC stand in for the linear symbol', () => {
  // Only a DataMatrix decoded: no linear SSCC exists, so EP-SS-09 has nothing to assess
  // (EP-SS-01 separately fails the missing linear scan).
  const audit = runEparcelSsccAudit([
    { rawValue: `019931265099999891${VALID_SSCC}`, format: 'data_matrix', symbologyIdentifier: ']d2' }
  ]);
  assert.equal(findValidation(audit, 'EP-SS-09'), undefined, 'no EP-SS-09 row without a linear SSCC decode');
  assert.equal(findValidation(audit, 'EP-SS-01')?.status, 'fail');
});
