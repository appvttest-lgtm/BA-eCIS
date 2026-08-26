// Tests the spec citation chain end to end: rule -> documents registry -> report line.
// Rules cite documents by short code; the resolved result must carry the full document
// title and version, and the report formatter must render them for the Validation rule pane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRuleSource } from '../src/audit/ruleSource.js';
import { resolveRuleSource } from '../src/ruleEngine.js';
import { getRuleSet } from '../rules/index.js';

test('formatRuleSource renders title, version, page and ref', () => {
  assert.equal(
    formatRuleSource({
      doc: 'PP&EP v1.4',
      title: 'Parcel Post and Express Post - Label & Barcode Specification',
      version: 'v1.4',
      page: 14
    }),
    'Parcel Post and Express Post - Label & Barcode Specification v1.4 · p14'
  );
  assert.equal(
    formatRuleSource({ doc: 'MOS v9', title: 'StarTrack MOS', version: 'v9', ref: '1.009' }),
    'StarTrack MOS v9 · 1.009'
  );
  assert.equal(
    formatRuleSource({ doc: 'Short code only', page: 3 }),
    'Short code only · p3',
    'falls back to the short doc code'
  );
  assert.equal(formatRuleSource(null), '');
});

test('every carrier rule set resolves its citations to a full title and version', () => {
  const eparcel = getRuleSet('eparcel', 'base');
  const mlidRule = eparcel.rules.find(r => r.id === 'EP-ART-02');
  const resolved = resolveRuleSource(mlidRule, eparcel);
  assert.equal(resolved.title, 'Parcel Post and Express Post - Label & Barcode Specification');
  assert.equal(resolved.version, 'v1.4');
  assert.equal(resolved.date, '2025-06-05');
  assert.equal(resolved.page, 6);
  assert.equal(formatRuleSource(resolved), 'Parcel Post and Express Post - Label & Barcode Specification v1.4 · p6');

  const startrack = getRuleSet('startrack', 'base');
  const headerRule = startrack.rules.find(r => r.id === 'ST-HDR-01');
  const startrackResolved = resolveRuleSource(headerRule, startrack);
  assert.equal(startrackResolved.title, 'StarTrack Label Specifications - Modify Your Own System (MOS)');
  assert.equal(startrackResolved.version, 'v9');
});

test('variant rule sets keep base documents and add their own (Metro)', () => {
  const metro = getRuleSet('eparcel', 'metro');
  const metroRule = metro.rules.find(r => r.id === 'EP-MET-01');
  const metroResolved = resolveRuleSource(metroRule, metro);
  assert.equal(metroResolved.title, 'Australia Post Metro Service Integration Specification');
  assert.equal(metroResolved.version, 'V2.0');

  const inheritedRule = metro.rules.find(r => r.id === 'EP-ART-02');
  const inheritedResolved = resolveRuleSource(inheritedRule, metro);
  assert.equal(inheritedResolved.version, 'v1.4', 'base document registry survives the variant merge');
});
