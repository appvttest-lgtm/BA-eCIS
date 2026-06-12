// Barcode decode engines: native BarcodeDetector, ZXing-WASM and ZXing-JS.
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer
} from '@zxing/library';
import { readBarcodes as readWasmBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { FORMAT_KIND } from './barcodeTypes.js';
import { pointsToBox } from './canvasUtils.js';
import { debugWarn } from './debugLog.js';

prepareZXingModule({
  overrides: {
    locateFile: (filePath, prefix) => (filePath.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + filePath)
  }
});

// Decoder order matters for performance: native BarcodeDetector is cheap when present,
// ZXing-WASM is the primary cross-browser reader, and ZXing JS is kept as the last
// fallback for hard-to-read crops.
export const barcodeFormats = ['code_128', 'data_matrix', 'qr_code', 'pdf417', 'ean_13', 'ean_8'];

// ZXing and native browser scans use different format names. Normalizing them here
// keeps the audit engine and report renderer independent of the decoder that succeeded.
export const zxingFormatMap = new Map([
  [BarcodeFormat.CODE_128, 'code_128'],
  [BarcodeFormat.DATA_MATRIX, 'data_matrix'],
  [BarcodeFormat.QR_CODE, 'qr_code'],
  [BarcodeFormat.PDF_417, 'pdf417'],
  [BarcodeFormat.EAN_13, 'ean_13'],
  [BarcodeFormat.EAN_8, 'ean_8'],
  [BarcodeFormat.UPC_A, 'upc_a'],
  [BarcodeFormat.ITF, 'itf'],
  [BarcodeFormat.CODE_39, 'code_39'],
  [BarcodeFormat.CODE_93, 'code_93']
]);

export const DECODER_SOURCE = {
  browser: 'Browser BarcodeDetector',
  wasm: 'ZXing-WASM crop scanner',
  js: 'ZXing JS fallback'
};

/** Checks whether the current browser exposes the optional native BarcodeDetector API. */
export function canUseBarcodeDetector() {
  return 'BarcodeDetector' in window;
}

/** Creates a native detector when available; callers should continue with ZXing when this returns null. */
export async function createDetector() {
  if (!canUseBarcodeDetector()) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats?.();
    const formats = Array.isArray(supported) ? barcodeFormats.filter(f => supported.includes(f)) : barcodeFormats;
    if (formats.length === 0) return null;
    return new window.BarcodeDetector({ formats });
  } catch (_error) {
    try {
      return new window.BarcodeDetector({ formats: barcodeFormats });
    } catch (_error2) {
      return null;
    }
  }
}

/** Collapses duplicate barcode values while preserving the best available page-location evidence. */
export function dedupeBarcodes(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.rawValue) continue;
    const normalized = String(item.rawValue).replace(/\s+/g, '').trim();
    const key = `${item.format || 'unknown'}:${normalized}`;
    const clean = { ...item, rawValue: item.rawValue.trim?.() ?? item.rawValue };
    if (!map.has(key)) {
      map.set(key, clean);
      continue;
    }
    const existing = map.get(key);
    // A value can decode several times from different crops. Prefer the copy that can
    // prove where it came from on the original page, because that drives crop evidence.
    map.set(key, {
      ...existing,
      ...(!existing.pageBoundingBox && clean.pageBoundingBox ? { pageBoundingBox: clean.pageBoundingBox } : {}),
      ...(!existing.boundingBox && clean.boundingBox ? { boundingBox: clean.boundingBox } : {}),
      ...(!existing.locationQuality && clean.locationQuality ? { locationQuality: clean.locationQuality } : {}),
      ...(!existing.targetBox && clean.targetBox ? { targetBox: clean.targetBox } : {}),
      ...(existing.barCount == null && clean.barCount != null ? { barCount: clean.barCount } : {}),
      // Keep the source label that explains the successful location read in the UI.
      ...(clean.pageBoundingBox && !existing.pageBoundingBox
        ? {
            source: clean.source,
            regionLabel: clean.regionLabel,
            variantLabel: clean.variantLabel
          }
        : {})
    });
  }
  return [...map.values()];
}

/** Runs the native browser decoder against one rendered canvas region. */
export async function detectWithBrowserBarcodeDetector(canvas, detector, pageNumber = 1, regionLabel = 'full-page') {
  if (!detector) return [];
  try {
    const results = await detector.detect(canvas);
    return results.map((r, index) => ({
      rawValue: r.rawValue,
      format: r.format || 'unknown',
      source: DECODER_SOURCE.browser,
      pageNumber,
      index,
      regionLabel,
      boundingBox: r.boundingBox
        ? {
            x: Math.round(r.boundingBox.x),
            y: Math.round(r.boundingBox.y),
            width: Math.round(r.boundingBox.width),
            height: Math.round(r.boundingBox.height)
          }
        : null
    }));
  } catch (error) {
    debugWarn('BarcodeDetector failed on canvas', error);
    return [];
  }
}

/** Builds the pure-JS ZXing fallback reader for the requested symbologies. */
export function makeZxingReader(formats = ['Code128', 'DataMatrix']) {
  const formatMap = {
    Code128: BarcodeFormat.CODE_128,
    DataMatrix: BarcodeFormat.DATA_MATRIX,
    QRCode: BarcodeFormat.QR_CODE,
    PDF417: BarcodeFormat.PDF_417,
    EAN13: BarcodeFormat.EAN_13,
    EAN8: BarcodeFormat.EAN_8,
    UPCA: BarcodeFormat.UPC_A,
    ITF: BarcodeFormat.ITF,
    Code39: BarcodeFormat.CODE_39,
    Code93: BarcodeFormat.CODE_93
  };
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats.map(f => formatMap[f]).filter(Boolean));
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

/** Attempts one pure-JS ZXing decode and returns the same barcode shape used by other decoders. */
export function zxingDecodeCanvas(
  canvas,
  pageNumber = 1,
  regionLabel = 'full-page',
  formats = ['Code128', 'DataMatrix'],
  kind = FORMAT_KIND.mixed,
  variantLabel = 'original'
) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const luminanceSource = new RGBLuminanceSource(imageData.data, canvas.width, canvas.height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
    const reader = makeZxingReader(formats);
    const decoded = reader.decodeWithState ? reader.decodeWithState(bitmap) : reader.decode(bitmap);
    const format = zxingFormatMap.get(decoded.getBarcodeFormat()) || String(decoded.getBarcodeFormat());
    const points = decoded.getResultPoints?.() || [];
    return [
      {
        rawValue: decoded.getText(),
        format,
        kind,
        source: DECODER_SOURCE.js,
        pageNumber,
        index: 0,
        regionLabel,
        variantLabel,
        boundingBox: points.length ? pointsToBox(points) : null
      }
    ];
  } catch (_error) {
    return [];
  }
}

/** Runs ZXing-WASM, the primary decoder for reliable Code128/DataMatrix reads in local browsers. */
export async function wasmDecodeCanvas(
  canvas,
  pageNumber = 1,
  regionLabel = 'full-page',
  formats = ['Code128', 'DataMatrix'],
  kind = FORMAT_KIND.mixed,
  variantLabel = 'original',
  options = {}
) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const results = await readWasmBarcodes(imageData, {
      formats,
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      tryDenoise: kind === FORMAT_KIND.datamatrix,
      maxNumberOfSymbols: 0,
      minLineCount: kind === FORMAT_KIND.linear ? 1 : 2,
      textMode: 'HRI',
      binarizer: options.binarizer || 'LocalAverage',
      isPure: Boolean(options.isPure),
      returnErrors: false
    });
    return (results || [])
      .filter(r => r && r.text && r.isValid !== false)
      .map((r, index) => ({
        rawValue: r.text,
        format: r.format || r.symbology || 'unknown',
        symbology: r.symbology || '',
        source: DECODER_SOURCE.wasm,
        pageNumber,
        index,
        regionLabel,
        kind,
        variantLabel,
        orientation: r.orientation,
        symbologyIdentifier: r.symbologyIdentifier || '',
        boundingBox: r.position
          ? {
              x: Math.round(
                Math.min(
                  r.position.topLeft?.x ?? 0,
                  r.position.bottomLeft?.x ?? 0,
                  r.position.topRight?.x ?? 0,
                  r.position.bottomRight?.x ?? 0
                )
              ),
              y: Math.round(
                Math.min(
                  r.position.topLeft?.y ?? 0,
                  r.position.bottomLeft?.y ?? 0,
                  r.position.topRight?.y ?? 0,
                  r.position.bottomRight?.y ?? 0
                )
              ),
              width: Math.round(
                Math.max(
                  r.position.topLeft?.x ?? 0,
                  r.position.bottomLeft?.x ?? 0,
                  r.position.topRight?.x ?? 0,
                  r.position.bottomRight?.x ?? 0
                ) -
                  Math.min(
                    r.position.topLeft?.x ?? 0,
                    r.position.bottomLeft?.x ?? 0,
                    r.position.topRight?.x ?? 0,
                    r.position.bottomRight?.x ?? 0
                  )
              ),
              height: Math.round(
                Math.max(
                  r.position.topLeft?.y ?? 0,
                  r.position.bottomLeft?.y ?? 0,
                  r.position.topRight?.y ?? 0,
                  r.position.bottomRight?.y ?? 0
                ) -
                  Math.min(
                    r.position.topLeft?.y ?? 0,
                    r.position.bottomLeft?.y ?? 0,
                    r.position.topRight?.y ?? 0,
                    r.position.bottomRight?.y ?? 0
                  )
              )
            }
          : null
      }));
  } catch (error) {
    debugWarn('ZXing-WASM scan failed', regionLabel, variantLabel, error);
    return [];
  }
}
