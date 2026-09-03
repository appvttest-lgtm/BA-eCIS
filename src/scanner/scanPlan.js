// Scan planning and coordinate mapping.
//
// These functions are pure: they decide which regions of a label get scanned for which
// symbology, how a decoded symbol maps back to page coordinates, and how a PDF text layer
// becomes reading-order lines. They live apart from pipeline.js because that module pulls
// in Vite-only asset imports (the ZXing wasm URL) and so cannot be loaded outside a bundle
// - keeping this logic here is what makes it directly testable.
import { FORMAT_KIND, LOCATION_QUALITY } from './barcodeTypes.js';
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

// Symbologies the Barcode Reader mode scans for. The carrier audits only ever ask for the
// symbols their specs allow (Code 128 / DataMatrix / QR); the reader also accepts the retail
// and logistics formats so any barcode on an uploaded label is surfaced.
export const READER_SCAN_FORMATS = ['Code128', 'DataMatrix', 'QRCode', 'PDF417', 'EAN-13', 'EAN-8'];

/** Plans the ordered list of crop scan targets for the carrier label family. */
export function buildCategorizedScanTargets(canvas, labelFamily = 'eparcel') {
  const w = canvas.width;
  const h = canvas.height;
  if (labelFamily === 'reader') {
    // Barcode Reader mode: no carrier layout is assumed, so scan the full page per
    // symbology family plus both carriers' linear sweep bands (dense 1D symbols decode
    // more reliably from a band crop than from the whole page).
    const st = STARTRACK_LINEAR_TARGETS;
    const ep = EPARCEL_SCAN_TARGETS;
    const linearFormats = READER_SCAN_FORMATS.filter(f => f !== 'DataMatrix' && f !== 'QRCode');
    const band = (label, box) =>
      makeTarget(canvas, FORMAT_KIND.linear, label, w * box.x, h * box.y, w * box.w, h * box.h, linearFormats);
    return [
      makeTarget(canvas, FORMAT_KIND.qr, 'Reader QR full page scan', 0, 0, w, h, ['QRCode']),
      makeTarget(canvas, FORMAT_KIND.datamatrix, 'Reader DataMatrix full page scan', 0, 0, w, h, ['DataMatrix']),
      band('Reader linear sweep (StarTrack band)', st.sweep),
      band('Reader linear sweep (eParcel band)', ep.standardLinear),
      makeTarget(canvas, FORMAT_KIND.mixed, 'Full page safety scan', 0, 0, w, h, READER_SCAN_FORMATS)
    ];
  }
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

/**
 * Inverts a 0/90/180/270-degree clockwise canvas rotation for an axis-aligned box.
 * `rotatedWidth`/`rotatedHeight` are the dimensions of the ROTATED canvas the box
 * was measured on. Matches the mapping used by `rotateCanvas`. Pure.
 */
export function unrotateBoxQuarter(box, degrees, rotatedWidth, rotatedHeight) {
  if (!box) return null;
  const d = ((degrees % 360) + 360) % 360;
  if (d === 0) return { ...box };
  if (d === 90) {
    // The forward 90 CW rotation mapped (x0, y0) -> (H0 - y0, x0), where H0 (the original
    // canvas height) equals rotatedWidth; solve that back for the box's top-left corner.
    return { x: box.y, y: rotatedWidth - box.x - box.width, width: box.height, height: box.width };
  }
  if (d === 180) {
    return {
      x: rotatedWidth - box.x - box.width,
      y: rotatedHeight - box.y - box.height,
      width: box.width,
      height: box.height
    };
  }
  if (d === 270) {
    // The forward 270 CW rotation mapped (x0, y0) -> (y0, W0 - x0), where W0 (the original
    // canvas width) equals rotatedHeight; solve that back for the box's top-left corner.
    return { x: rotatedHeight - box.y - box.height, y: box.x, width: box.height, height: box.width };
  }
  return null;
}

/**
 * Maps a barcode box measured on a preprocessed scan variant back to the
 * coordinates of the variant's base (crop target) canvas. `transform` describes
 * how the variant was built from the base: an optional quarter rotation
 * (`rotate`, with the rotated canvas dimensions), a uniform `scale`, and the
 * translation `dx`/`dy` (base = variant / scale + d). Returns null when the
 * transform cannot be inverted. Pure; exported for tests.
 */
export function mapVariantBoxToBase(box, transform) {
  if (!box || !transform) return null;
  let b = { ...box };
  if (transform.rotate) {
    b = unrotateBoxQuarter(b, transform.rotate, transform.rotatedWidth || 0, transform.rotatedHeight || 0);
    if (!b) return null;
  }
  const scale = transform.scale || 1;
  if (!(scale > 0)) return null;
  return {
    x: Math.round(b.x / scale + (transform.dx || 0)),
    y: Math.round(b.y / scale + (transform.dy || 0)),
    width: Math.round(b.width / scale),
    height: Math.round(b.height / scale)
  };
}

/**
 * Maps a crop-local barcode box back to page coordinates. Untransformed reads
 * map directly; reads from preprocessed variants map through the variant's
 * recorded transform (trim/border/scale/rotation are all invertible), carrying
 * a slightly weaker location quality so direct reads still win evidence crops.
 */
export function mapBarcodeToPage(barcode, target, variantLabel = '', transform = null) {
  const base = { ...barcode };
  const targetBox = {
    x: Math.round(target.x || 0),
    y: Math.round(target.y || 0),
    width: Math.round(target.w || target.canvas?.width || 0),
    height: Math.round(target.h || target.canvas?.height || 0)
  };
  base.targetBox = targetBox;

  const clampToTarget = box =>
    clampBox(
      { x: targetBox.x + box.x, y: targetBox.y + box.y, width: box.width, height: box.height },
      targetBox.x + Math.max(targetBox.width, 1),
      targetBox.y + Math.max(targetBox.height, 1)
    );

  const isUntransformed = !variantLabel || variantLabel === 'original';
  const mappedBox = !isUntransformed && base.boundingBox ? mapVariantBoxToBase(base.boundingBox, transform) : null;
  if (base.boundingBox && isUntransformed) {
    base.pageBoundingBox = clampToTarget(base.boundingBox);
    base.locationQuality = LOCATION_QUALITY.decoded;
  } else if (mappedBox && mappedBox.width > 0 && mappedBox.height > 0) {
    base.pageBoundingBox = clampToTarget(mappedBox);
    base.locationQuality = LOCATION_QUALITY.mapped;
  } else if (target.label === 'Full page safety scan' && base.boundingBox) {
    base.pageBoundingBox = clampBox(base.boundingBox, target.canvas.width, target.canvas.height);
    base.locationQuality = LOCATION_QUALITY.decoded;
  } else {
    base.locationQuality = LOCATION_QUALITY.none;
  }
  return base;
}

/** Extracts positioned text entries (PDF user units, y-up: origin at bottom-left) from pdf.js items. Pure. */
export function textEntriesFromItems(items) {
  const entries = [];
  for (const item of items || []) {
    const str = String(item.str || '').trim();
    if (!str) continue;
    const tx = item.transform || [1, 0, 0, 1, 0, 0];
    entries.push({ text: str, x: tx[4] || 0, y: tx[5] || 0, height: Math.abs(tx[3] || item.height || 8) });
  }
  return entries;
}

/**
 * Splits a page's text entries between the label regions of a segmented sheet so
 * each label is audited against its own text only (facts from one label must
 * never contaminate another). Regions are pixel rects on the rendered canvas;
 * `scale` converts PDF units to canvas pixels and `pageHeightPdf` flips the
 * y-up PDF origin to the canvas's y-down origin. Entries falling outside every
 * region are dropped. Pure; exported for tests.
 */
export function assignTextEntriesToRegions(entries, regions, scale, pageHeightPdf) {
  const buckets = regions.map(() => []);
  if (!(scale > 0)) return buckets;
  for (const entry of entries || []) {
    const px = entry.x * scale;
    const py = (pageHeightPdf - entry.y) * scale;
    for (let i = 0; i < regions.length; i += 1) {
      const r = regions[i];
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
        buckets[i].push(entry);
        break;
      }
    }
  }
  return buckets;
}

/** Groups positioned text entries into reading-order lines. Pure. */
export function linesFromTextEntries(sourceEntries) {
  const entries = [...(sourceEntries || [])];
  entries.sort((a, b) => b.y - a.y || a.x - b.x);

  const groups = [];
  // Entries whose baselines sit within 3.5 PDF units of each other count as one visual line.
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
        // A wide horizontal gap marks a column break; ~5 units/char approximates each entry's right edge.
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

/** Groups pdf.js text items into reading-order lines. */
export function textContentItemsToLines(items) {
  return linesFromTextEntries(textEntriesFromItems(items));
}
