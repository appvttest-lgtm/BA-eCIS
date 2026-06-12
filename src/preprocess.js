// Input preprocessing helpers for issue #7: orientation normalization and
// multi-label sheet segmentation. Pure logic lives here so Node smoke tests can
// exercise it without a browser canvas; main.jsx owns the canvas plumbing.

const RIGHT_ANGLES = [0, 90, 180, 270];
const TWO_D_FORMATS = new Set(['QRCode', 'DataMatrix', 'Aztec', 'PDF417', 'MicroQRCode', 'RMQRCode']);

/** Snaps an arbitrary decoder-reported angle to the nearest right angle in [0, 360). */
export function nearestRightAngle(degrees) {
  const norm = ((Number(degrees) || 0) % 360 + 360) % 360;
  let best = 0;
  let bestDiff = Infinity;
  for (const angle of [...RIGHT_ANGLES, 360]) {
    const diff = Math.abs(norm - angle);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = angle % 360;
    }
  }
  return best;
}

/**
 * Decides whether decoded symbols indicate an upright page. 2D symbols carry an
 * absolute orientation; linear barcodes only reveal their axis (a Code 128 reads
 * the same forwards and backwards), so for linear-only evidence "upright" means
 * the bars run horizontally (orientation 0 or 180).
 */
export function isUprightOrientation(symbols = []) {
  const twoD = symbols.filter(s => TWO_D_FORMATS.has(s.format));
  if (twoD.length) {
    return twoD.every(s => nearestRightAngle(s.orientation) === 0);
  }
  const linear = symbols.filter(s => Number.isFinite(s.orientation));
  if (!linear.length) return true;
  return linear.every(s => {
    const angle = nearestRightAngle(s.orientation);
    return angle === 0 || angle === 180;
  });
}

/**
 * Orders candidate canvas rotations (degrees, for rotateCanvas) most-likely-first.
 * The caller applies each to a downscaled probe and re-decodes to verify, so the
 * decoder's angle sign convention does not need to be assumed here.
 */
export function pickRotationCandidates(symbols = []) {
  const twoD = symbols.filter(s => TWO_D_FORMATS.has(s.format) && Number.isFinite(s.orientation));
  if (twoD.length) {
    const counts = new Map();
    for (const s of twoD) {
      const angle = nearestRightAngle(s.orientation);
      counts.set(angle, (counts.get(angle) || 0) + 1);
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (dominant === 0) return [];
    const inverse = (360 - dominant) % 360;
    return dominant === 180 ? [180] : [inverse, dominant];
  }
  const linear = symbols.filter(s => Number.isFinite(s.orientation));
  if (!linear.length) return [];
  const vertical = linear.some(s => {
    const angle = nearestRightAngle(s.orientation);
    return angle === 90 || angle === 270;
  });
  return vertical ? [90, 270] : [];
}

function inkProfile(lum, width, height, region, axis, inkThreshold) {
  const length = axis === 'y' ? region.h : region.w;
  const breadth = axis === 'y' ? region.w : region.h;
  const profile = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    let ink = 0;
    for (let j = 0; j < breadth; j += 1) {
      const x = axis === 'y' ? region.x + j : region.x + i;
      const y = axis === 'y' ? region.y + i : region.y + j;
      if (lum[y * width + x] < inkThreshold) ink += 1;
    }
    profile[i] = ink / breadth;
  }
  return profile;
}

function findGutters(profile, options) {
  const { maxInkFrac, minGutterPx, edgeMarginPx } = options;
  const gutters = [];
  let runStart = -1;
  for (let i = 0; i <= profile.length; i += 1) {
    const blank = i < profile.length && profile[i] <= maxInkFrac;
    if (blank && runStart < 0) runStart = i;
    if (!blank && runStart >= 0) {
      const runEnd = i;
      const interiorStart = Math.max(runStart, edgeMarginPx);
      const interiorEnd = Math.min(runEnd, profile.length - edgeMarginPx);
      if (interiorEnd - interiorStart >= minGutterPx) {
        gutters.push(Math.round((interiorStart + interiorEnd) / 2));
      }
      runStart = -1;
    }
  }
  return gutters;
}

function inkBounds(lum, width, height, region, inkThreshold) {
  let minX = region.x + region.w;
  let minY = region.y + region.h;
  let maxX = region.x - 1;
  let maxY = region.y - 1;
  let inkCount = 0;
  for (let y = region.y; y < region.y + region.h; y += 1) {
    for (let x = region.x; x < region.x + region.w; x += 1) {
      if (lum[y * width + x] < inkThreshold) {
        inkCount += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, inkCount };
}

/**
 * Finds label regions on a sheet that carries more than one label (e.g. an A4
 * page with 2 or 4 labels). Recursively splits the page at white gutters that
 * fully cross the content, then keeps splits only when every resulting region
 * still looks like a label (substantial ink share, label-like aspect ratio).
 *
 * `lum` is a row-major Uint8 luminance array for a DOWNSCALED page. Returns
 * regions as fractions of the page ({x, y, w, h} in 0..1), or [] when the page
 * should be treated as a single label.
 */
export function findLabelRegions(lum, width, height, opts = {}) {
  const inkThreshold = opts.inkThreshold ?? 200;
  const maxDepth = opts.maxDepth ?? 2;
  const maxInkFrac = opts.maxInkFrac ?? 0.004;
  const minGutterFrac = opts.minGutterFrac ?? 0.02;
  const edgeMarginFrac = opts.edgeMarginFrac ?? 0.08;
  const minRegionFrac = opts.minRegionFrac ?? 0.24;
  const minAspect = opts.minAspect ?? 0.4;
  const maxAspect = opts.maxAspect ?? 2.6;
  const minInkShare = opts.minInkShare ?? 0.08;

  // Trim outer blank margins first so gutter and child-size thresholds are
  // measured against the printed content, not the sheet.
  const pageBounds = inkBounds(lum, width, height, { x: 0, y: 0, w: width, h: height }, inkThreshold);
  if (!pageBounds || !pageBounds.inkCount) return [];
  const totalInk = pageBounds.inkCount;
  const page = { x: pageBounds.x, y: pageBounds.y, w: pageBounds.w, h: pageBounds.h };

  const leaves = [];
  const splitRegion = (region, depth) => {
    if (depth < maxDepth) {
      for (const axis of region.h >= region.w ? ['y', 'x'] : ['x', 'y']) {
        const length = axis === 'y' ? region.h : region.w;
        const profile = inkProfile(lum, width, height, region, axis, inkThreshold);
        const gutters = findGutters(profile, {
          maxInkFrac,
          minGutterPx: Math.max(3, Math.round(length * minGutterFrac)),
          edgeMarginPx: Math.max(2, Math.round(length * edgeMarginFrac))
        });
        if (!gutters.length) continue;
        const cuts = [0, ...gutters, length];
        const children = [];
        let valid = true;
        for (let i = 0; i < cuts.length - 1; i += 1) {
          const size = cuts[i + 1] - cuts[i];
          if (size < length * minRegionFrac) {
            valid = false;
            break;
          }
          children.push(axis === 'y'
            ? { x: region.x, y: region.y + cuts[i], w: region.w, h: size }
            : { x: region.x + cuts[i], y: region.y, w: size, h: region.h });
        }
        if (!valid) continue;
        for (const child of children) splitRegion(child, depth + 1);
        return;
      }
    }
    leaves.push(region);
  };
  splitRegion(page, 0);

  if (leaves.length < 2) return [];

  const trimmed = [];
  for (const leaf of leaves) {
    const bounds = inkBounds(lum, width, height, leaf, inkThreshold);
    if (!bounds) continue;
    if (bounds.inkCount / totalInk < minInkShare) continue;
    const aspect = bounds.w / bounds.h;
    if (aspect < minAspect || aspect > maxAspect) return [];
    trimmed.push(bounds);
  }
  if (trimmed.length < 2) return [];

  return trimmed.map(b => ({
    x: b.x / width,
    y: b.y / height,
    w: b.w / width,
    h: b.h / height
  }));
}
