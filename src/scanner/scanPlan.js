// Scan planning and coordinate mapping.
//
// These functions are pure: they decide which regions of a label get scanned for which
// symbology, how a decoded symbol maps back to page coordinates, and how a PDF text layer
// becomes reading-order lines. They live apart from pipeline.js because that module pulls
// in Vite-only asset imports (the ZXing wasm URL) and so cannot be loaded outside a bundle
// - keeping this logic here is what makes it directly testable.
import { FORMAT_KIND } from './barcodeTypes.js';
import { clampBox, cropCanvas } from './canvasUtils.js';
import { EPARCEL_SCAN_TARGETS, STARTRACK_LINEAR_TARGETS } from './labelImages.js';

/** Defines one crop region scan target with its expected formats. */
export function makeTarget(sourceCanvas, kind, label, x, y, w, h, formats) {
  const targetCanvas =
    x === 0 && y === 0 && w === sourceCanvas.width && h === sourceCanvas.height
      ? sourceCanvas
      : cropCanvas(sourceCanvas, x, y, w, h);
  return { kind, label, x, y, w, h, canvas: targetCanvas, formats };
}

/** Plans the ordered list of crop scan targets for the carrier label family. */
export function buildCategorizedScanTargets(canvas, labelFamily = 'eparcel') {
  const w = canvas.width;
  const h = canvas.height;
  if (labelFamily === 'startrack') {
    const st = STARTRACK_LINEAR_TARGETS;
    return [
      makeTarget(canvas, FORMAT_KIND.qr, 'StarTrack QR full label scan', 0, 0, w, h, ['QRCode']),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack ATL barcode expected crop',
        w * st.atl.x,
        h * st.atl.y,
        w * st.atl.w,
        h * st.atl.h,
        ['Code128']
      ),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack routing barcode expected crop',
        w * st.routing.x,
        h * st.routing.y,
        w * st.routing.w,
        h * st.routing.h,
        ['Code128']
      ),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack freight item barcode expected crop',
        w * st.freight.x,
        h * st.freight.y,
        w * st.freight.w,
        h * st.freight.h,
        ['Code128']
      ),
      makeTarget(
        canvas,
        FORMAT_KIND.linear,
        'StarTrack linear barcode sweep crop',
        w * st.sweep.x,
        h * st.sweep.y,
        w * st.sweep.w,
        h * st.sweep.h,
        ['Code128']
      ),
      makeTarget(canvas, FORMAT_KIND.mixed, 'Full page safety scan', 0, 0, w, h, ['Code128', 'QRCode'])
    ];
  }
  const ep = EPARCEL_SCAN_TARGETS;
  const target = (kind, label, box, formats) =>
    makeTarget(canvas, kind, label, w * box.x, h * box.y, w * box.w, h * box.h, formats);
  return [
    target(FORMAT_KIND.linear, 'eParcel primary linear barcode crop', ep.standardLinear, ['Code128']),
    target(FORMAT_KIND.linear, 'eParcel Metro linear barcode expected crop', ep.metroLinear, ['Code128']),
    target(FORMAT_KIND.datamatrix, 'eParcel Metro DataMatrix expected crop', ep.metroDataMatrix, ['DataMatrix']),
    makeTarget(canvas, FORMAT_KIND.mixed, 'Full page safety scan', 0, 0, w, h, ['Code128', 'DataMatrix'])
  ];
}

/** Maps a crop-local barcode box back to page coordinates when the crop was not transformed. */
export function mapBarcodeToPage(barcode, target, variantLabel = '') {
  const base = { ...barcode };
  const targetBox = {
    x: Math.round(target.x || 0),
    y: Math.round(target.y || 0),
    width: Math.round(target.w || target.canvas?.width || 0),
    height: Math.round(target.h || target.canvas?.height || 0)
  };
  base.targetBox = targetBox;

  // Transformed crops are useful for decoding, but their coordinates are not reliable
  // evidence of final label placement. Only untransformed reads can prove location.
  const isUntransformed = !variantLabel || variantLabel === 'original';
  if (base.boundingBox && isUntransformed) {
    base.pageBoundingBox = clampBox(
      {
        x: targetBox.x + base.boundingBox.x,
        y: targetBox.y + base.boundingBox.y,
        width: base.boundingBox.width,
        height: base.boundingBox.height
      },
      targetBox.x + Math.max(targetBox.width, 1),
      targetBox.y + Math.max(targetBox.height, 1)
    );
    base.locationQuality = 'decoded-symbol-bounding-box';
  } else if (target.label === 'Full page safety scan' && base.boundingBox) {
    base.pageBoundingBox = clampBox(base.boundingBox, target.canvas.width, target.canvas.height);
    base.locationQuality = 'decoded-symbol-bounding-box';
  } else {
    base.locationQuality = 'decoded-no-page-box';
  }
  return base;
}

/** Groups pdf.js text items into reading-order lines. */
export function textContentItemsToLines(items) {
  const entries = [];
  for (const item of items || []) {
    const str = String(item.str || '').trim();
    if (!str) continue;
    const tx = item.transform || [1, 0, 0, 1, 0, 0];
    entries.push({ text: str, x: tx[4] || 0, y: tx[5] || 0, height: Math.abs(tx[3] || item.height || 8) });
  }
  entries.sort((a, b) => b.y - a.y || a.x - b.x);

  const groups = [];
  const yTolerance = 3.5;
  const yBuckets = new Map();
  for (const entry of entries) {
    const bucketKey = Math.round(entry.y / yTolerance);
    let group = null;
    for (const key of [bucketKey - 1, bucketKey, bucketKey + 1]) {
      const bucketGroups = yBuckets.get(key) || [];
      group = bucketGroups.find(candidate => Math.abs(candidate.y - entry.y) <= yTolerance);
      if (group) break;
    }
    if (!group) {
      group = { y: entry.y, items: [] };
      groups.push(group);
      const bucketGroups = yBuckets.get(bucketKey) || [];
      bucketGroups.push(group);
      yBuckets.set(bucketKey, bucketGroups);
    }
    group.items.push(entry);
  }

  groups.sort((a, b) => b.y - a.y);
  return groups
    .map(group => {
      group.items.sort((a, b) => a.x - b.x);
      const parts = [];
      let lastRight = null;
      for (const item of group.items) {
        if (lastRight !== null && item.x - lastRight > 18) parts.push('   ');
        parts.push(item.text);
        lastRight = item.x + item.text.length * 5;
      }
      return parts
        .join(' ')
        .replace(/\s{4,}/g, '   ')
        .trim();
    })
    .filter(Boolean);
}
