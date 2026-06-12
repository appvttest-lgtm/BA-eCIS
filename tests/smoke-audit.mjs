// End-to-end smoke test for auditLabel: real parsers, real JSON rule sets.
// Run: node tests/smoke-audit.mjs
import { auditLabel } from '../src/auditEngine.js';

let failures = 0;
function expect(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function find(audit, id) {
  return (audit.validations || []).find(r => r.id === id || String(r.id).startsWith(`${id}_`));
}

console.log('eParcel Parcel Post end-to-end (spec worked example)');
const linear = '019931265099999891JDQ019457101000930308';
const dm = '019931265099999891JDQ019457101000930308|4202190|8008250609142233';
const eparcelAudit = auditLabel({
  carrier: 'eparcel',
  labelFamily: 'eparcel',
  labelFormat: 'standard',
  fileInfo: { name: 'sample.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
  detectedBarcodes: [
    { rawValue: linear, format: 'code_128' },
    { rawValue: dm, format: 'data_matrix' }
  ],
  extractedText: [
    'Parcel Post',
    'TO:',
    'MR C RECEIVER',
    'Unit 14',
    '1 Test Street',
    'CHULLORA NSW 2190',
    'FROM: MR C SENDER',
    '1 Jedda Road',
    'PRESTONS NSW 2170',
    'Cons No: JDQ0194571',
    'AP Article ID: JDQ0 1945 7101 0009 3030 8',
    'Aviation Security and Dangerous Goods Declaration',
    'The sender acknowledges that this article may be carried by air',
    '0.5kg',
    '0609'
  ].join('\n')
});
expect(
  'variant resolves to parcel-post',
  eparcelAudit.ruleSet?.variant === 'parcel-post',
  `got ${eparcelAudit.ruleSet?.variant}`
);
expect('EP-LIN-01 linear decoded', find(eparcelAudit, 'EP-LIN-01')?.status === 'pass');
expect('EP-DM-01 datamatrix decoded', find(eparcelAudit, 'EP-DM-01')?.status === 'pass');
expect(
  'EP-LIN-07 GTIN prefix',
  find(eparcelAudit, 'EP-LIN-07')?.status === 'pass',
  find(eparcelAudit, 'EP-LIN-07')?.message
);
expect(
  'EP-ART-06 check digit',
  find(eparcelAudit, 'EP-ART-06')?.status === 'pass',
  find(eparcelAudit, 'EP-ART-06')?.message
);
expect('EP-DM-05 AI 420 postcode', find(eparcelAudit, 'EP-DM-05')?.status === 'pass');
expect(
  'EP-TO-08 postcode matches TO address',
  find(eparcelAudit, 'EP-TO-08')?.status === 'pass',
  find(eparcelAudit, 'EP-TO-08')?.message
);
expect('EP-DM-07 AI 8008 datetime', find(eparcelAudit, 'EP-DM-07')?.status === 'pass');
expect(
  'EP-LIN-09 linear/DM agreement',
  find(eparcelAudit, 'EP-LIN-09')?.status === 'pass',
  find(eparcelAudit, 'EP-LIN-09')?.message
);
expect(
  'EP-SVC-03 service/product matrix',
  find(eparcelAudit, 'EP-SVC-03')?.status === 'pass',
  find(eparcelAudit, 'EP-SVC-03')?.message
);
expect('EP-SVC-07 product allowed for parcel post', find(eparcelAudit, 'EP-SVC-07')?.status === 'pass');
expect(
  'EP-TO-06 suburb line capitalised',
  find(eparcelAudit, 'EP-TO-06')?.status === 'pass',
  find(eparcelAudit, 'EP-TO-06')?.message
);
expect(
  'rule metadata attached for report UI',
  Boolean(find(eparcelAudit, 'EP-DM-05')?.rule?.logic && find(eparcelAudit, 'EP-DM-05')?.input)
);
const epFails = (eparcelAudit.validations || []).filter(r => r.status === 'fail');
expect('no failures on conforming label', epFails.length === 0, epFails.map(r => `${r.id}: ${r.message}`).join(' | '));

console.log('StarTrack Express end-to-end');
const pad = (value, length) =>
  String(value || '')
    .padEnd(length, ' ')
    .slice(0, length);
const qrPayload = [
  pad('CHULLORA', 30),
  pad('2190', 4),
  pad('ABCD12345678', 12),
  pad('ABCD12345678EXP00001', 20),
  pad('EXP', 3),
  pad('', 8),
  pad('12345678', 8),
  pad('1', 4),
  pad('5', 5),
  pad('15', 5),
  pad('20260610', 8),
  pad('CAROL RECEIVER', 40),
  pad('', 40),
  pad('CTN', 3),
  pad('SYD', 4),
  pad('8 TEST CLOSE', 40),
  pad('', 40),
  pad('', 14),
  'N',
  'N',
  pad('', 12),
  pad('', 12),
  pad('', 10),
  pad('', 10)
].join('');
const startrackAudit = auditLabel({
  carrier: 'startrack',
  labelFamily: 'startrack',
  labelFormat: 'standard',
  fileInfo: { name: 'st-sample.pdf', widthMm: 100, heightMm: 150, pageCount: 1 },
  detectedBarcodes: [
    { rawValue: qrPayload, format: 'qrcode' },
    { rawValue: 'ABCD12345678EXP00001', format: 'code_128' },
    { rawValue: 'EXP2190SYD', format: 'code_128' }
  ],
  extractedText: [
    'STARTRACK',
    'EXP',
    'CONNOTE: ABCD12345678',
    'CHULLORA NSW 2190',
    'ITEM 1 OF 1',
    '5 kg',
    '0.015 m3'
  ].join('\n')
});
expect(
  'variant resolves to express',
  startrackAudit.ruleSet?.variant === 'express',
  `got ${startrackAudit.ruleSet?.variant}`
);
expect('ST-QR-01 QR decoded', find(startrackAudit, 'ST-QR-01')?.status === 'pass');
expect('ST-FRT-01 freight barcode decoded', find(startrackAudit, 'ST-FRT-01')?.status === 'pass');
expect('ST-RTE-01 routing barcode decoded', find(startrackAudit, 'ST-RTE-01')?.status === 'pass');
expect(
  'ST-RTE-03 routing/product compatibility',
  find(startrackAudit, 'ST-RTE-03')?.status === 'pass',
  find(startrackAudit, 'ST-RTE-03')?.message
);
expect(
  'ST-RTE-04 routing postcode matches QR',
  find(startrackAudit, 'ST-RTE-04')?.status === 'pass',
  find(startrackAudit, 'ST-RTE-04')?.message
);
expect(
  'ST-X-01 QR connote matches freight',
  find(startrackAudit, 'ST-X-01')?.status === 'pass',
  find(startrackAudit, 'ST-X-01')?.message
);
expect(
  'ST-X-02 QR freight item matches barcode',
  find(startrackAudit, 'ST-X-02')?.status === 'pass',
  find(startrackAudit, 'ST-X-02')?.message
);
expect('ST-QR-F11 despatch date valid', find(startrackAudit, 'ST-QR-F11')?.status === 'pass');
expect('ST-QR-F24 skipped for despatch movement', !find(startrackAudit, 'ST-QR-F24'));
expect('ST-PRD-01 product allowed for express', find(startrackAudit, 'ST-PRD-01')?.status === 'pass');
const stFails = (startrackAudit.validations || []).filter(r => r.status === 'fail');
expect('no failures on conforming label', stFails.length === 0, stFails.map(r => `${r.id}: ${r.message}`).join(' | '));

if (failures) {
  console.error(`\n${failures} end-to-end check(s) failed.`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed.');
