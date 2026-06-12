// Label preview images and per-barcode evidence crops for the report UI.
import { STARTRACK_LABEL_CODE_MAP } from '../auditEngine.js';
import { FORMAT_KIND, isDataMatrixBarcode, isLinearBarcode, isQrBarcode } from './barcodeTypes.js';
import {
  BARCODE_BOX_MARGIN_PX,
  PREVIEW_BARCODE_BOX_MARGIN_PX,
  clampBox,
  expandBox,
  cropCanvas,
  canvasToDataUrl
} from './canvasUtils.js';

export const STARTRACK_PREVIEW_BOXES = {
  atl: { x: 0.56, y: 0.05, w: 0.38, h: 0.1, label: 'ATL zone' },
  routing: { x: 0.04, y: 0.4, w: 0.6, h: 0.2, label: 'Routing zone' },
  freight: { x: 0.07, y: 0.78, w: 0.86, h: 0.16, label: 'Freight zone' }
};

export const STARTRACK_LINEAR_TARGETS = {
  atl: { x: 0.52, y: 0.02, w: 0.46, h: 0.16 },
  routing: { x: 0.03, y: 0.36, w: 0.62, h: 0.25 },
  freight: { x: 0.03, y: 0.74, w: 0.94, h: 0.2 },
  sweep: { x: 0.02, y: 0.36, w: 0.96, h: 0.58 }
};

export function normalizeBarcodeValueForRole(value) {
  return String(value || '')
    .replace(/[()\s]/g, '')
    .trim()
    .toUpperCase();
}

export function isStarTrackFreightItemValue(value) {
  const v = normalizeBarcodeValueForRole(value);
  return /^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(v) || /^00\d{18}$/.test(v);
}

export function isStarTrackAtlValue(value) {
  const v = normalizeBarcodeValueForRole(value);
  return /^C\d{9}$/.test(v);
}

export function isStarTrackRoutingValue(value) {
  const v = normalizeBarcodeValueForRole(value);
  const route = v.match(/^([A-Z0-9]{3})\d{4}[A-Z0-9]{2,3}$/);
  const gs1Route = v.match(/^421036\d{4}403([A-Z0-9]{3})$/);
  return Boolean((route && STARTRACK_LABEL_CODE_MAP[route[1]]) || (gs1Route && STARTRACK_LABEL_CODE_MAP[gs1Route[1]]));
}

/** Returns the user-facing barcode type label used in captions and report sections. */
export function barcodeKindLabel(b) {
  if (isDataMatrixBarcode(b)) return 'GS1 DataMatrix';
  if (isQrBarcode(b)) return 'QR Barcode';
  if (isLinearBarcode(b)) return 'Linear Barcode';
  return b?.format || 'Barcode';
}

export function cropForDecodedBarcode(canvas, barcodes, kind) {
  const list = barcodes.filter(
    b =>
      b.pageBoundingBox &&
      (kind === FORMAT_KIND.datamatrix
        ? isDataMatrixBarcode(b)
        : kind === FORMAT_KIND.qr
          ? isQrBarcode(b)
          : isLinearBarcode(b) && !isDataMatrixBarcode(b) && !isQrBarcode(b))
  );
  if (!list.length) return null;
  // Use the read with page coordinates because this crop is shown as evidence, not
  // just as a convenience image.
  const chosen = list.find(b => b.locationQuality === 'decoded-symbol-bounding-box') || list[0];
  const box = expandBox(chosen.pageBoundingBox, canvas.width, canvas.height, BARCODE_BOX_MARGIN_PX);
  if (!box) return null;
  return {
    canvas: cropCanvas(canvas, box.x, box.y, box.width, box.height),
    box,
    barcode: chosen
  };
}

export function cropForDecodedBarcodeMatch(canvas, barcodes, predicate, marginPx = BARCODE_BOX_MARGIN_PX) {
  const list = (barcodes || []).filter(b => b.pageBoundingBox && predicate(b));
  if (!list.length) return null;
  const chosen = list.find(b => b.locationQuality === 'decoded-symbol-bounding-box') || list[0];
  const box = expandBox(chosen.pageBoundingBox, canvas.width, canvas.height, marginPx);
  if (!box) return null;
  return {
    canvas: cropCanvas(canvas, box.x, box.y, box.width, box.height),
    box,
    barcode: chosen
  };
}

export function relativeCanvasBox(canvas, spec) {
  return clampBox(
    {
      x: Math.round(canvas.width * spec.x),
      y: Math.round(canvas.height * spec.y),
      width: Math.round(canvas.width * spec.w),
      height: Math.round(canvas.height * spec.h)
    },
    canvas.width,
    canvas.height
  );
}

export function buildStarTrackPreviewCandidateBoxes(canvas, detectedBarcodes = []) {
  const hasRouting = detectedBarcodes.some(b => isLinearBarcode(b) && isStarTrackRoutingValue(b.rawValue));
  const hasAtl = detectedBarcodes.some(b => isLinearBarcode(b) && isStarTrackAtlValue(b.rawValue));
  const hasFreight = detectedBarcodes.some(b => isLinearBarcode(b) && isStarTrackFreightItemValue(b.rawValue));
  return [
    !hasAtl
      ? { label: STARTRACK_PREVIEW_BOXES.atl.label, box: relativeCanvasBox(canvas, STARTRACK_PREVIEW_BOXES.atl) }
      : null,
    !hasRouting
      ? {
          label: STARTRACK_PREVIEW_BOXES.routing.label,
          box: relativeCanvasBox(canvas, STARTRACK_PREVIEW_BOXES.routing)
        }
      : null,
    !hasFreight
      ? {
          label: STARTRACK_PREVIEW_BOXES.freight.label,
          box: relativeCanvasBox(canvas, STARTRACK_PREVIEW_BOXES.freight)
        }
      : null
  ].filter(Boolean);
}

export function drawPreviewBarcodeBox(ctx, scale, outputWidth, box, label, style) {
  const x = box.x * scale;
  const y = box.y * scale;
  const width = box.width * scale;
  const height = box.height * scale;
  const labelHeight = Math.max(18, 22 * scale);
  const textWidth = Math.min(outputWidth, ctx.measureText(label).width + 12);
  const labelX = Math.min(Math.max(0, x), Math.max(0, outputWidth - textWidth));
  const labelY = Math.max(0, y - Math.max(20, labelHeight));

  ctx.save();
  ctx.lineWidth = style.lineWidth;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.fill;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  ctx.fillStyle = style.labelFill;
  ctx.fillRect(labelX, labelY, textWidth, labelHeight);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, labelX + 6, labelY + Math.max(13, 16 * scale));
  ctx.restore();
}

export function canvasToDataUrlWithBarcodeBoxes(sourceCanvas, barcodes = [], maxWidth = 820, candidateBoxes = []) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return '';
  const scale = Math.min(1, maxWidth / sourceCanvas.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);

  ctx.font = `${Math.max(12, Math.round(18 * scale))}px Segoe UI, Arial, sans-serif`;
  for (const candidate of candidateBoxes) {
    drawPreviewBarcodeBox(ctx, scale, out.width, candidate.box, candidate.label, {
      stroke: '#9a5a00',
      fill: 'rgba(154,90,0,.08)',
      labelFill: '#9a5a00',
      lineWidth: Math.max(2, Math.round(3 * scale)),
      dash: [Math.max(5, 7 * scale), Math.max(4, 5 * scale)]
    });
  }

  const located = barcodes.filter(b => b.pageBoundingBox);
  for (const b of located) {
    const box = expandBox(b.pageBoundingBox, sourceCanvas.width, sourceCanvas.height, PREVIEW_BARCODE_BOX_MARGIN_PX);
    if (!box) continue;
    const isDm = isDataMatrixBarcode(b);
    const isQr = isQrBarcode(b);
    drawPreviewBarcodeBox(ctx, scale, out.width, box, barcodeKindLabel(b), {
      stroke: isDm || isQr ? '#0b5cad' : '#c40018',
      fill: isDm || isQr ? 'rgba(11,92,173,.12)' : 'rgba(196,0,24,.10)',
      labelFill: isDm || isQr ? '#0b5cad' : '#c40018',
      lineWidth: Math.max(3, Math.round(4 * scale))
    });
  }
  return out.toDataURL('image/jpeg', 0.88);
}

export function createLabelImages(canvas, detectedBarcodes = [], labelFamily = 'eparcel') {
  const w = canvas.width;
  const h = canvas.height;
  const dmLocated = cropForDecodedBarcode(canvas, detectedBarcodes, FORMAT_KIND.datamatrix);
  const qrLocated = cropForDecodedBarcode(canvas, detectedBarcodes, FORMAT_KIND.qr);
  const linearLocated = cropForDecodedBarcode(canvas, detectedBarcodes, FORMAT_KIND.linear);
  const starTrackRoutingLocated = cropForDecodedBarcodeMatch(
    canvas,
    detectedBarcodes,
    b => isLinearBarcode(b) && !isQrBarcode(b) && !isDataMatrixBarcode(b) && isStarTrackRoutingValue(b.rawValue)
  );
  const starTrackAtlLocated = cropForDecodedBarcodeMatch(
    canvas,
    detectedBarcodes,
    b => isLinearBarcode(b) && !isQrBarcode(b) && !isDataMatrixBarcode(b) && isStarTrackAtlValue(b.rawValue)
  );
  const starTrackFreightLocated = cropForDecodedBarcodeMatch(
    canvas,
    detectedBarcodes,
    b => isLinearBarcode(b) && !isQrBarcode(b) && !isDataMatrixBarcode(b) && isStarTrackFreightItemValue(b.rawValue)
  );

  // Fixed template crops are fallback evidence only. If a barcode decoded with a real
  // page box, prefer that because label layouts can shift between products/customers.
  const st = STARTRACK_LINEAR_TARGETS;
  const dmCrop = cropCanvas(canvas, w * 0.55, h * 0.02, w * 0.43, h * 0.31);
  const dmFocusedCrop = cropCanvas(canvas, w * 0.72, h * 0.07, w * 0.26, h * 0.22);
  const qrCrop = cropCanvas(canvas, w * 0.35, h * 0.1, w * 0.6, h * 0.55);
  const linearCrop = cropCanvas(canvas, w * st.sweep.x, h * st.sweep.y, w * st.sweep.w, h * st.sweep.h);
  const rightLinearCrop = cropCanvas(canvas, w * 0.68, h * 0.18, w * 0.31, h * 0.68);
  const starTrackRoutingCrop = cropCanvas(
    canvas,
    w * st.routing.x,
    h * st.routing.y,
    w * st.routing.w,
    h * st.routing.h
  );
  const starTrackAtlCrop = cropCanvas(canvas, w * st.atl.x, h * st.atl.y, w * st.atl.w, h * st.atl.h);
  const starTrackFreightCrop = cropCanvas(
    canvas,
    w * st.freight.x,
    h * st.freight.y,
    w * st.freight.w,
    h * st.freight.h
  );
  const previewCandidateBoxes =
    labelFamily === 'startrack' ? buildStarTrackPreviewCandidateBoxes(canvas, detectedBarcodes) : [];

  return {
    labelPreviewPlain: canvasToDataUrl(canvas, 760),
    labelPreview: canvasToDataUrlWithBarcodeBoxes(canvas, detectedBarcodes, 820, previewCandidateBoxes),
    dataMatrixCrop: canvasToDataUrl(dmLocated?.canvas || dmCrop, 420),
    dataMatrixFocusedCrop: canvasToDataUrl(dmLocated?.canvas || dmFocusedCrop, 320),
    dataMatrixBox: dmLocated?.box || null,
    dataMatrixBoxSource: dmLocated?.barcode
      ? `${dmLocated.barcode.source || 'scanner'} · ${dmLocated.barcode.regionLabel || ''} · ${dmLocated.barcode.variantLabel || ''}`
      : 'fallback heuristic crop only',
    qrBarcodeCrop: canvasToDataUrl(qrLocated?.canvas || qrCrop, 420),
    qrBarcodeBox: qrLocated?.box || null,
    qrBarcodeBoxSource: qrLocated?.barcode
      ? `${qrLocated.barcode.source || 'scanner'} · ${qrLocated.barcode.regionLabel || ''} · ${qrLocated.barcode.variantLabel || ''}`
      : 'fallback heuristic crop only',
    linearBarcodeCrop: canvasToDataUrl(linearLocated?.canvas || linearCrop, 780),
    rightLinearBarcodeCrop: canvasToDataUrl(linearLocated?.canvas || rightLinearCrop, 420),
    linearBarcodeBox: linearLocated?.box || null,
    linearBarcodeBoxSource: linearLocated?.barcode
      ? `${linearLocated.barcode.source || 'scanner'} · ${linearLocated.barcode.regionLabel || ''} · ${linearLocated.barcode.variantLabel || ''}`
      : 'fallback heuristic crop only',
    routingBarcodeCrop: canvasToDataUrl(starTrackRoutingLocated?.canvas || starTrackRoutingCrop, 620),
    routingBarcodeBox: starTrackRoutingLocated?.box || null,
    routingBarcodeBoxSource: starTrackRoutingLocated?.barcode
      ? `${starTrackRoutingLocated.barcode.source || 'scanner'} · ${starTrackRoutingLocated.barcode.regionLabel || ''} · ${starTrackRoutingLocated.barcode.variantLabel || ''}`
      : 'fallback heuristic crop only',
    atlBarcodeCrop: canvasToDataUrl(starTrackAtlLocated?.canvas || starTrackAtlCrop, 620),
    atlBarcodeBox: starTrackAtlLocated?.box || null,
    atlBarcodeBoxSource: starTrackAtlLocated?.barcode
      ? `${starTrackAtlLocated.barcode.source || 'scanner'} Â· ${starTrackAtlLocated.barcode.regionLabel || ''} Â· ${starTrackAtlLocated.barcode.variantLabel || ''}`
      : 'fallback heuristic crop only',
    freightBarcodeCrop: canvasToDataUrl(starTrackFreightLocated?.canvas || starTrackFreightCrop, 780),
    freightBarcodeBox: starTrackFreightLocated?.box || null,
    freightBarcodeBoxSource: starTrackFreightLocated?.barcode
      ? `${starTrackFreightLocated.barcode.source || 'scanner'} · ${starTrackFreightLocated.barcode.regionLabel || ''} · ${starTrackFreightLocated.barcode.variantLabel || ''}`
      : 'fallback heuristic crop only'
  };
}
