// Tests for the pure geometry core behind linear-barcode height refinement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendRowRange, countBarRuns } from '../src/scanner/canvasUtils.js';

const barRow = bars => ({ bars, contrast: 200 });
const blankRow = () => ({ bars: 0, contrast: 10 });

test('extendRowRange grows to the contiguous rows matching the reference bar count', () => {
  const rows = [
    blankRow(),
    barRow(60),
    barRow(61),
    barRow(61),
    barRow(62),
    barRow(61),
    blankRow(),
    blankRow(),
    blankRow()
  ];
  const { start, end } = extendRowRange(rows, 3, 61);
  assert.equal(start, 1);
  assert.equal(end, 5);
});

test('extendRowRange tolerates a brief interruption but stops at sustained misses', () => {
  const rows = [barRow(61), blankRow(), barRow(61), barRow(61), blankRow(), blankRow(), blankRow(), barRow(61)];
  const { start, end } = extendRowRange(rows, 2, 61);
  assert.equal(start, 0);
  assert.equal(end, 3);
});

test('countBarRuns counts dark runs across a scanline', () => {
  assert.equal(countBarRuns([200, 10, 10, 200, 10, 200], 100), 2);
  assert.equal(countBarRuns([200, 200], 100), 0);
});
