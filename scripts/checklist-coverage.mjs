// Validation coverage: compares the INTENDED checklist (docs/checklists/intended-checklist.json,
// transcribed from the carrier specifications) against the ACTUAL rules the engine ships
// (the merged JSON rule sets in /rules). Prints required-vs-actual coverage per label type and
// flags drift. Run: npm run checklist  (add --json to write a machine-readable report).
//
// Exit codes: 0 = consistent; 1 = drift detected (a live rule is not declared in the manifest,
// or a manifest requirement claims a rule that the engine no longer ships). Documented gaps
// (requirements with no implementing rule) never fail the build - they are the backlog.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuleSet } from '../rules/index.js';
import { resolveRuleSetTemplates } from '../src/ruleEngine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'docs/checklists/intended-checklist.json');

// The four auditable label types map onto the engine's rule-set variants. A "standard"
// label resolves to one of several product variants at audit time, so the actual rule
// surface for a column is the union of its variants' rules.
const LABEL_TYPE_VARIANTS = {
  EPS: { carrier: 'eparcel', variants: ['parcel-post', 'express-post', 'returns'] },
  ESS: { carrier: 'eparcel', variants: ['sscc'] },
  STS: { carrier: 'startrack', variants: ['premium', 'express', 'fpp'] },
  SSS: { carrier: 'startrack', variants: ['sscc'] }
};

/** Live rule ids the engine ships for each label-type column (union across product variants). */
function actualRuleIdsByLabelType() {
  const out = {};
  for (const [lt, { carrier, variants }] of Object.entries(LABEL_TYPE_VARIANTS)) {
    const ids = new Set();
    for (const v of variants) {
      const rs = resolveRuleSetTemplates(getRuleSet(carrier, v));
      for (const r of rs.rules || []) if (!r.disabled) ids.add(r.id);
    }
    out[lt] = ids;
  }
  return out;
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function statusFor(req, actualIds) {
  // Some requirements are satisfied outside the JSON rule sets (payload comparison,
  // expected-SSCC prefix matching, visible-text extraction) - declared with source "code".
  if (req.source === 'code') return req.partial ? 'partial' : 'implemented';
  const by = req.implementedBy || [];
  if (by.length === 0) return 'gap';
  const present = by.filter(id => actualIds.has(id));
  if (present.length === 0) return 'missing'; // declared but not shipped -> drift
  if (present.length < by.length || req.partial) return 'partial';
  return 'implemented';
}

function main() {
  const wantJson = process.argv.includes('--json');
  const manifest = loadManifest();
  const reqs = manifest.requirements || [];
  const actual = actualRuleIdsByLabelType();

  // Every rule id the manifest knows about (so we can detect engine rules nobody declared).
  const declared = new Set();
  for (const r of reqs) for (const id of r.implementedBy || []) declared.add(id);

  const report = { generatedAt: new Date().toISOString(), labelTypes: {}, drift: { unmapped: [], missing: [] } };
  let drift = false;

  for (const [lt, ids] of Object.entries(actual)) {
    const applicable = reqs.filter(r => (r.labelTypes || []).includes(lt));
    const counts = { implemented: 0, partial: 0, gap: 0, missing: 0 };
    const gaps = [];
    for (const req of applicable) {
      const st = statusFor(req, ids);
      counts[st] += 1;
      if (st === 'gap' || st === 'partial') gaps.push({ id: req.id, status: st, obligation: req.obligation, audit: req.audit, title: req.title });
      if (st === 'missing') report.drift.missing.push({ labelType: lt, id: req.id, implementedBy: req.implementedBy });
    }
    // Live rules that no requirement declares -> the manifest has drifted behind the engine.
    const unmapped = [...ids].filter(id => !declared.has(id)).sort();
    if (unmapped.length) report.drift.unmapped.push({ labelType: lt, ruleIds: unmapped });
    report.labelTypes[lt] = { total: applicable.length, ...counts, gaps };
  }

  if (report.drift.unmapped.length || report.drift.missing.length) drift = true;

  if (wantJson) {
    const outPath = path.join(ROOT, 'docs/checklists/coverage-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Wrote ${path.relative(ROOT, outPath)}`);
  }

  const name = { EPS: 'eParcel Standard', ESS: 'eParcel SSCC', STS: 'StarTrack Standard', SSS: 'StarTrack SSCC' };
  console.log('\nValidation coverage — intended (spec) vs actual (engine rules)\n');
  for (const [lt, r] of Object.entries(report.labelTypes)) {
    const pct = r.total ? Math.round((r.implemented / r.total) * 100) : 0;
    console.log(`${name[lt].padEnd(20)} ${r.implemented}/${r.total} implemented (${pct}%)  partial ${r.partial}  gap ${r.gap}${r.missing ? `  MISSING ${r.missing}` : ''}`);
  }

  console.log('\nOutstanding per label type (partial + gap):');
  for (const [lt, r] of Object.entries(report.labelTypes)) {
    if (!r.gaps.length) continue;
    console.log(`\n  ${name[lt]}:`);
    for (const g of r.gaps) console.log(`    [${g.status.padEnd(11)}] ${(g.id || '').padEnd(14)} ${(g.obligation || '').padEnd(4)} ${(g.audit || '').padEnd(8)} ${g.title}`);
  }

  if (drift) {
    console.log('\nDRIFT DETECTED:');
    for (const u of report.drift.unmapped) console.log(`  ${u.labelType}: engine ships rules not in the manifest -> ${u.ruleIds.join(', ')}`);
    for (const m of report.drift.missing) console.log(`  ${m.labelType}: manifest claims ${m.id} via ${m.implementedBy.join('/')} but the engine no longer ships it`);
    console.log('\nUpdate docs/checklists/intended-checklist.json so intended and actual agree.');
    process.exit(1);
  }
  console.log('\nNo drift: every shipped rule is accounted for in the intended checklist.');
}

main();
