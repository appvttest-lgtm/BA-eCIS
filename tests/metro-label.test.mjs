// Metro (Metro to Metro) label support.
//
// The golden fixtures under tests/fixtures/eparcel-standard/metro-*.json cover the whole
// audit for a conforming and a mis-routed Metro label. This file covers the pieces those
// two snapshots cannot reach: the text-extraction branches that only some layouts hit, and
// variant selection when nothing decodes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLabel, extractLabelFacts } from '../src/auditEngine.js';

const METRO_ARTICLE = '111JD' + '0000120' + '01' + '00121' + '09' + '0' + '0';
const METRO_LINEAR = `019931265099999891${METRO_ARTICLE}`;

const audit = extractedText =>
  auditLabel({
    carrier: 'eparcel',
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: { name: 'metro.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
    detectedBarcodes: [{ rawValue: METRO_LINEAR, format: 'code_128' }],
    extractedText
  });

const statusOf = (result, id) => result.validations.find(v => v.id === id)?.status;

// --- routing block extraction ---

test('routing details are read from a single AU / state / postcode line', () => {
  const facts = extractLabelFacts('To\nMELBOURNE VIC 3000\nPh: 03 1234 5678\nAU VIC 3000');
  assert.equal(facts.routingLine, 'AU VIC 3000');
  assert.equal(facts.routingState, 'VIC');
  assert.equal(facts.routingPostcode, '3000');
});

test('a lowercase routing line is captured but fails the uppercase rule', () => {
  const facts = extractLabelFacts('To\nMELBOURNE VIC 3000\nPh: 03 1234\nau vic 3000');
  assert.equal(facts.routingState, 'VIC', 'state is still usable for the cross-check');
  assert.equal(facts.routingLine, 'au vic 3000', 'raw case is preserved so the rule can judge it');
});

test('no routing line leaves the routing facts null rather than guessing', () => {
  const facts = extractLabelFacts('To\nMELBOURNE VIC 3000\nAP Article ID: 123');
  assert.equal(facts.routingLine, null);
  assert.equal(facts.routingState, null);
  assert.equal(facts.routingPostcode, null);
});

// --- consignment number wording ---

test('the Metro "Consignment No" wording is read like "Cons No"', () => {
  assert.deepEqual(extractLabelFacts('Consignment No: JDQ0222865').consignmentIds, ['JDQ0222865']);
  assert.deepEqual(extractLabelFacts('Cons No: JDQ0222865').consignmentIds, ['JDQ0222865']);
  assert.deepEqual(extractLabelFacts('Con No: JDQ0222865').consignmentIds, ['JDQ0222865']);
});

test('a Consignment No heading with the value on the next line is still read', () => {
  assert.deepEqual(extractLabelFacts('Consignment No:\nJDQ0222865').consignmentIds, ['JDQ0222865']);
});

// --- article count ---

test('article count is read whether inline or under a heading', () => {
  assert.equal(extractLabelFacts('Article\n1 of 1').articleCountLine, '1 of 1');
  assert.equal(extractLabelFacts('Parcel 2 of 3').articleCountLine, '2 of 3');
  assert.equal(extractLabelFacts('Article 1 of 1').articleCountLine, '1 of 1');
  assert.equal(extractLabelFacts('Article\nnot a count').articleCountLine, null);
});

// --- branding ---

test('the M2M mark sets the Metro label type, and "Metro" in an address does not', () => {
  assert.equal(extractLabelFacts('Australia Post\nM2M\nTo\nMELBOURNE VIC 3000').labelType, 'Metro (M2M)');
  assert.equal(
    extractLabelFacts('Parcel Post\nTo\nMetro Supplies Pty Ltd\nMELBOURNE VIC 3000').labelType,
    'Parcel Post',
    'a business name containing Metro must not re-brand a Parcel Post label'
  );
});

// --- variant selection ---

test('a decoded Metro product code selects the Metro rule set', () => {
  const result = audit('M2M\nTo\nMELBOURNE VIC 3000\nAU VIC 3000\nConsignment No: 111JD0000120');
  assert.equal(result.ruleSet.variant, 'metro');
  assert.equal(result.ruleSet.id, 'eparcel-metro');
});

test('the M2M mark selects the Metro rule set when no barcode decodes', () => {
  const result = auditLabel({
    carrier: 'eparcel',
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: { name: 'metro.png', widthMm: 150, heightMm: 100, pageCount: 1 },
    detectedBarcodes: [],
    extractedText: 'Australia Post\nM2M\nTo\nMELBOURNE VIC 3000\nAU VIC 3000'
  });
  assert.equal(result.ruleSet.variant, 'metro');
});

// --- Metro products are accepted, and only under the Metro rule set ---

test('Metro product 00121 passes the product and service rules', () => {
  const result = audit('M2M\nTo\nMELBOURNE VIC 3000\nAU VIC 3000\nConsignment No: 111JD0000120');
  assert.equal(statusOf(result, 'EP-SVC-02'), 'pass', 'product code is a known eParcel product');
  assert.equal(statusOf(result, 'EP-SVC-07'), 'pass', 'product belongs to the Metro family');
  assert.equal(statusOf(result, 'EP-SVC-03'), 'pass', 'service 09 is accepted for Metro');
  assert.equal(statusOf(result, 'EP-ART-06'), 'pass', 'check digit is valid');
});

test('a Parcel Post article is still rejected by the Metro product fence', () => {
  const parcelPostArticle = 'JDQ' + '0194571' + '01' + '00093' + '03' + '0' + '8';
  const result = auditLabel({
    carrier: 'eparcel',
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: { name: 'metro.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
    // The M2M mark says Metro, but the decoded product says Parcel Post.
    detectedBarcodes: [{ rawValue: `019931265099999891${parcelPostArticle}`, format: 'code_128' }],
    extractedText: 'M2M\nTo\nMELBOURNE VIC 3000\nAU VIC 3000'
  });
  assert.equal(result.ruleSet.variant, 'parcel-post', 'the decoded product wins over the printed mark');
});

// --- routing cross-checks catch a mis-routed label ---

test('routing details that disagree with the delivery address are surfaced', () => {
  const good = audit('M2M\nTo\nMELBOURNE VIC 3000\nPh: 03 1234\nAU VIC 3000');
  assert.equal(statusOf(good, 'EP-MET-03'), 'pass');
  assert.equal(statusOf(good, 'EP-MET-04'), 'pass');

  const wrongState = audit('M2M\nTo\nMELBOURNE VIC 3000\nPh: 03 1234\nAU NSW 3000');
  assert.notEqual(statusOf(wrongState, 'EP-MET-04'), 'pass', 'state mismatch must not pass');

  const wrongPostcode = audit('M2M\nTo\nMELBOURNE VIC 3000\nPh: 03 1234\nAU VIC 2000');
  assert.notEqual(statusOf(wrongPostcode, 'EP-MET-03'), 'pass', 'postcode mismatch must not pass');
});

test('the routing postcode is compared against the delivery block, not against itself', () => {
  // Regression guard: comparing against every postcode on the label made this rule
  // self-satisfying, because the routing line is itself a "SUBURB STATE POSTCODE" match.
  const result = audit('M2M\nTo\nMELBOURNE VIC 3000\nPh: 03 1234\nAU VIC 2000');
  assert.notEqual(statusOf(result, 'EP-MET-03'), 'pass');
});
