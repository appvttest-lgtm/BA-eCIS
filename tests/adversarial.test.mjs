// Adversarial-input regression tests. Uploaded label content (PDF text
// layers, OCR output, decoded barcode payloads) and pasted Get Shipments
// payloads are attacker-controlled; these tests pin that hostile input fails
// gracefully: no crash, no catastrophic regex time, markup stays inert data.
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditLabel,
  extractLabelFacts,
  extractTextBarcodeCandidates,
  parseGs1DataMatrix,
  parseSsccBarcode,
  parseStarTrackQrBarcode
} from '../src/auditEngine.js';
import { attachApiPayloadComparison, parseApiPayloadText } from '../src/audit/payloadComparison.js';

// Generous budget: these inputs complete in single-digit milliseconds after the
// line-length caps; catastrophic backtracking would exceed this by orders of
// magnitude (the uncapped postcode regex took ~1s on a 40k-char line).
const TIME_BUDGET_MS = 5000;

function withinBudget(label, fn) {
  test(label, () => {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < TIME_BUDGET_MS, `took ${Math.round(elapsed)}ms (budget ${TIME_BUDGET_MS}ms)`);
  });
}

const HOSTILE_MARKUP = '<script>alert(1)</script>"><img src=x onerror=alert(2)> javascript:alert(3)';

// --- Hostile markup stays inert audit data ---

test('hostile markup in barcodes, text and filename audits without throwing', () => {
  const audit = auditLabel({
    carrier: 'eparcel',
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: { name: `${HOSTILE_MARKUP}.pdf`, widthMm: 150, heightMm: 100, pageCount: 1 },
    detectedBarcodes: [
      { rawValue: HOSTILE_MARKUP, format: 'code_128' },
      { rawValue: HOSTILE_MARKUP, format: 'data_matrix' }
    ],
    extractedText: ['TO:', HOSTILE_MARKUP, 'CHULLORA NSW 2190', `FROM: ${HOSTILE_MARKUP}`].join('\n')
  });
  assert.ok(Array.isArray(audit.validations) && audit.validations.length > 0, 'audit still produces validations');
  // Results must round-trip as plain serializable data: nothing executable.
  const serialized = JSON.stringify(audit.validations);
  assert.ok(serialized.length > 0);
});

test('hostile markup payload through identity-gated comparison does not throw', () => {
  const audit = auditLabel({
    carrier: 'eparcel',
    labelFamily: 'eparcel',
    labelFormat: 'standard',
    fileInfo: { name: 'label.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
    detectedBarcodes: [{ rawValue: '019931265099999891JDQ019457101000930308', format: 'code_128' }],
    extractedText: 'TO:\nCHULLORA NSW 2190'
  });
  attachApiPayloadComparison(audit, JSON.stringify({ articleId: HOSTILE_MARKUP, items: [{ note: HOSTILE_MARKUP }] }));
});

// --- Regex time budgets on pathological extracted text ---

withinBudget('postcode-shaped 40k-char line stays within time budget', () => {
  extractLabelFacts(`TO:\n${'A '.repeat(20000)}NSW`);
});

withinBudget('200k-char line and 120k digit run stay within time budget', () => {
  const text = ['TO:', 'A'.repeat(200000), '0'.repeat(120000)].join('\n');
  extractLabelFacts(text);
  extractTextBarcodeCandidates(text);
});

withinBudget('oversized barcode payloads through parsers stay within time budget', () => {
  parseGs1DataMatrix(`01${'9'.repeat(200000)}`);
  parseSsccBarcode(`00${'1'.repeat(200000)}`);
  parseStarTrackQrBarcode('X'.repeat(200000));
});

withinBudget('StarTrack audit with oversized extracted text stays within time budget', () => {
  auditLabel({
    carrier: 'startrack',
    labelFamily: 'startrack',
    labelFormat: 'standard',
    fileInfo: { name: 'big.pdf', widthMm: 150, heightMm: 100, pageCount: 1 },
    detectedBarcodes: [],
    extractedText: `${'CONNOTE '.repeat(10000)}\n${'Z '.repeat(20000)}QLD`
  });
});

// --- Pasted payload robustness ---

test('non-JSON garbage payload fails closed with a parse error', () => {
  const ctx = parseApiPayloadText('{{{{{ not json at all');
  assert.equal(ctx.provided, true);
  assert.ok(ctx.parseError, 'parseError is reported');
  assert.equal(ctx.flat.length, 0, 'no evidence extracted from unparseable payload');
});

test('deeply nested JSON payload does not overflow the stack', () => {
  const deep = `${'['.repeat(50000)}1${']'.repeat(50000)}`;
  const ctx = parseApiPayloadText(deep);
  assert.equal(ctx.provided, true);
  // Either parsed (flattened iteratively) or rejected by JSON.parse - both are
  // acceptable; an uncaught RangeError is not.
  assert.ok(ctx.parseError || ctx.flat.length >= 1);
});

withinBudget('multi-megabyte payload text stays within time budget', () => {
  parseApiPayloadText('x'.repeat(5_000_000));
});

test('payload flattening is capped to bound memory', () => {
  const wide = { items: Array.from({ length: 30000 }, (_, i) => i) };
  const ctx = parseApiPayloadText(JSON.stringify(wide));
  assert.ok(ctx.flat.length <= 20000, `flat entries capped, got ${ctx.flat.length}`);
});
