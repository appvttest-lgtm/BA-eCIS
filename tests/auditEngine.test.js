import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeArticleCandidate,
  calculateEparcelCheckDigit,
  normalizeBarcode,
  parseSsccBarcode,
  parseStarTrackAtlBarcode,
  parseStarTrackFreightItemBarcode,
  parseStarTrackRoutingBarcode
} from '../src/auditEngine.js';
import { FORMAT_KIND, isDataMatrixBarcode, isLinearBarcode, isQrBarcode } from '../src/scanner/barcodeTypes.js';

describe('GS1 SSCC parsing', () => {
  it('accepts AI 00 SSCC values with decoration and validates the check digit', () => {
    const parsed = parseSsccBarcode('(00) 3 93 15345 000000070 0');

    assert.equal(parsed.valid, true);
    assert.equal(parsed.articleId, '00393153450000000700');
    assert.equal(parsed.extensionDigit, '3');
    assert.equal(parsed.companyPrefixAndSerial, '9315345000000070');
    assert.equal(parsed.checkDigit, '0');
  });

  it('rejects SSCC values with an incorrect check digit', () => {
    const parsed = parseSsccBarcode('00393153450000000701');

    assert.equal(parsed.valid, false);
    assert.match(parsed.reason, /check digit mismatch/i);
  });
});

describe('StarTrack barcode parsing', () => {
  it('parses freight item Code128 values into connote, product and item fields', () => {
    const parsed = parseStarTrackFreightItemBarcode('ABCD12345678EXP00001');

    assert.equal(parsed.valid, true);
    assert.equal(parsed.connoteNumber, 'ABCD12345678');
    assert.equal(parsed.productCode, 'EXP');
    assert.equal(parsed.expectedLabelCode, 'EXP');
    assert.equal(parsed.itemNumber, '00001');
  });

  it('parses standard routing and GS1 routing barcode forms', () => {
    const standard = parseStarTrackRoutingBarcode('EXP3000SYD');
    const gs1 = parseStarTrackRoutingBarcode('4210363000403EXP');

    assert.equal(standard.valid, true);
    assert.equal(standard.labelCode, 'EXP');
    assert.equal(standard.postcode, '3000');
    assert.equal(gs1.valid, true);
    assert.equal(gs1.formatDescription, 'GS1 421 routing barcode for AU Domestic SSCC labels');
  });

  it('parses Authority To Leave barcode values', () => {
    const parsed = parseStarTrackAtlBarcode('C123456789');

    assert.equal(parsed.valid, true);
    assert.equal(parsed.counterNumber, 123456789);
  });
});

describe('eParcel check digit support', () => {
  it('keeps the documented alpha-to-digit check digit conversion stable', () => {
    const result = calculateEparcelCheckDigit('ABC12345678901234567');

    assert.equal(result.validInput, true);
    assert.equal(result.converted, '56712345678901234567');
    assert.equal(result.checkDigit, '5');
  });

  it('normalizes GS1 scanner prefixes and control separators before parsing', () => {
    assert.equal(normalizeBarcode(']C10199312650999998\x1d910123'), '0199312650999998|910123');
  });

  it('keeps invalid article candidates explainable for reviewers', () => {
    const analysis = analyzeArticleCandidate('ABC123');

    assert.equal(analysis.valid, false);
    assert.ok(analysis.reason.length > 0);
  });
});

describe('barcode type predicates', () => {
  it('keeps explicit decoder kinds classified consistently', () => {
    assert.equal(isQrBarcode({ kind: FORMAT_KIND.qr }), true);
    assert.equal(isDataMatrixBarcode({ format: 'data_matrix' }), true);
    assert.equal(isLinearBarcode({ kind: FORMAT_KIND.linear }), true);
  });

  it('does not treat QR or DataMatrix evidence as linear Code128', () => {
    assert.equal(isLinearBarcode({ format: 'qr_code' }), false);
    assert.equal(isLinearBarcode({ rawValue: '(420)3000(92)12345678' }), false);
  });
});
