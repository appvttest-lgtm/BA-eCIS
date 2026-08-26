// Tests for the pure preprocessing helpers: orientation normalization and
// multi-label sheet segmentation (they were split out of main.jsx for exactly this).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLabelRegions,
  isUprightOrientation,
  nearestRightAngle,
  pickRotationCandidates
} from '../src/preprocess.js';

test('nearestRightAngle snaps to the closest right angle', () => {
  assert.equal(nearestRightAngle(0), 0);
  assert.equal(nearestRightAngle(44), 0);
  assert.equal(nearestRightAngle(46), 90);
  assert.equal(nearestRightAngle(179), 180);
  assert.equal(nearestRightAngle(271), 270);
  assert.equal(nearestRightAngle(359), 0);
  assert.equal(nearestRightAngle(-90), 270);
  assert.equal(nearestRightAngle('not-a-number'), 0);
});

test('isUprightOrientation prefers 2D symbol evidence over linear axes', () => {
  assert.equal(isUprightOrientation([]), true, 'no evidence means no rotation');
  assert.equal(isUprightOrientation([{ format: 'DataMatrix', orientation: 2 }]), true);
  assert.equal(isUprightOrientation([{ format: 'QRCode', orientation: 90 }]), false);
  assert.equal(
    isUprightOrientation([{ format: 'Code128', orientation: 180 }]),
    true,
    'linear reads the same both ways'
  );
  assert.equal(isUprightOrientation([{ format: 'Code128', orientation: 90 }]), false);
  assert.equal(
    isUprightOrientation([
      { format: 'Code128', orientation: 90 },
      { format: 'DataMatrix', orientation: 0 }
    ]),
    true,
    '2D at 0 wins over a vertical linear'
  );
});

test('pickRotationCandidates orders likely canvas rotations first', () => {
  assert.deepEqual(pickRotationCandidates([{ format: 'QRCode', orientation: 0 }]), []);
  assert.deepEqual(pickRotationCandidates([{ format: 'QRCode', orientation: 180 }]), [180]);
  assert.deepEqual(pickRotationCandidates([{ format: 'DataMatrix', orientation: 90 }]), [270, 90]);
  assert.deepEqual(pickRotationCandidates([{ format: 'Code128', orientation: 90 }]), [90, 270]);
  assert.deepEqual(pickRotationCandidates([{ format: 'Code128', orientation: 0 }]), []);
  assert.deepEqual(pickRotationCandidates([]), []);
});

/** Builds a white page with solid black rectangles: [{x, y, w, h}] in pixels. */
function pageWithInk(width, height, blocks) {
  const lum = new Uint8Array(width * height).fill(255);
  for (const block of blocks) {
    for (let y = block.y; y < block.y + block.h; y += 1) {
      for (let x = block.x; x < block.x + block.w; x += 1) lum[y * width + x] = 0;
    }
  }
  return lum;
}

test('findLabelRegions returns nothing for a blank or single-label page', () => {
  assert.deepEqual(findLabelRegions(pageWithInk(100, 100, []), 100, 100), []);
  assert.deepEqual(findLabelRegions(pageWithInk(100, 100, [{ x: 10, y: 10, w: 80, h: 80 }]), 100, 100), []);
});

test('findLabelRegions splits a two-label sheet at the white gutter', () => {
  const lum = pageWithInk(100, 100, [
    { x: 5, y: 5, w: 90, h: 40 },
    { x: 5, y: 55, w: 90, h: 40 }
  ]);
  const regions = findLabelRegions(lum, 100, 100);
  assert.equal(regions.length, 2);
  const [top, bottom] = [...regions].sort((a, b) => a.y - b.y);
  assert.ok(top.y < 0.1 && top.h > 0.3 && top.h < 0.5, `top region looks like a label: ${JSON.stringify(top)}`);
  assert.ok(bottom.y > 0.5 && bottom.h > 0.3, `bottom region looks like a label: ${JSON.stringify(bottom)}`);
});
