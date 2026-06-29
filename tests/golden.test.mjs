// Golden-corpus regression harness.
//
// Why this exists: ruleset selection is selection-driven (auditLabel routes on the
// chosen carrier/format) and barcode classification + parsing is heuristic. Under
// real, chaotic input that is exactly where accuracy silently slips - a parse that
// stops firing, a heuristic that re-buckets a barcode, a rule that quietly skips.
//
// This harness freezes known-correct behaviour at the auditLabel() boundary. For
// every tests/fixtures/<quadrant>/*.input.json it:
//   1. runs auditLabel and snapshots the per-rule OUTCOMES (id -> status), the
//      resolved rule set, the overall verdict and the summary counts;
//   2. compares that snapshot to a committed *.expected.json (deep equal). Any rule
//      that changes status OR silently stops firing (its key disappears) fails here;
//   3. checks the declared intent of the fixture (expect / mustFire / mustPass /
//      mustNotPass) so a wrong-but-self-consistent snapshot is still caught;
//   4. checks the CORRECT ruleset was applied (carrier + format match the quadrant).
//
// Snapshots capture statuses, not message prose, so wording refactors don't churn
// the baselines - only changes in what the engine concludes do.
//
// First run (or after adding/altering fixtures): `npm run golden:update` to (re)write
// the *.expected.json baselines, then review the diff before committing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { auditLabel } from '../src/auditEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, 'fixtures');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

// The four standards the app must keep apart, plus the carrier/format each implies.
const QUADRANTS = {
  'eparcel-standard': { carrier: 'eparcel', labelFormat: 'standard' },
  'eparcel-sscc': { carrier: 'eparcel', labelFormat: 'sscc' },
  'startrack-standard': { carrier: 'startrack', labelFormat: 'standard' },
  'startrack-sscc': { carrier: 'startrack', labelFormat: 'sscc' }
};

function listDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** Discovers every fixture as { quadrant, name, inputPath, expectedPath, fixture }. */
function discoverFixtures() {
  const out = [];
  for (const quadrant of Object.keys(QUADRANTS)) {
    const dir = join(FIXTURE_ROOT, quadrant);
    for (const file of listDir(dir)) {
      if (!file.endsWith('.input.json')) continue;
      const inputPath = join(dir, file);
      if (!statSync(inputPath).isFile()) continue;
      const name = file.replace(/\.input\.json$/, '');
      out.push({
        quadrant,
        name,
        inputPath,
        expectedPath: join(dir, `${name}.expected.json`),
        fixture: JSON.parse(readFileSync(inputPath, 'utf8'))
      });
    }
  }
  return out;
}

/** Reduces an audit to a stable, outcome-only snapshot (no message prose). */
function snapshot(audit) {
  const results = {};
  for (const v of audit.validations || []) results[v.id] = v.status;
  const sortedResults = {};
  for (const id of Object.keys(results).sort()) sortedResults[id] = results[id];
  const s = audit.summary || {};
  return {
    carrier: audit.carrier ?? null,
    ruleSet: { id: audit.ruleSet?.id ?? null, variant: audit.ruleSet?.variant ?? null },
    overallStatus: s.overallStatus ?? null,
    counts: {
      total: s.total ?? 0,
      passed: s.passed ?? 0,
      failed: s.failed ?? 0,
      manualReview: s.manualReview ?? 0,
      critical: s.critical ?? 0,
      errors: s.errors ?? 0,
      warnings: s.warnings ?? 0
    },
    firedRuleCount: Object.keys(sortedResults).length,
    results: sortedResults
  };
}

/** Human-readable diff between two outcome snapshots, focused on the rule map. */
function diffSnapshots(expected, actual) {
  const lines = [];
  if (expected.overallStatus !== actual.overallStatus)
    lines.push(`overallStatus: expected ${expected.overallStatus}, got ${actual.overallStatus}`);
  if (expected.ruleSet?.variant !== actual.ruleSet?.variant)
    lines.push(`ruleSet.variant: expected ${expected.ruleSet?.variant}, got ${actual.ruleSet?.variant}`);
  const e = expected.results || {};
  const a = actual.results || {};
  for (const id of Object.keys(e)) {
    if (!(id in a)) lines.push(`- ${id} (${e[id]}) NO LONGER FIRES`);
    else if (e[id] !== a[id]) lines.push(`~ ${id}: expected ${e[id]}, got ${a[id]}`);
  }
  for (const id of Object.keys(a)) {
    if (!(id in e)) lines.push(`+ ${id} (${a[id]}) NEWLY FIRES`);
  }
  return lines.length ? lines.join('\n') : '(only count/metadata changed)';
}

const fixtures = discoverFixtures();

// Every standard must keep at least one fixture so a whole quadrant's coverage can
// never silently vanish.
for (const quadrant of Object.keys(QUADRANTS)) {
  test(`quadrant "${quadrant}" has at least one fixture`, () => {
    const count = fixtures.filter(f => f.quadrant === quadrant).length;
    assert.ok(count > 0, `No *.input.json fixtures found under tests/fixtures/${quadrant}/`);
  });
}

for (const f of fixtures) {
  const label = `${f.quadrant}/${f.name}`;
  const { input, noFail, expectFail, mustFire, mustPass, mustNotPass } = f.fixture;

  test(`${label}: audits and matches golden snapshot`, () => {
    assert.ok(input, `${f.inputPath} is missing an "input" object.`);
    const audit = auditLabel(input);
    const actual = snapshot(audit);

    // 1. Correct ruleset applied for this quadrant.
    const expectedRoute = QUADRANTS[f.quadrant];
    assert.equal(
      audit.carrier,
      expectedRoute.carrier,
      `${label}: expected carrier ${expectedRoute.carrier}, audit reports ${audit.carrier}.`
    );
    assert.equal(
      audit.selectedAuditMode?.labelFormat,
      expectedRoute.labelFormat,
      `${label}: expected labelFormat ${expectedRoute.labelFormat}, audit reports ${audit.selectedAuditMode?.labelFormat}.`
    );

    // 2. Snapshot regression (writes baseline on first run / when updating).
    if (UPDATE || !existsSync(f.expectedPath)) {
      writeFileSync(f.expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
      if (!UPDATE) console.log(`  (golden) wrote baseline ${f.name}.expected.json`);
    } else {
      const expectedSnap = JSON.parse(readFileSync(f.expectedPath, 'utf8'));
      assert.deepEqual(
        actual,
        expectedSnap,
        `${label}: outcome drift vs golden baseline.\n${diffSnapshots(expectedSnap, actual)}\n` +
          `If this change is intended, run \`npm run golden:update\` and review the diff.`
      );
    }

    // 3. Declared intent (guards a wrong-but-self-consistent baseline). The real
    // conformance signal is the failed-rule count: a conforming label has zero hard
    // failures (it may still land in REVIEW because text checks are manual_review by
    // design), while a known-bad label must produce at least one failure.
    const failed = audit.summary?.failed ?? 0;
    if (noFail) assert.equal(failed, 0, `${label}: expected no failing rules, got ${failed}.`);
    if (expectFail) assert.ok(failed > 0, `${label}: expected at least one failing rule, got 0.`);
    const byId = new Map((audit.validations || []).map(v => [v.id, v.status]));
    for (const id of mustFire || []) {
      assert.ok(byId.has(id), `${label}: expected rule ${id} to fire, but it did not appear.`);
    }
    for (const id of mustPass || []) {
      assert.equal(byId.get(id), 'pass', `${label}: expected rule ${id} to pass, got ${byId.get(id) ?? 'absent'}.`);
    }
    for (const id of mustNotPass || []) {
      assert.ok(byId.has(id), `${label}: expected rule ${id} to fire, but it did not appear.`);
      assert.notEqual(byId.get(id), 'pass', `${label}: expected rule ${id} NOT to pass, but it passed.`);
    }
  });
}
