// Tests for the pure document-preparation and quality-assessment helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  residualSkewDegrees,
  estimateSkewByProjection,
  flattenGrayPlane,
  luminanceSpread,
  code128ModuleWidthPx,
  summarizeInputQuality
} from '../src/scanner/inputPrep.js';

test('residualSkewDegrees reports the median few-degree tilt across symbols', () => {
  const skew = residualSkewDegrees([{ orientation: 92.4 }, { orientation: 2.6 }, { orientation: -87.5 }]);
  assert.equal(skew, 2.5);
});

test('residualSkewDegrees ignores noise below the floor and rotations above the cap', () => {
  assert.equal(residualSkewDegrees([{ orientation: 0.3 }]), 0);
  assert.equal(residualSkewDegrees([{ orientation: 20 }]), 0);
  assert.equal(residualSkewDegrees([{ orientation: NaN }, {}]), 0);
  assert.equal(residualSkewDegrees([]), 0);
});

// Synthetic luminance (pixel brightness) plane: a white page with dark stripes every 12 px, tilted by tiltDegrees.
function stripedLum(width, height, tiltDegrees) {
  const slope = Math.tan((tiltDegrees * Math.PI) / 180);
  const cx = width / 2;
  const lum = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const phase = (((y - slope * (x - cx)) % 12) + 12) % 12;
      if (phase < 3) lum[y * width + x] = 20;
    }
  }
  return lum;
}

test('estimateSkewByProjection finds the correction angle for tilted text rows', () => {
  const width = 220;
  const height = 140;
  const correction = estimateSkewByProjection(stripedLum(width, height, 3), width, height);
  assert.ok(Math.abs(correction - -3) <= 0.51, `expected about -3, got ${correction}`);
});

test('estimateSkewByProjection returns 0 for straight rows', () => {
  const width = 220;
  const height = 140;
  assert.equal(estimateSkewByProjection(stripedLum(width, height, 0), width, height), 0);
});

test('flattenGrayPlane levels an unevenly lit page and skips an even one', () => {
  const width = 120;
  const height = 120;
  const uneven = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) uneven[y * width + x] = x < width / 2 ? 240 : 160;
  }
  assert.equal(flattenGrayPlane(uneven, width, height), true);
  let left = 0;
  let right = 0;
  for (let y = 20; y < height - 20; y += 1) {
    left += uneven[y * width + 20];
    right += uneven[y * width + (width - 20)];
  }
  assert.ok(Math.abs(left - right) / Math.max(left, right) < 0.1, 'background should be level after flattening');

  const even = new Float32Array(width * height).fill(230);
  assert.equal(flattenGrayPlane(even, width, height), false);
});

test('luminanceSpread measures the usable tonal range', () => {
  const flat = new Uint8Array(1000).fill(128);
  assert.equal(luminanceSpread(flat), 0);
  const full = new Uint8Array(1000);
  for (let i = 0; i < full.length; i += 1) full[i] = i % 2 ? 245 : 12;
  assert.ok(luminanceSpread(full) > 200);
});

test('code128ModuleWidthPx derives module size from bar count and box width', () => {
  // 61 bars -> 19 symbol characters -> 222 modules.
  assert.equal(code128ModuleWidthPx(61, 444), 2);
  assert.equal(code128ModuleWidthPx(5, 444), null);
  assert.equal(code128ModuleWidthPx(61, 10), null);
  assert.equal(code128ModuleWidthPx(null, 444), null);
});

test('summarizeInputQuality rates metrics and rolls up the overall rating', () => {
  const good = summarizeInputQuality({ sharpnessRatio: 0.8, spread: 220, dpi: 300, deskewDegrees: 0 });
  assert.equal(good.sharpness.rating, 'good');
  assert.equal(good.resolution.kind, 'dpi');
  assert.equal(good.resolution.rating, 'good');
  assert.equal(good.overall, 'good');

  const poor = summarizeInputQuality({ sharpnessRatio: 0.2, spread: 220, pxPerModule: 1.5, deskewDegrees: -2.5 });
  assert.equal(poor.sharpness.rating, 'poor');
  assert.equal(poor.resolution.kind, 'pxPerModule');
  assert.equal(poor.resolution.rating, 'poor');
  assert.equal(poor.overall, 'poor');
  assert.equal(poor.deskewDegrees, -2.5);

  const unknown = summarizeInputQuality({});
  assert.equal(unknown.overall, null);
});
