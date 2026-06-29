// End-to-end smoke test for auditLabel: real parsers, real JSON rule sets.
// Run: node tests/smoke-audit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLabel } from '../src/auditEngine.js';

function expect(label, condition, detail = '') {
  test(label, () => assert.ok(condition, detail));
}
function find(audit, id) {
  return (audit.validations || []).find(r => r.id === id || String(r.id).startsWith(`${id}_`));
}

// --- eParcel Parcel Post end-to-end (spec worked example) ---
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

// --- StarTrack Express end-to-end ---
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
    { rawValue: 'ABCD12345678EXP00001', format: 'code_128', barCount: 61 },
    { rawValue: 'EXP2190SYD', format: 'code_128' },
    { rawValue: 'C239196552', format: 'code_128' }
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
  'ST-RTE-09 routing compression structure',
  find(startrackAudit, 'ST-RTE-09')?.status === 'pass',
  find(startrackAudit, 'ST-RTE-09')?.message
);
expect(
  'ST-ATL-06 ATL compression structure',
  find(startrackAudit, 'ST-ATL-06')?.status === 'pass',
  find(startrackAudit, 'ST-ATL-06')?.message
);
expect(
  'ST-FRT-09 bar count rides from detected barcode to rule result',
  find(startrackAudit, 'ST-FRT-09')?.status === 'pass',
  find(startrackAudit, 'ST-FRT-09')?.message
);
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

// --- A decoded-but-truncated StarTrack QR still yields the field-by-field breakdown ---
// The strict fixed-width gate used to suppress every per-field row (and report the QR as
// "not decoded") when the payload was short. A truncated payload that still carries the
// freight item / connote shape must be recognised so the breakdown renders, ST-QR-01
// reports "decoded", and ST-QR-03 flags the length non-conformance.
const truncatedQr = qrPayload.slice(0, 200);
const truncatedAudit = auditLabel({
  carrier: 'startrack',
  labelFamily: 'startrack',
  labelFormat: 'standard',
  fileInfo: { name: 'st-truncated.pdf', widthMm: 100, heightMm: 150, pageCount: 1 },
  detectedBarcodes: [{ rawValue: truncatedQr, format: 'qrcode' }],
  extractedText: ['STARTRACK', 'EXP'].join('\n')
});
expect('truncated QR still reports decoded', find(truncatedAudit, 'ST-QR-01')?.status === 'pass');
expect('truncated QR fails the fixed-width length check', find(truncatedAudit, 'ST-QR-03')?.status === 'fail');
expect('truncated QR still produces a per-field row', find(truncatedAudit, 'ST-QR-F03')?.status === 'pass');
// A non-StarTrack QR (e.g. a marketing URL) must not be force-parsed into field rows.
const urlQrAudit = auditLabel({
  carrier: 'startrack',
  labelFamily: 'startrack',
  labelFormat: 'standard',
  fileInfo: { name: 'st-url-qr.pdf', widthMm: 100, heightMm: 150, pageCount: 1 },
  detectedBarcodes: [{ rawValue: 'https://auspost.com.au/track/ABC123', format: 'qrcode' }],
  extractedText: ['STARTRACK', 'EXP'].join('\n')
});
expect('non-StarTrack QR produces no field rows', !find(urlQrAudit, 'ST-QR-F03'));

// --- A decoded but non-conforming QR (issue #16) is reported field-by-field, not "not decoded" ---
// SSCC-retailer QR with a different field order (SSCC first, suburb/postcode at the end). It does
// not match the MOS v9 suburb-first layout, so the report must say "decoded" and expose each field's
// pass/fail against the spec positions, rather than hiding it behind a single "not decoded" failure.
const nonConformingQr =
  'LA00393278068436543128 F SMIGGLE-MARION SHOP 2062 WFIELD MARION 297 DIAGONAL ROAD OAKLANDS PARK 5046 4C0182 S000008 NNN';
const nonConformingAudit = auditLabel({
  carrier: 'startrack',
  labelFamily: 'startrack',
  labelFormat: 'sscc',
  fileInfo: { name: 'st-nonconforming-qr.pdf', widthMm: 100, heightMm: 150, pageCount: 1 },
  detectedBarcodes: [
    { rawValue: nonConformingQr, format: 'qrcode' },
    { rawValue: '00393278068436543128', format: 'code_128' }
  ],
  extractedText: ['STARTRACK', 'OAKLANDS PARK SA 5046'].join('\n')
});
expect('non-conforming QR reports decoded (not "not decoded")', find(nonConformingAudit, 'ST-QR-01')?.status === 'pass');
expect('non-conforming QR exposes per-field rows', !!find(nonConformingAudit, 'ST-QR-F02'));
expect('non-conforming QR postcode position fails', find(nonConformingAudit, 'ST-QR-F02')?.status === 'fail');
expect('non-conforming QR length flagged', find(nonConformingAudit, 'ST-QR-03')?.status === 'fail');

// --- Heading-aware weight/cube extraction survives label-text variation ---
// "cube" vs "cubic", with or without a colon or m3 unit, and value on the next line.
function stFacts(extractedText) {
  return auditLabel({
    carrier: 'startrack',
    labelFamily: 'startrack',
    labelFormat: 'standard',
    fileInfo: { name: 'st-text.pdf', widthMm: 100, heightMm: 150, pageCount: 1 },
    detectedBarcodes: [],
    extractedText
  }).labelFacts;
}
expect('cube parsed from "CUBE: 0.015 m3"', stFacts('STARTRACK\nCUBE: 0.015 m3').cube === '0.015');
expect('cube parsed from "CUBE 0.02" (no unit)', stFacts('STARTRACK\nCUBE 0.02').cube === '0.02');
expect('cube parsed from "CUBIC VOLUME 0.03 m3"', stFacts('STARTRACK\nCUBIC VOLUME 0.03 m3').cube === '0.03');
expect('cube parsed from heading then next line', stFacts('STARTRACK\nCUBE\n0.04 m3').cube === '0.04');
expect('weight parsed from "Dead Weight 6kg"', stFacts('STARTRACK\nDead Weight 6kg').weightKg === '6');

// --- SSCC is proven by the linear scan, never borrowed from the Data Matrix ---
// A GS1 Data Matrix legitimately repeats AI (00) SSCC, but the SSCC barcode check
// must reflect the linear scan being to spec - the DM value must not stand in for it.
const ssccValue = '00393153450000000700';
const ssccInDmOnly = auditLabel({
  carrier: 'eparcel',
  labelFamily: 'eparcel',
  labelFormat: 'sscc',
  fileInfo: { name: 'sscc-dm.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
  detectedBarcodes: [{ rawValue: `${ssccValue}|4202190|8008250609142233`, format: 'data_matrix' }],
  extractedText: ['Parcel Post', 'CHULLORA NSW 2190'].join('\n')
});
expect(
  'EP-SS-01 does not pass when the SSCC is only in the Data Matrix',
  find(ssccInDmOnly, 'EP-SS-01')?.status !== 'pass',
  find(ssccInDmOnly, 'EP-SS-01')?.message
);

const ssccInLinear = auditLabel({
  carrier: 'eparcel',
  labelFamily: 'eparcel',
  labelFormat: 'sscc',
  fileInfo: { name: 'sscc-linear.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
  detectedBarcodes: [{ rawValue: ssccValue, format: 'code_128' }],
  extractedText: ['Parcel Post', 'CHULLORA NSW 2190'].join('\n')
});
expect(
  'EP-SS-01 passes when the SSCC is carried by the linear barcode',
  find(ssccInLinear, 'EP-SS-01')?.status === 'pass',
  find(ssccInLinear, 'EP-SS-01')?.message
);
