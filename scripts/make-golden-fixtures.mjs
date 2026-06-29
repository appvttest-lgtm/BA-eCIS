// Seeds the golden-corpus fixtures under tests/fixtures/<quadrant>/*.input.json.
//
// Each quadrant directory corresponds to a (carrier, labelFormat) combination -
// i.e. the rule set that SHOULD be applied. The golden test (tests/golden.test.mjs)
// runs auditLabel on every *.input.json, snapshots the per-rule outcomes, and
// compares against a committed *.expected.json so any drift in which rules fire or
// how they resolve is caught immediately.
//
// These synthetic seeds prove the four standards route correctly today. Drop real
// decoded labels in as additional *.input.json files (same shape) and run
// `npm run golden:update` to capture their baseline - no code changes needed.
//
// Run: node scripts/make-golden-fixtures.mjs   (pass --force to overwrite existing seeds)

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '..', 'tests', 'fixtures');
const FORCE = process.argv.includes('--force');

/** Fixed-width pad used by the StarTrack QR payload (MOS v9 p16). */
const pad = (value, length) =>
  String(value || '')
    .padEnd(length, ' ')
    .slice(0, length);

// --- StarTrack conforming Express QR payload (suburb-first, 290 chars) ---
const stExpressQr = [
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

const ssccValue = '00393153450000000700';

const FIXTURES = [
  {
    quadrant: 'eparcel-standard',
    name: 'parcel-post-worked-example',
    fixture: {
      name: 'eParcel Parcel Post worked example (linear + DataMatrix agree)',
      noFail: true,
      mustFire: ['EP-LIN-01', 'EP-DM-01', 'EP-ART-06', 'EP-DM-05', 'EP-LIN-09', 'EP-SVC-03'],
      mustPass: ['EP-LIN-01', 'EP-DM-01', 'EP-ART-06', 'EP-LIN-09'],
      input: {
        carrier: 'eparcel',
        labelFamily: 'eparcel',
        labelFormat: 'standard',
        fileInfo: { name: 'sample.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
        detectedBarcodes: [
          { rawValue: '019931265099999891JDQ019457101000930308', format: 'code_128' },
          {
            rawValue: '019931265099999891JDQ019457101000930308|4202190|8008250609142233',
            format: 'data_matrix'
          }
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
      }
    }
  },
  {
    quadrant: 'eparcel-sscc',
    name: 'sscc-carried-by-linear',
    fixture: {
      // Focused invariant anchor: proves the SSCC carried by the linear barcode
      // satisfies EP-SS-01 and routes through the eParcel SSCC rule set. It is a thin
      // fixture (no DataMatrix), so it is not a clean overall pass - drop a real eParcel
      // SSCC label in here to get a full conforming baseline.
      name: 'eParcel SSCC carried by the linear barcode (focused invariant)',
      mustFire: ['EP-SS-01'],
      mustPass: ['EP-SS-01'],
      input: {
        carrier: 'eparcel',
        labelFamily: 'eparcel',
        labelFormat: 'sscc',
        fileInfo: { name: 'sscc-linear.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
        detectedBarcodes: [{ rawValue: ssccValue, format: 'code_128' }],
        extractedText: ['Parcel Post', 'CHULLORA NSW 2190'].join('\n')
      }
    }
  },
  {
    quadrant: 'eparcel-sscc',
    name: 'sscc-only-in-datamatrix-invalid',
    fixture: {
      name: 'eParcel SSCC present only in the Data Matrix - must NOT satisfy the linear SSCC check',
      // Invariant guard: a GS1 Data Matrix repeating AI (00) SSCC must never stand in
      // for the linear scan that the spec requires.
      expectFail: true,
      mustFire: ['EP-SS-01'],
      mustNotPass: ['EP-SS-01'],
      input: {
        carrier: 'eparcel',
        labelFamily: 'eparcel',
        labelFormat: 'sscc',
        fileInfo: { name: 'sscc-dm.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
        detectedBarcodes: [{ rawValue: `${ssccValue}|4202190|8008250609142233`, format: 'data_matrix' }],
        extractedText: ['Parcel Post', 'CHULLORA NSW 2190'].join('\n')
      }
    }
  },
  {
    quadrant: 'startrack-standard',
    name: 'express-full-label',
    fixture: {
      name: 'StarTrack Express full label (QR + freight + routing + ATL, all agree)',
      noFail: true,
      mustFire: ['ST-QR-01', 'ST-FRT-01', 'ST-RTE-01', 'ST-ATL-06', 'ST-X-01', 'ST-X-02', 'ST-PRD-01'],
      mustPass: ['ST-QR-01', 'ST-FRT-01', 'ST-RTE-01', 'ST-X-01', 'ST-X-02'],
      input: {
        carrier: 'startrack',
        labelFamily: 'startrack',
        labelFormat: 'standard',
        fileInfo: { name: 'st-sample.pdf', widthMm: 100, heightMm: 150, pageCount: 1 },
        detectedBarcodes: [
          { rawValue: stExpressQr, format: 'qrcode' },
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
      }
    }
  },
  {
    quadrant: 'startrack-sscc',
    name: 'issue16-nonconforming-qr',
    fixture: {
      name: 'StarTrack SSCC-retailer QR (issue #16) - decoded but non-conforming to MOS v9 layout',
      // This QR is SSCC-first with suburb/postcode at the end; it must report "decoded"
      // and expose each field's pass/fail rather than be hidden behind a single failure.
      expectFail: true,
      mustFire: ['ST-QR-01', 'ST-QR-F02', 'ST-QR-03'],
      mustPass: ['ST-QR-01'],
      mustNotPass: ['ST-QR-F02', 'ST-QR-03'],
      input: {
        carrier: 'startrack',
        labelFamily: 'startrack',
        labelFormat: 'sscc',
        fileInfo: { name: 'st-nonconforming-qr.pdf', widthMm: 100, heightMm: 150, pageCount: 1 },
        detectedBarcodes: [
          {
            rawValue:
              'LA00393278068436543128 F SMIGGLE-MARION SHOP 2062 WFIELD MARION 297 DIAGONAL ROAD OAKLANDS PARK 5046 4C0182 S000008 NNN',
            format: 'qrcode'
          },
          { rawValue: '00393278068436543128', format: 'code_128' }
        ],
        extractedText: ['STARTRACK', 'OAKLANDS PARK SA 5046'].join('\n')
      }
    }
  }
];

let written = 0;
let skipped = 0;
for (const { quadrant, name, fixture } of FIXTURES) {
  const dir = join(FIXTURE_ROOT, quadrant);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${name}.input.json`);
  if (existsSync(target) && !FORCE) {
    skipped += 1;
    continue;
  }
  writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
  written += 1;
  console.log(`wrote ${quadrant}/${name}.input.json`);
}
console.log(`Done. ${written} written, ${skipped} skipped (use --force to overwrite).`);
