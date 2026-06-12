// Node smoke test for src/preprocess.js: orientation candidate selection and
// multi-label sheet segmentation. Run: node tests/smoke-preprocess.mjs
import {
  nearestRightAngle,
  isUprightOrientation,
  pickRotationCandidates,
  findLabelRegions
} from '../src/preprocess.js';

let failures = 0;
function expect(label, condition) {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

console.log('Orientation helpers');
expect('nearestRightAngle snaps 87 to 90', nearestRightAngle(87) === 90);
expect('nearestRightAngle snaps -90 to 270', nearestRightAngle(-90) === 270);
expect('nearestRightAngle snaps 358 to 0', nearestRightAngle(358) === 0);

expect('upright when QR orientation 0', isUprightOrientation([{ format: 'QRCode', orientation: 2 }]));
expect('not upright when QR orientation 90', !isUprightOrientation([{ format: 'QRCode', orientation: 91 }]));
expect('linear-only horizontal counts as upright', isUprightOrientation([{ format: 'Code128', orientation: 180 }]));
expect('linear-only vertical is not upright', !isUprightOrientation([{ format: 'Code128', orientation: 270 }]));
expect('no symbols defaults to upright', isUprightOrientation([]));

expect('no candidates for upright 2D', pickRotationCandidates([{ format: 'QRCode', orientation: 1 }]).length === 0);
const rot90 = pickRotationCandidates([{ format: 'QRCode', orientation: 90 }]);
expect('rotated QR yields two right-angle candidates', rot90.length === 2 && rot90.includes(90) && rot90.includes(270));
expect(
  '180-rotated QR yields single candidate',
  JSON.stringify(pickRotationCandidates([{ format: 'DataMatrix', orientation: 179 }])) === '[180]'
);
const linVert = pickRotationCandidates([{ format: 'Code128', orientation: 90 }]);
expect('vertical linear yields 90/270 candidates', linVert.length === 2);
expect(
  '2D vote outweighs linear noise',
  pickRotationCandidates([
    { format: 'QRCode', orientation: 0 },
    { format: 'Code128', orientation: 90 }
  ]).length === 0
);

// --- segmentation fixtures -------------------------------------------------
// Builds a page luminance grid (255 = white) and stamps dense "labels" onto it.
function makePage(width, height) {
  return { lum: new Uint8Array(width * height).fill(255), width, height };
}
function stampLabel(page, x, y, w, h) {
  // Dense body with internal white line noise so fixtures are not solid black.
  for (let yy = y; yy < y + h; yy += 1) {
    if ((yy - y) % 9 === 8) continue;
    for (let xx = x; xx < x + w; xx += 1) {
      if ((xx - x) % 13 === 12) continue;
      page.lum[yy * page.width + xx] = 30;
    }
  }
}

console.log('Multi-label segmentation');
// A4-like portrait grid, 2x2 labels with clear gutters
const sheet4 = makePage(210, 297);
stampLabel(sheet4, 10, 12, 90, 128);
stampLabel(sheet4, 110, 12, 90, 128);
stampLabel(sheet4, 10, 156, 90, 128);
stampLabel(sheet4, 110, 156, 90, 128);
const regions4 = findLabelRegions(sheet4.lum, sheet4.width, sheet4.height);
expect('2x2 sheet yields 4 regions', regions4.length === 4);
expect(
  'regions are fractional and label-sized',
  regions4.every(r => r.w > 0.3 && r.w < 0.55 && r.h > 0.3 && r.h < 0.55)
);

// Two labels stacked vertically
const sheet2 = makePage(210, 297);
stampLabel(sheet2, 30, 10, 150, 130);
stampLabel(sheet2, 30, 160, 150, 130);
const regions2 = findLabelRegions(sheet2.lum, sheet2.width, sheet2.height);
expect('stacked pair yields 2 regions', regions2.length === 2);
expect(
  'stacked regions ordered sanely',
  regions2.every(r => r.w > 0.5)
);

// Two labels with large blank area below (half-used sheet)
const sheetHalf = makePage(210, 297);
stampLabel(sheetHalf, 8, 10, 92, 130);
stampLabel(sheetHalf, 110, 10, 92, 130);
const regionsHalf = findLabelRegions(sheetHalf.lum, sheetHalf.width, sheetHalf.height);
expect('half-used sheet yields 2 regions', regionsHalf.length === 2);

// Single dense label fills the page: no split
const single = makePage(100, 150);
stampLabel(single, 4, 4, 92, 142);
expect('single label is not segmented', findLabelRegions(single.lum, single.width, single.height).length === 0);

// Single label with a sparse header and a full-width internal white band:
// the header strip's aspect ratio must veto the split.
const headerBody = makePage(100, 150);
stampLabel(headerBody, 5, 4, 90, 22);
stampLabel(headerBody, 5, 40, 90, 106);
expect(
  'header/body label is not segmented',
  findLabelRegions(headerBody.lum, headerBody.width, headerBody.height).length === 0
);

// Blank page: no regions
const blank = makePage(120, 120);
expect('blank page yields no regions', findLabelRegions(blank.lum, blank.width, blank.height).length === 0);

if (failures) {
  console.error(`\n${failures} preprocess smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nAll preprocess smoke checks passed.');
