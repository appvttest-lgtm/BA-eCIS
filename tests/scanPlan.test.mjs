// Tests for the pure scan-planning helpers: PDF text layer -> reading-order lines,
// and mapping decoded symbols back to page coordinates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapBarcodeToPage, textContentItemsToLines } from '../src/scanner/scanPlan.js';

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
