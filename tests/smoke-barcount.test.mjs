// Tests for the pure bar-run counter behind the ST-FRT-09 bar-count check.
// A compression-encoded 20-char StarTrack freight barcode prints exactly 61
// bars (19 symbol characters x 3 bars + 4 stop bars); all-Code-B prints 70.
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { countBarRuns } from '../src/scanner/canvasUtils.js';

/** Builds a luminance scanline: `bars` dark runs of `barWidth` px separated by light gaps. */
function scanline(bars, { barWidth = 3, gapWidth = 2, dark = 20, light = 235, margin = 8 } = {}) {
  const values = new Array(margin).fill(light);
  for (let i = 0; i < bars; i += 1) {
    for (let b = 0; b < barWidth; b += 1) values.push(dark);
    if (i < bars - 1) for (let g = 0; g < gapWidth; g += 1) values.push(light);
  }
  for (let i = 0; i < margin; i += 1) values.push(light);
  return values;
}

test('counts the 61 bars of a compression-encoded freight symbol', () => {
  assert.equal(countBarRuns(scanline(61), 128), 61);
});

test('counts the 70 bars of an uncompressed all-Code-B symbol', () => {
  assert.equal(countBarRuns(scanline(70), 128), 70);
});

test('counts single-pixel bars and wide bars alike', () => {
  assert.equal(countBarRuns(scanline(40, { barWidth: 1, gapWidth: 1 }), 128), 40);
  assert.equal(countBarRuns(scanline(10, { barWidth: 12, gapWidth: 6 }), 128), 10);
});

test('tolerates uneven illumination when thresholded mid-contrast', () => {
  const values = scanline(61, { dark: 70, light: 180 });
  // Simulate a brightness gradient across the symbol.
  const lit = values.map((v, i) => Math.min(255, v + (i / values.length) * 40));
  const min = Math.min(...lit);
  const max = Math.max(...lit);
  assert.equal(countBarRuns(lit, (min + max) / 2), 61);
});

test('returns 0 for a blank scanline', () => {
  assert.equal(countBarRuns(new Array(200).fill(240), 128), 0);
});
