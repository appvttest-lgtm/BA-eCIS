// Display segmentation: the SSCC field map's FNC1-start marker must reflect actual scan
// evidence - shown with the captured symbology identifier, absent when none was reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawSegments, rawValueWithIdentifier } from '../src/report/segments.js';

const SSCC = '00000000000000000017';

test('SSCC map leads with an FNC1 marker when the scan captured ]C1', () => {
  const segs = rawSegments(`]C1${SSCC}`, 'sscc');
  assert.equal(segs[0].label, 'FNC1 start');
  assert.equal(segs[0].display, '⟨FNC1⟩ ]C1');
  assert.equal(segs[0].text, ']C1');
  assert.equal(segs[1].label, 'AI 00');
});

test('SSCC map shows a non-GS1 identifier as itself, without an FNC1 marker glyph', () => {
  const segs = rawSegments(`]C0${SSCC}`, 'sscc');
  assert.equal(segs[0].label, 'FNC1 start');
  assert.equal(segs[0].display, ']C0');
});

test('SSCC map shows no FNC1 row at all when the scan reported no identifier', () => {
  const segs = rawSegments(SSCC, 'sscc');
  assert.equal(segs[0].label, 'AI 00');
  assert.equal(
    segs.some(s => s.label === 'FNC1 start'),
    false
  );
});

test('rawValueWithIdentifier re-attaches the identifier only for GS1 field-map kinds', () => {
  const barcode = { rawValue: SSCC, symbologyIdentifier: ']C1' };
  assert.equal(rawValueWithIdentifier(barcode, 'freight'), `]C1${SSCC}`);
  assert.equal(rawValueWithIdentifier(barcode, 'routing'), SSCC);
  assert.equal(rawValueWithIdentifier({ rawValue: SSCC }, 'freight'), SSCC);
});
