// Formats the resolved spec citation shown under "Validation rule" in the report.
// Kept out of the JSX so Node tests can exercise it directly.

/**
 * Renders a resolved rule source ({ title, version, page, ref, doc }) as the citation line,
 * e.g. "Parcel Post and Express Post - Label & Barcode Specification v1.4 · p14".
 * Sources are optional on rules; returns '' when there is nothing to cite.
 */
export function formatRuleSource(source) {
  if (!source) return '';
  const documentName = [source.title || source.doc, source.version].filter(Boolean).join(' ');
  return [documentName, source.page ? `p${source.page}` : null, source.ref || null].filter(Boolean).join(' · ');
}
