// Tests for the pure scan-planning helpers: PDF text layer -> reading-order lines,
// and mapping decoded symbols back to page coordinates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapBarcodeToPage,
  textContentItemsToLines,
  mapVariantBoxToBase,
  unrotateBoxQuarter,
  textEntriesFromItems,
  assignTextEntriesToRegions,
  linesFromTextEntries
} from '../src/scanner/scanPlan.js';

// Minimal pdf.js text item: the transform matrix's last two entries are the item's x/y page position.
const textItem = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });

test('textContentItemsToLines groups items into reading-order lines', () => {
  const lines = textContentItemsToLines([
    textItem('SYDNEY NSW 2000', 10, 80),
    textItem('JOHN', 30, 100),
    textItem('TO', 10, 100),
    textItem('', 50, 100)
  ]);
  assert.deepEqual(lines, ['TO JOHN', 'SYDNEY NSW 2000']);
});

test('textContentItemsToLines merges items within the y tolerance onto one line', () => {
  const lines = textContentItemsToLines([textItem('CONNOTE:', 10, 100), textItem('ABCD12345678', 60, 101.5)]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^CONNOTE: +ABCD12345678$/);
});

test('mapBarcodeToPage offsets untransformed crop coordinates back to the page', () => {
  const target = {
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    canvas: { width: 100, height: 50 },
    label: 'eParcel primary linear barcode crop'
  };
  const mapped = mapBarcodeToPage(
    { text: 'x', boundingBox: { x: 5, y: 5, width: 20, height: 10 } },
    target,
    'original'
  );
  assert.deepEqual(mapped.pageBoundingBox, { x: 15, y: 25, width: 20, height: 10 });
  assert.equal(mapped.locationQuality, 'decoded-symbol-bounding-box');
  assert.deepEqual(mapped.targetBox, { x: 10, y: 20, width: 100, height: 50 });
});

test('mapBarcodeToPage refuses page coordinates from transformed crops', () => {
  const target = { x: 10, y: 20, w: 100, h: 50, canvas: { width: 100, height: 50 }, label: 'crop' };
  const mapped = mapBarcodeToPage(
    { text: 'x', boundingBox: { x: 5, y: 5, width: 20, height: 10 } },
    target,
    'rotated-90'
  );
  assert.equal(mapped.pageBoundingBox, undefined);
  assert.equal(mapped.locationQuality, 'decoded-no-page-box');
});

test('unrotateBoxQuarter inverts 90/180/270 degree canvas rotations', () => {
  // Original 100x60 canvas; box {x:10, y:20, w:20, h:5}.
  assert.deepEqual(unrotateBoxQuarter({ x: 35, y: 10, width: 5, height: 20 }, 90, 60, 100), {
    x: 10,
    y: 20,
    width: 20,
    height: 5
  });
  assert.deepEqual(unrotateBoxQuarter({ x: 20, y: 70, width: 5, height: 20 }, 270, 60, 100), {
    x: 10,
    y: 20,
    width: 20,
    height: 5
  });
  assert.deepEqual(unrotateBoxQuarter({ x: 70, y: 35, width: 20, height: 5 }, 180, 100, 60), {
    x: 10,
    y: 20,
    width: 20,
    height: 5
  });
});

test('mapVariantBoxToBase inverts scale and translation', () => {
  const base = mapVariantBoxToBase({ x: 20, y: 10, width: 40, height: 8 }, { scale: 2, dx: 5, dy: 7 });
  assert.deepEqual(base, { x: 15, y: 12, width: 20, height: 4 });
});

test('mapBarcodeToPage maps transformed-variant boxes through the recorded transform', () => {
  const target = { x: 100, y: 50, w: 200, h: 100, canvas: { width: 200, height: 100 }, label: 'crop' };
  const mapped = mapBarcodeToPage(
    { text: 'x', boundingBox: { x: 40, y: 30, width: 60, height: 20 } },
    target,
    '2x nearest',
    { scale: 2, dx: -10, dy: -10 }
  );
  assert.deepEqual(mapped.pageBoundingBox, { x: 110, y: 55, width: 30, height: 10 });
  assert.equal(mapped.locationQuality, 'variant-mapped-bounding-box');
});

test('mapBarcodeToPage maps rotated rescue reads back through the rotation', () => {
  // Variant canvas 100x60 rotated 90 degrees before decoding.
  const target = { x: 0, y: 0, w: 100, h: 60, canvas: { width: 100, height: 60 }, label: 'crop' };
  const mapped = mapBarcodeToPage(
    { text: 'x', boundingBox: { x: 35, y: 10, width: 5, height: 20 } },
    target,
    'original rotated 90',
    { scale: 1, dx: 0, dy: 0, rotate: 90, rotatedWidth: 60, rotatedHeight: 100 }
  );
  assert.deepEqual(mapped.pageBoundingBox, { x: 10, y: 20, width: 20, height: 5 });
  assert.equal(mapped.locationQuality, 'variant-mapped-bounding-box');
});

test('assignTextEntriesToRegions splits entries between label regions and drops strays', () => {
  const entries = textEntriesFromItems([
    { str: 'LEFT LABEL', transform: [1, 0, 0, 1, 10, 80] },
    { str: 'RIGHT LABEL', transform: [1, 0, 0, 1, 60, 80] },
    { str: 'GUTTER', transform: [1, 0, 0, 1, 49.5, 80] }
  ]);
  // Page 100x100 PDF units rendered at 2x; two side-by-side 98px regions with a gutter.
  const regions = [
    { x: 0, y: 0, w: 98, h: 200 },
    { x: 102, y: 0, w: 98, h: 200 }
  ];
  const buckets = assignTextEntriesToRegions(entries, regions, 2, 100);
  assert.deepEqual(linesFromTextEntries(buckets[0]), ['LEFT LABEL']);
  assert.deepEqual(linesFromTextEntries(buckets[1]), ['RIGHT LABEL']);
});
