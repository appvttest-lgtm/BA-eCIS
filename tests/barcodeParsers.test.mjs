// Parser regression tests with hand-verified vectors. The article check digit below was
// computed by hand with the EAN/UCC-13 method (alpha -> last digit of ASCII code):
// "ABC" + "1234567" + "01" + "00093" + "03" + "0" converts to 56712345670100093030,
// weighted sum 126, check digit (10 - 126 % 10) % 10 = 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeArticleCandidate,
  calculateEparcelCheckDigit,
  dataMatrixComplianceEvidence,
  normalizeBarcode,
  parseEparcelBarcode,
  parseGs1DataMatrix,
  parseSsccBarcode,
  parseStarTrackAtlBarcode,
  parseStarTrackFreightItemBarcode,
  parseStarTrackQrBarcode,
  parseStarTrackRoutingBarcode,
  STARTRACK_QR_FIELDS
} from '../src/auditEngine.js';

const GS = String.fromCharCode(29); // GS1 FNC1 group separator as transmitted by scanners
const VALID_ARTICLE = 'ABC123456701000930304';
const AUSPOST_GTIN_PREFIX = '0199312650999998';

test('calculateEparcelCheckDigit matches the hand-computed vector', () => {
  const result = calculateEparcelCheckDigit('ABC12345670100093030');
  assert.equal(result.validInput, true);
  assert.equal(result.converted, '56712345670100093030');
  assert.equal(result.weightedSum, 126);
  assert.equal(result.checkDigit, '4');
  assert.match(calculateEparcelCheckDigit('AB!').steps, /invalid characters/);
});

test('parseEparcelBarcode splits a GS1-128 article barcode into its fields', () => {
  const parsed = parseEparcelBarcode(`${AUSPOST_GTIN_PREFIX}91${VALID_ARTICLE}`);
  assert.equal(parsed.hasAi01, true);
  assert.equal(parsed.hasAusPostGtin, true);
  assert.equal(parsed.hasAi91, true);
  const article = parsed.article;
  assert.equal(article.type, 'eparcel-standard');
  assert.equal(article.mlid, 'ABC');
  assert.equal(article.consignmentSuffix, '1234567');
  assert.equal(article.consignmentId, 'ABC1234567');
  assert.equal(article.articleCount, '01');
  assert.equal(article.productCode, '00093');
  assert.equal(article.serviceCode, '03');
  assert.equal(article.postagePaidIndicator, '0');
  assert.equal(article.checkDigit, '4');
  assert.equal(article.withoutCheckDigit, 'ABC12345670100093030');
});

test('article structure parse accepts a wrong check digit; the check-digit rule catches it', () => {
  const analysis = analyzeArticleCandidate('ABC123456701000930305');
  assert.equal(analysis.valid, true, 'structure is valid even when the check digit is wrong');
  assert.equal(analysis.article.checkDigit, '5');
  assert.notEqual(calculateEparcelCheckDigit(analysis.article.withoutCheckDigit).checkDigit, '5');
});

test('analyzeArticleCandidate explains rejected candidates', () => {
  assert.match(analyzeArticleCandidate('ABC123').reason, /21 characters/);
  assert.match(analyzeArticleCandidate('001234567890').reason, /20 digits/);
  assert.equal(analyzeArticleCandidate(''), null);
});

test('parseSsccBarcode validates the GS1 mod-10 check digit', () => {
  const valid = parseSsccBarcode('00000000000000000017');
  assert.equal(valid.valid, true);
  assert.equal(valid.sscc, '000000000000000017');
  assert.equal(valid.expectedCheckDigit, '7');

  const invalid = parseSsccBarcode('00000000000000000018');
  assert.equal(invalid.valid, false);
  assert.match(invalid.reason, /Expected 7, got 8/);

  assert.match(parseSsccBarcode('00000000000000000017EXTRA').reason, /nothing else/);
  assert.match(parseSsccBarcode('12345').reason, /No AI 00/);
});

test('parseGs1DataMatrix extracts AIs when separators are present and correct', () => {
  const parsed = parseGs1DataMatrix(`]d2${AUSPOST_GTIN_PREFIX}91${VALID_ARTICLE}${GS}4202000${GS}8008250826123045`);
  assert.equal(parsed.postcode, '2000');
  assert.equal(parsed.dateTime, '250826123045');
  assert.equal(parsed.hasAi92, false);
  assert.deepEqual(parsed.aiSeparatorFallbacks, []);
  assert.equal(parsed.emptySeparatorSegments, 0);
  assert.equal(parsed.invalidLiteralSeparators, false);
  assert.equal(parsed.article.articleId, VALID_ARTICLE);
});

test('parseGs1DataMatrix counts doubled separators (AI 92 removed without its FNC1)', () => {
  const parsed = parseGs1DataMatrix(
    `]d2${AUSPOST_GTIN_PREFIX}91${VALID_ARTICLE}${GS}${GS}4202000${GS}8008250826123045`
  );
  assert.equal(parsed.emptySeparatorSegments, 1);
});

test('parseGs1DataMatrix flags literal separator text instead of control characters', () => {
  const parsed = parseGs1DataMatrix(`]d2${AUSPOST_GTIN_PREFIX}91${VALID_ARTICLE}$4202000${GS}8008250826123045`);
  assert.equal(parsed.invalidLiteralSeparators, true);
  assert.equal(parsed.literalSeparatorMarker, '$');
});

test('parseGs1DataMatrix records AI values recovered without their separators', () => {
  const parsed = parseGs1DataMatrix(`${AUSPOST_GTIN_PREFIX}91${VALID_ARTICLE}42020008008250826123045`);
  assert.equal(parsed.postcode, '2000');
  assert.equal(parsed.dateTime, '250826123045');
  assert.deepEqual(
    parsed.aiSeparatorFallbacks,
    ['420', '8008'],
    'fallback recovery is evidence the separators are missing'
  );
});

test('dataMatrixComplianceEvidence reads the ISO/IEC 15424 symbology identifier', () => {
  assert.deepEqual(
    (({ fnc1FirstPosition, ecc200 }) => ({ fnc1FirstPosition, ecc200 }))(
      dataMatrixComplianceEvidence({ symbologyIdentifier: ']d2' })
    ),
    { fnc1FirstPosition: true, ecc200: true }
  );
  const plainDataMatrix = dataMatrixComplianceEvidence({ symbologyIdentifier: ']d1' });
  assert.equal(plainDataMatrix.fnc1FirstPosition, false);
  assert.equal(plainDataMatrix.ecc200, true);
  assert.equal(dataMatrixComplianceEvidence({ symbologyIdentifier: ']d0' }).ecc200, false);
  const zxingOnly = dataMatrixComplianceEvidence({ decoderSource: 'zxing-wasm' });
  assert.equal(zxingOnly.ecc200, true, 'a ZXing decode proves ECC 200');
  assert.equal(zxingOnly.fnc1FirstPosition, null, 'FNC1-first stays unknown without an identifier');
});

test('parseStarTrackFreightItemBarcode splits the 20-character freight item id', () => {
  const parsed = parseStarTrackFreightItemBarcode('ABCD12345678EXP00001');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.despatchId, 'ABCD');
  assert.equal(parsed.connoteNumber, 'ABCD12345678');
  assert.equal(parsed.productCode, 'EXP');
  assert.equal(parsed.expectedLabelCode, 'EXP');
  assert.equal(parsed.itemNumber, '00001');
  assert.equal(parseStarTrackFreightItemBarcode('TOO-SHORT').valid, false);
});

test('parseStarTrackRoutingBarcode handles both routing forms and rejects unknown label codes', () => {
  const routing = parseStarTrackRoutingBarcode('EXP2000SYD');
  assert.equal(routing.valid, true);
  assert.equal(routing.labelCode, 'EXP');
  assert.equal(routing.postcode, '2000');
  assert.equal(routing.depotOrPort, 'SYD');

  const gs1Routing = parseStarTrackRoutingBarcode('4210362000403EXP');
  assert.equal(gs1Routing.valid, true);
  assert.equal(gs1Routing.type, 'gs1-421-routing');
  assert.equal(gs1Routing.postcode, '2000');
  assert.equal(gs1Routing.labelCode, 'EXP');

  assert.match(parseStarTrackRoutingBarcode('ZZZ2000SYD').reason, /Unknown StarTrack routing label code/);
});

test('parseStarTrackAtlBarcode accepts C + 9 digits only', () => {
  const parsed = parseStarTrackAtlBarcode('C123456789');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.counter, '123456789');
  assert.equal(parseStarTrackAtlBarcode('X123456789').valid, false);
});

test('parseStarTrackQrBarcode round-trips fields through the fixed-width layout', () => {
  const totalLength = Math.max(...STARTRACK_QR_FIELDS.map(f => f.pos + f.len - 1));
  const payload = new Array(totalLength).fill(' ');
  const setField = (key, value) => {
    const field = STARTRACK_QR_FIELDS.find(f => f.key === key);
    for (let i = 0; i < value.length && i < field.len; i += 1) payload[field.pos - 1 + i] = value[i];
  };
  setField('receiverSuburb', 'SYDNEY');
  setField('receiverPostcode', '2000');
  setField('connoteNumber', 'ABCD12345678');
  setField('freightItemNumber', 'ABCD12345678EXP00001');
  setField('productCode', 'EXP');

  const parsed = parseStarTrackQrBarcode(payload.join(''));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.fields.receiverSuburb, 'SYDNEY');
  assert.equal(parsed.fields.receiverPostcode, '2000');
  assert.equal(parsed.fields.freightItemNumber, 'ABCD12345678EXP00001');
  assert.equal(parsed.productCode, 'EXP');
  assert.equal(parsed.length, totalLength);

  assert.equal(
    parseStarTrackQrBarcode('https://example.com').valid,
    false,
    'unrelated QR payloads are not exploded into fields'
  );
});

test('normalizeBarcode strips symbology prefixes, spaces and bracketed AIs', () => {
  assert.equal(normalizeBarcode(']C1(01)99312650999998(91)ABC 123'), '019931265099999891ABC123');
  assert.equal(normalizeBarcode(`00123${GS}456`), '00123|456');
  assert.equal(normalizeBarcode('  \t '), '');
});
