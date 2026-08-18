// Scan-pipeline pure functions.
//
// These three functions decide what the rest of the audit ever gets to see, and none of
// them had a test: `textContentItemsToLines` turns PDF text items into the lines every
// visible-text rule matches against, `buildCategorizedScanTargets` decides which regions
// of the label are scanned for which symbology, and `mapBarcodeToPage` decides whether a
// decoded symbol is allowed to claim a page location. They are pure (no DOM, no canvas
// pixels), so they can be tested directly here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textContentItemsToLines, buildCategorizedScanTargets, mapBarcodeToPage } from '../src/scanner/scanPlan.js';

// cropCanvas() builds a real canvas element, so the scan-plan tests need a minimal
// document stub. Nothing here draws pixels — only the plan geometry is under test.
const stubCanvas = (width = 0, height = 0) => ({ width, height, getContext: () => ({ drawImage() {} }) });
globalThis.document = { createElement: () => stubCanvas() };

// A pdf.js text item: transform is [a, b, c, d, x, y].
const item = (str, x, y, height = 10) => ({ str, transform: [height, 0, 0, height, x, y] });

// --- textContentItemsToLines -----------------------------------------------

test('items sharing a baseline are grouped into one line, ordered left to right', () => {
  // The Metro routing block is three separate text items on one baseline.
  const lines = textContentItemsToLines([item('3000', 300, 500), item('AU', 100, 500), item('VIC', 200, 500)]);
  // A wide horizontal gap becomes a 3-space marker, which is why every downstream
  // pattern that spans columns has to match on \s+ rather than a single space.
  assert.deepEqual(lines, ['AU   VIC   3000']);
});

test('items on different baselines stay on separate lines, top down', () => {
  const lines = textContentItemsToLines([item('bottom', 10, 100), item('top', 10, 500), item('middle', 10, 300)]);
  assert.deepEqual(lines, ['top', 'middle', 'bottom']);
});

test('a small baseline jitter still groups as one line', () => {
  // Real PDFs rarely place a row at exactly one y; the grouping tolerance covers that.
  const lines = textContentItemsToLines([item('MELBOURNE', 10, 400), item('VIC', 120, 402), item('3000', 200, 399)]);
  assert.deepEqual(lines, ['MELBOURNE   VIC   3000']);
});

test('empty and whitespace-only items are dropped', () => {
  const lines = textContentItemsToLines([item('', 10, 100), item('   ', 50, 100), item('kept', 90, 100)]);
  assert.deepEqual(lines, ['kept']);
});

test('no items yields no lines', () => {
  assert.deepEqual(textContentItemsToLines([]), []);
  assert.deepEqual(textContentItemsToLines(null), []);
});

// --- buildCategorizedScanTargets -------------------------------------------

const fakeCanvas = (width = 1000, height = 1000) => stubCanvas(width, height);

function targetsFor(family) {
  // cropCanvas needs a real 2D context, so only assert on the plan metadata that
  // survives without one. Full-canvas targets reuse the source canvas untouched.
  return buildCategorizedScanTargets(fakeCanvas(), family).map(t => ({
    label: t.label,
    kind: t.kind,
    formats: t.formats,
    box: [t.x, t.y, t.w, t.h].map(Math.round)
  }));
}

test('every eParcel scan target requests a symbology and lies inside the canvas', () => {
  for (const t of targetsFor('eparcel')) {
    assert.ok(t.formats.length > 0, `${t.label} requests no symbology`);
    const [x, y, w, h] = t.box;
    assert.ok(w > 0 && h > 0, `${t.label} has an empty crop`);
    assert.ok(x >= 0 && y >= 0 && x + w <= 1000 && y + h <= 1000, `${t.label} falls outside the canvas: ${t.box}`);
  }
});

test('eParcel plan covers both symbologies and keeps a full-page safety scan', () => {
  const targets = targetsFor('eparcel');
  const formats = new Set(targets.flatMap(t => t.formats));
  assert.ok(formats.has('Code128'), 'no target scans for the linear barcode');
  assert.ok(formats.has('DataMatrix'), 'no target scans for the DataMatrix');

  // The safety scan must stay full-page: value capture must never depend on crop alignment.
  const safety = targets.find(t => /safety/i.test(t.label));
  assert.ok(safety, 'full page safety scan is missing');
  assert.deepEqual(safety.box, [0, 0, 1000, 1000]);
  assert.deepEqual(safety.formats, ['Code128', 'DataMatrix']);
});

test('eParcel plan targets the Metro barcode positions as well as the standard ones', () => {
  const targets = targetsFor('eparcel');
  // Metro puts the linear barcode along the bottom edge and the DataMatrix top-right,
  // where the standard eParcel crop looks at neither.
  const bottomLinear = targets.find(t => t.formats.includes('Code128') && t.box[1] + t.box[3] > 950);
  assert.ok(bottomLinear, 'no Code128 target reaches the bottom edge (Metro linear)');
  const topRightDm = targets.find(
    t => t.formats.includes('DataMatrix') && t.box[0] > 400 && t.box[1] < 100 && t.box[2] < 1000
  );
  assert.ok(topRightDm, 'no cropped DataMatrix target in the top-right (Metro DataMatrix)');
});

test('StarTrack gets its own plan, including a QR pass eParcel never runs', () => {
  const st = targetsFor('startrack');
  const ep = targetsFor('eparcel');
  assert.ok(
    st.some(t => t.formats.includes('QRCode')),
    'StarTrack plan has no QR target'
  );
  assert.ok(!ep.some(t => t.formats.includes('QRCode')), 'eParcel plan must not scan for QR');
  for (const t of st) {
    const [x, y, w, h] = t.box;
    assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= 1000 && y + h <= 1000, `${t.label} crop is invalid`);
  }
});

test('an unknown label family falls back to the eParcel plan rather than scanning nothing', () => {
  assert.deepEqual(targetsFor('not-a-carrier'), targetsFor('eparcel'));
});

test('scan target order is pinned, because earlier targets win the decode', () => {
  // Results are deduped in plan order, so reordering these silently changes which read
  // of a barcode is kept — including which crop its page coordinates come from.
  assert.deepEqual(
    targetsFor('eparcel').map(t => t.label),
    [
      'eParcel primary linear barcode crop',
      'eParcel Metro linear barcode expected crop',
      'eParcel Metro DataMatrix expected crop',
      'Full page safety scan'
    ]
  );
  assert.deepEqual(
    targetsFor('startrack').map(t => t.label),
    [
      'StarTrack QR full label scan',
      'StarTrack ATL barcode expected crop',
      'StarTrack routing barcode expected crop',
      'StarTrack freight item barcode expected crop',
      'StarTrack linear barcode sweep crop',
      'Full page safety scan'
    ]
  );
});

test('each named crop region resolves to the geometry the carrier layout expects', () => {
  // Pins the region each target actually covers, in canvas fractions. Not a snapshot of
  // the constants: these assert the *layout claim* each crop's name makes, so moving a
  // crop off the barcode it is named for fails here.
  const box = (family, label) => {
    const t = targetsFor(family).find(x => x.label === label);
    assert.ok(t, `missing target: ${label}`);
    return { x: t.box[0] / 1000, y: t.box[1] / 1000, r: (t.box[0] + t.box[2]) / 1000, b: (t.box[1] + t.box[3]) / 1000 };
  };

  const standard = box('eparcel', 'eParcel primary linear barcode crop');
  assert.ok(
    standard.y > 0.15 && standard.b < 0.5,
    `standard linear crop should sit in the upper-middle band: ${JSON.stringify(standard)}`
  );

  const metroLinear = box('eparcel', 'eParcel Metro linear barcode expected crop');
  assert.ok(
    metroLinear.b > 0.95 && metroLinear.x < 0.05 && metroLinear.r > 0.95,
    `Metro linear crop should span the bottom edge: ${JSON.stringify(metroLinear)}`
  );

  const metroDm = box('eparcel', 'eParcel Metro DataMatrix expected crop');
  assert.ok(
    metroDm.x > 0.5 && metroDm.y < 0.1 && metroDm.r > 0.95,
    `Metro DataMatrix crop should sit top-right: ${JSON.stringify(metroDm)}`
  );

  const freight = box('startrack', 'StarTrack freight item barcode expected crop');
  assert.ok(
    freight.y > 0.6 && freight.b > 0.9,
    `StarTrack freight crop should sit low on the label: ${JSON.stringify(freight)}`
  );

  const atl = box('startrack', 'StarTrack ATL barcode expected crop');
  assert.ok(
    atl.y < 0.1 && atl.r > 0.9 && atl.x > 0.4,
    `StarTrack ATL crop should sit top-right: ${JSON.stringify(atl)}`
  );

  const routing = box('startrack', 'StarTrack routing barcode expected crop');
  assert.ok(
    routing.x < 0.1 && routing.y > 0.25 && routing.b < 0.7,
    `StarTrack routing crop should sit mid-left: ${JSON.stringify(routing)}`
  );

  const sweep = box('startrack', 'StarTrack linear barcode sweep crop');
  assert.ok(
    sweep.x < 0.05 && sweep.r > 0.95 && sweep.b - sweep.y > 0.5,
    `StarTrack sweep should span most of the lower label: ${JSON.stringify(sweep)}`
  );
});

test('every cropped scan target is big enough to contain the symbol it targets', () => {
  // A crop can sit in the right band and still be far too small to hold a barcode, which
  // the region assertions above would not notice.
  for (const family of ['eparcel', 'startrack']) {
    for (const t of targetsFor(family)) {
      const [, , w, h] = t.box;
      assert.ok(w >= 200, `${t.label} is only ${w}/1000 wide — too narrow for a barcode`);
      assert.ok(h >= 90, `${t.label} is only ${h}/1000 tall — too short for a barcode`);
    }
  }
});

// --- mapBarcodeToPage ------------------------------------------------------

const target = { x: 100, y: 200, w: 300, h: 150, label: 'crop', canvas: fakeCanvas() };

test('an untransformed read is offset by its crop origin and claims a page location', () => {
  const out = mapBarcodeToPage({ boundingBox: { x: 10, y: 20, width: 50, height: 30 } }, target);
  assert.deepEqual(out.pageBoundingBox, { x: 110, y: 220, width: 50, height: 30 });
  assert.equal(out.locationQuality, 'decoded-symbol-bounding-box');
  assert.deepEqual(out.targetBox, { x: 100, y: 200, width: 300, height: 150 });
});

test('a transformed variant decodes but must not claim a page location', () => {
  // Rotated/sharpened crops decode fine, but their coordinates are not evidence of
  // where the symbol actually sits on the label.
  const out = mapBarcodeToPage({ boundingBox: { x: 10, y: 20, width: 50, height: 30 } }, target, 'sharpen-4x');
  assert.equal(out.pageBoundingBox, undefined);
  assert.equal(out.locationQuality, 'decoded-no-page-box');
});

test('the "original" variant label counts as untransformed', () => {
  const out = mapBarcodeToPage({ boundingBox: { x: 1, y: 2, width: 3, height: 4 } }, target, 'original');
  assert.equal(out.locationQuality, 'decoded-symbol-bounding-box');
});

test('a decode with no bounding box reports no page location', () => {
  const out = mapBarcodeToPage({ rawValue: 'X' }, target);
  assert.equal(out.pageBoundingBox, undefined);
  assert.equal(out.locationQuality, 'decoded-no-page-box');
});

test('the full page safety scan maps its box straight through', () => {
  const full = { x: 0, y: 0, w: 1000, h: 1000, label: 'Full page safety scan', canvas: fakeCanvas() };
  const out = mapBarcodeToPage({ boundingBox: { x: 5, y: 6, width: 7, height: 8 } }, full, 'sharpen-4x');
  assert.deepEqual(out.pageBoundingBox, { x: 5, y: 6, width: 7, height: 8 });
  assert.equal(out.locationQuality, 'decoded-symbol-bounding-box');
});

test('the original decode object is not mutated', () => {
  const original = { boundingBox: { x: 10, y: 20, width: 50, height: 30 }, rawValue: 'A' };
  const snapshot = JSON.stringify(original);
  mapBarcodeToPage(original, target);
  assert.equal(JSON.stringify(original), snapshot);
});
