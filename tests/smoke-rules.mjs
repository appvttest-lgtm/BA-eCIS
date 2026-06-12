// Node smoke test for the declarative rule engine and the /rules JSON files.
// Run: node tests/smoke-rules.mjs
// Custom functions that live in auditEngine.js are stubbed here; this test
// exercises JSON validity, base/variant merging, path resolution and the
// declarative assert operators.
import { readFileSync } from 'node:fs';
import { evaluateRuleSet, mergeRuleSets, registerRuleFunction } from '../src/ruleEngine.js';

const load = p => JSON.parse(readFileSync(new URL(`../rules/${p}`, import.meta.url), 'utf8'));

for (const name of ['pageSizeWithin', 'inPathList', 'eparcelCheckDigit', 'serviceProductCompatible', 'linearDmAgreement', 'routeProductMatch', 'qrMandatoryFields', 'startrackUnitPermitted', 'requiredDecode']) {
  registerRuleFunction(name, () => ({ pass: true, message: `${name} stubbed pass` }));
}

let failures = 0;
function expect(label, condition) {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}
function byId(results, id) {
  return results.filter(r => r.id === id || r.id.startsWith(`${id}_`));
}

const epExpress = mergeRuleSets(load('eparcel/base.json'), load('eparcel/express-post.json'));
const epReturns = mergeRuleSets(load('eparcel/base.json'), load('eparcel/returns.json'));
const stBase = load('startrack/base.json');
const stSscc = mergeRuleSets(stBase, load('startrack/sscc.json'));

console.log('eParcel express-post rule set');
const goodArticle = {
  type: 'eparcel-standard', mlid: 'JDQ', consignmentSuffix: '0194571', consignmentId: 'JDQ0194571',
  articleCount: '01', productCode: '00096', serviceCode: '03', postagePaidIndicator: '0',
  articleId: 'JDQ019457101000960308', checkDigit: '8', withoutCheckDigit: 'JDQ01945710100096030'
};
const epContext = {
  page: { widthMm: 150, heightMm: 100, pageCount: 1 },
  text: {
    labelType: 'Express Post',
    toBlock: ['TO:', 'MR C RECEIVER', 'Unit 14', '1 Test Street', 'CHULLORA NSW 2190'],
    toLastLine: 'CHULLORA NSW 2190',
    fromBlock: ['FROM: MR C SENDER', '1 Jedda Road', 'MELBOURNE VIC 3001'],
    fromLastLine: 'MELBOURNE VIC 3001',
    postcodes4: ['2190'],
    postcodeLines: ['CHULLORA NSW 2190'],
    labelDates: ['0609'],
    dgPresent: true,
    dgBlock: 'Aviation Security and Dangerous Goods Declaration',
    consignmentIds: ['JDQ0194571'],
    articleIds: ['JDQ019457101000960308']
  },
  barcodes: {
    linearPresent: true,
    dataMatrixPresent: true,
    gs1: [{ raw: 'x', compact: '0199312650999998 91JDQ...', prefix16: '0199312650999998', hasAi01: true, hasAi91: true, hasAusPostGtin: true }],
    datamatrix: [{ raw: 'x', postcode: '2190', hasAi92: false, dpid: null, dateTime: '250609142233', invalidLiteralSeparators: false }],
    sscc: { valid: [], invalid: [] }
  },
  articles: [goodArticle],
  derived: { linearArticleIds: ['JDQ019457101000960308'], dmArticleIds: ['JDQ019457101000960308'], invalidArticleReasons: '', invalidSsccReasons: '' },
  selected: { carrier: 'eparcel', format: 'standard' }
};
const epResults = evaluateRuleSet(epExpress, epContext);
expect('produces results', epResults.length > 15);
expect('no failures on a conforming label', epResults.every(r => r.status !== 'fail'));
expect('EP-TO-06 passes on capitalised line', byId(epResults, 'EP-TO-06')[0]?.status === 'pass');
expect('EP-DM-07 passes on valid datetime', byId(epResults, 'EP-DM-07')[0]?.status === 'pass');
expect('EP-SVC-07 allows 00096 for express', byId(epResults, 'EP-SVC-07')[0]?.status === 'pass');
expect('results carry rule metadata', Boolean(epResults[0]?.rule?.id && epResults[0]?.rule?.logic));
expect('results carry input metadata', 'value' in (epResults[0]?.input || {}));

console.log('eParcel failure modes');
const badContext = JSON.parse(JSON.stringify(epContext));
badContext.text.toLastLine = 'Chullora NSW 2190';
badContext.barcodes.datamatrix[0].dateTime = '250609 14223';
badContext.barcodes.datamatrix[0].postcode = '219';
badContext.articles[0].serviceCode = '99';
const badResults = evaluateRuleSet(epExpress, badContext);
expect('EP-TO-06 fails on mixed-case suburb', byId(badResults, 'EP-TO-06')[0]?.status === 'fail');
expect('EP-DM-07 fails on space in datetime', byId(badResults, 'EP-DM-07')[0]?.status === 'fail');
expect('EP-DM-05 fails on 3-digit postcode', byId(badResults, 'EP-DM-05')[0]?.status === 'fail');
expect('EP-SVC-01 fails on unknown service', byId(badResults, 'EP-SVC-01')[0]?.status === 'fail');

console.log('eParcel returns rule set');
const retContext = JSON.parse(JSON.stringify(epContext));
retContext.articles[0].productCode = '00065';
retContext.articles[0].serviceCode = '45';
retContext.articles[0].articleCount = '02';
const retResults = evaluateRuleSet(epReturns, retContext);
expect('EP-RET-01 fails on service 45', byId(retResults, 'EP-RET-01')[0]?.status === 'fail');
expect('EP-RET-02 fails on article count 02', byId(retResults, 'EP-RET-02')[0]?.status === 'fail');
expect('EP-RET-03 passes with no SSCC', byId(retResults, 'EP-RET-03')[0]?.status === 'pass');

console.log('StarTrack base rule set');
const qrFields = {
  receiverSuburb: 'CHULLORA', receiverPostcode: '2190', connoteNumber: 'ABCD12345678',
  freightItemNumber: 'ABCD12345678EXP00001', productCode: 'EXP', payerAccount: '', senderAccount: '12345678',
  consignmentQuantity: '1', consignmentWeight: '5', consignmentCube: '15', despatchDate: '20260610',
  receiverName1: 'CAROL RECEIVER', receiverName2: '', unitType: 'CTN', destinationDepot: 'SYD',
  receiverAddress1: '8 TEST CLOSE', receiverAddress2: '', receiverPhone: '', dangerousGoodsIndicator: 'N',
  movementTypeIndicator: 'C', notBeforeDate: '202606111200', notAfterDate: '202606101200', atlNumber: '', raNumber: ''
};
const stContext = {
  page: { widthMm: 100, heightMm: 150, pageCount: 1 },
  text: { lines: [], hasStarTrackHeader: true, labelCode: 'EXP', consignmentIds: ['ABCD12345678'], toBlock: [], fromBlock: ['FROM X'], postcodeLines: ['CHULLORA NSW 2190'], weightKg: '5', cube: '0.015', returnTransferIndicator: '' },
  barcodes: {
    qrPresent: true, freightPresent: true, routingPresent: true,
    qr: [{ fields: qrFields, productCode: 'EXP', raw: 'qr' }],
    freight: [{ freightItemId: 'ABCD12345678EXP00001', despatchId: 'ABCD', connoteNumber: 'ABCD12345678', consignmentSequence: '12345678', productCode: 'EXP', itemNumber: '00001' }],
    routing: [{ raw: 'EXP2190SYD', labelCode: 'EXP', postcode: '2190', depotOrPort: 'SYD' }],
    atl: [],
    sscc: { valid: [], invalid: [] }
  },
  derived: { qrPostcodes: ['2190'], freightConnotes: ['ABCD12345678'], freightIds: ['ABCD12345678EXP00001'], primaryProductCode: 'EXP', expectedAtlNumbers: [], atlExpected: false, invalidSsccReasons: '', receiverEvidence: ['CHULLORA NSW 2190'] },
  selected: { carrier: 'startrack', format: 'standard' }
};
const stResults = evaluateRuleSet(stBase, stContext);
expect('ST-QR-F24 fails when RA blank on movement C', byId(stResults, 'ST-QR-F24')[0]?.status === 'fail');
expect('ST-QR-F21 fails when not-before exceeds not-after', byId(stResults, 'ST-QR-F21')[0]?.status === 'fail');
expect('ST-HDR-06 flags missing return indicator', ['fail', 'manual_review'].includes(byId(stResults, 'ST-HDR-06')[0]?.status));
expect('ST-QR-F11 passes on valid despatch date', byId(stResults, 'ST-QR-F11')[0]?.status === 'pass');
expect('ST-FRT-02B passes on 8-digit sequence', byId(stResults, 'ST-FRT-02B')[0]?.status === 'pass');
expect('ST-FRT-04 compression structure passes', byId(stResults, 'ST-FRT-04')[0]?.status === 'pass');

console.log('StarTrack SSCC variant');
const ssccContext = JSON.parse(JSON.stringify(stContext));
ssccContext.selected.format = 'sscc';
ssccContext.barcodes.freight = [];
ssccContext.barcodes.freightPresent = false;
ssccContext.barcodes.sscc = { valid: [{ sscc: '393153450000000700' }], invalid: [] };
const ssccResults = evaluateRuleSet(stSscc, ssccContext);
expect('ST-FRT-01 disabled in SSCC variant', byId(ssccResults, 'ST-FRT-01').length === 0);
expect('ST-SSC-01 passes with valid SSCC', byId(ssccResults, 'ST-SSC-01')[0]?.status === 'pass');
expect('ST-SSC-06 fails on movement C', byId(ssccResults, 'ST-SSC-06')[0]?.status === 'fail');

if (failures) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
