// Shared audit plumbing between the rule engine and the carrier packs:
// the validation-row shape, audit-mode checks, decoded-value helpers, the
// overall summary, page geometry, and the carrier-agnostic rule functions.
import { applyNormalize, registerRuleFunction, resolvePath } from '../../ruleEngine.js';

/** Creates one normalized validation row consumed by both the React UI and exported HTML. */
export function result(id, title, severity, category, status, message, extra = {}) {
  return { id, title, severity, category, status, message, ...extra };
}

export function normalizeLabelFormat(value) {
  return value === 'sscc' ? 'sscc' : 'standard';
}

function labelFormatName(format) {
  return normalizeLabelFormat(format) === 'sscc' ? 'SSCC article identifier' : 'Standard article format';
}

function carrierName(carrier) {
  if (carrier === 'unknown') return 'unknown';
  return carrier === 'startrack' ? 'StarTrack' : 'eParcel';
}

export function validateSelectedAuditMode({
  selectedCarrier = 'eparcel',
  selectedFormat = 'standard',
  detectedCarrier = 'unknown',
  detectedFormat = 'unknown',
  evidence = ''
}) {
  const validations = [];
  validations.push(
    detectedCarrier === selectedCarrier
      ? result(
          'AUDIT_MODE_CARRIER',
          'Selected carrier matches label evidence',
          'CRITICAL',
          'audit-mode',
          'pass',
          `${carrierName(selectedCarrier)} was selected and label evidence matches.`,
          { expected: carrierName(selectedCarrier), actual: carrierName(detectedCarrier), evidence }
        )
      : result(
          'AUDIT_MODE_CARRIER',
          'Selected carrier matches label evidence',
          'CRITICAL',
          'audit-mode',
          'fail',
          `${carrierName(selectedCarrier)} was selected, but decoded/text evidence indicates ${carrierName(detectedCarrier)}.`,
          {
            expected: carrierName(selectedCarrier),
            actual: detectedCarrier === 'unknown' ? 'unknown' : carrierName(detectedCarrier),
            evidence
          }
        )
  );
  validations.push(
    detectedFormat === selectedFormat
      ? result(
          'AUDIT_MODE_FORMAT',
          'Selected label format matches barcode evidence',
          'CRITICAL',
          'audit-mode',
          'pass',
          `${labelFormatName(selectedFormat)} was selected and decoded barcode evidence matches.`,
          { expected: labelFormatName(selectedFormat), actual: labelFormatName(detectedFormat), evidence }
        )
      : result(
          'AUDIT_MODE_FORMAT',
          'Selected label format matches barcode evidence',
          'CRITICAL',
          'audit-mode',
          'fail',
          `${labelFormatName(selectedFormat)} was selected, but decoded barcode evidence indicates ${detectedFormat === 'unknown' ? 'unknown format' : labelFormatName(detectedFormat)}.`,
          {
            expected: labelFormatName(selectedFormat),
            actual: detectedFormat === 'unknown' ? 'unknown' : labelFormatName(detectedFormat),
            evidence
          }
        )
  );
  return validations;
}

export function decodedRawValues(detectedBarcodes) {
  return detectedBarcodes.map(b => b.rawValue || b.raw || b.text || '').filter(Boolean);
}

// Manual entries are useful for investigation counts, but never substitute for decoded barcode proof.
export function diagnosticManualValues(manualBarcodes) {
  return String(manualBarcodes || '')
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);
}

export function summarizeValidations(validations) {
  const summary = {
    overallStatus: 'PASS',
    total: validations.length,
    critical: 0,
    errors: 0,
    warnings: 0,
    manualReview: 0,
    failed: 0,
    passed: 0
  };
  for (const validation of validations) {
    if (validation.severity === 'CRITICAL') summary.critical += 1;
    if (validation.severity === 'ERROR') summary.errors += 1;
    if (validation.severity === 'WARNING') summary.warnings += 1;
    if (validation.status === 'manual_review') summary.manualReview += 1;
    if (validation.status === 'fail') summary.failed += 1;
    if (validation.status === 'pass') summary.passed += 1;
    if (validation.status === 'fail' && (validation.severity === 'CRITICAL' || validation.severity === 'ERROR')) {
      summary.overallStatus = 'FAIL';
    } else if (
      summary.overallStatus !== 'FAIL' &&
      (validation.status === 'warning' || validation.status === 'manual_review')
    ) {
      summary.overallStatus = 'REVIEW';
    }
  }
  return summary;
}

registerRuleFunction('pageSizeWithin', (page, { args }) => {
  const widthMm = page?.widthMm;
  const heightMm = page?.heightMm;
  if (!widthMm || !heightMm) {
    return {
      pass: false,
      status: args?.unverifiedStatus || 'manual_review',
      message: 'Physical dimensions could not be determined from this file.'
    };
  }
  const tolerance = args?.toleranceMm ?? 5;
  const sizes = args?.sizesMm || [];
  const pass = sizes.some(
    ([w, h]) =>
      (Math.abs(widthMm - w) <= tolerance && Math.abs(heightMm - h) <= tolerance) ||
      (Math.abs(widthMm - h) <= tolerance && Math.abs(heightMm - w) <= tolerance)
  );
  return {
    pass,
    expected: `${sizes.map(([w, h]) => `${w}mm x ${h}mm`).join(' or ')} (within ${tolerance}mm, either orientation)`,
    actual: `${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm`
  };
});

registerRuleFunction('requiredDecode', (value, { context, args }) => {
  if (value === true) return { pass: true };
  const visible = args?.visiblePath ? Boolean(resolvePath(args.visiblePath, context)) : false;
  const page = context.page || {};
  const parts = [];
  parts.push(
    visible
      ? `${args?.label || 'The required barcode'} appears visible on the label, but it was not decoded by the scanner pipeline.`
      : `${args?.label || 'The required barcode'} was not decoded from the uploaded file.`
  );
  if (page.isRasterImage && page.estimatedDpi && page.estimatedDpi < MIN_LINEAR_DECODE_DPI) {
    parts.push(
      `The uploaded image is roughly ${page.estimatedDpi} DPI (${page.pixelWidth}x${page.pixelHeight}px). At this resolution the narrow bars and spaces of linear barcodes are usually destroyed and cannot be decoded. Upload the original PDF, or export the label image at 300 DPI or higher.`
    );
  }
  return { pass: false, message: parts.join(' ') };
});

registerRuleFunction('inPathList', (value, { context, item, args }) => {
  const raw = resolvePath(args?.path, context, item);
  const list = (Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw])
    .map(v => applyNormalize(v, args?.normalize))
    .filter(Boolean);
  if (!list.length) {
    return {
      pass: false,
      status: 'manual_review',
      expected: `a matching value in ${args?.path}`,
      actual: 'no comparison values available',
      message: `No values were available at ${args?.path} to compare against.`
    };
  }
  const needle = applyNormalize(value, args?.normalize);
  return { pass: list.includes(needle), expected: list.join(', '), actual: needle || 'missing' };
});

/** Page geometry context shared by both carriers, including raster-image DPI estimation. */
// Raster uploads carry no physical size: DPI is estimated against the standard
// 100mm short edge, and linear barcodes are typically unrecoverable below
// about 200 DPI (narrow bars collapse to under a pixel).
const ASSUMED_LABEL_SHORT_EDGE_MM = 100;
const MIN_LINEAR_DECODE_DPI = 200;

export function buildPageContext(fileInfo) {
  const pixelWidth = fileInfo?.pixelWidth || null;
  const pixelHeight = fileInfo?.pixelHeight || null;
  const isRasterImage = Boolean(pixelWidth && !fileInfo?.widthMm);
  // Raster uploads carry no physical size; estimate DPI by assuming the short
  // side is a standard 100mm label edge so low-resolution exports can be flagged.
  const estimatedDpi =
    isRasterImage && pixelWidth && pixelHeight
      ? Math.round(Math.min(pixelWidth, pixelHeight) / (ASSUMED_LABEL_SHORT_EDGE_MM / 25.4))
      : null;
  return {
    widthMm: fileInfo?.widthMm,
    heightMm: fileInfo?.heightMm,
    pageCount: fileInfo?.pageCount || 1,
    pixelWidth,
    pixelHeight,
    isRasterImage,
    estimatedDpi
  };
}
