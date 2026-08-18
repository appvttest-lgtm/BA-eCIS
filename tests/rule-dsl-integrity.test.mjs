// Rule DSL integrity.
//
// The rule JSON is the source of truth for validation, but a typo in it fails quietly in
// the one place that matters most: an unknown op inside a `when` gate evaluates to false,
// so the rule is silently skipped and never appears in the report at all. That directly
// contradicts the "undetected states stay visible" invariant in AGENTS.md, and no rule
// author would see it — the row is simply absent.
//
// These tests walk every shipped rule and assert the engine actually implements every op
// and every named function they reference. Importing auditEngine.js is what registers the
// named functions, so it must stay imported even though nothing here calls it directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyNormalize, evalAssert, resolveRuleSetTemplates, NORMALIZE_STEP_NAMES } from '../src/ruleEngine.js';
import { listRuleSets } from '../rules/index.js';
import '../src/auditEngine.js'; // side effect: registers the named rule functions

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules');

function ruleFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...ruleFiles(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

/** Every assert-shaped node in a rule, including nested all/any and the when gates. */
function assertNodes(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const n of node) assertNodes(n, acc);
    return acc;
  }
  if (typeof node.op === 'string') acc.push(node);
  for (const key of ['all', 'any', 'assert', 'when', 'itemWhen']) {
    if (node[key]) assertNodes(node[key], acc);
  }
  return acc;
}

const files = ruleFiles(RULES_DIR);

// What actually ships: every variant merged over its base, templates resolved. Variant
// files on their own hold partial overlays and `{ id, disabled: true }` removal stubs,
// so the raw files are the wrong thing to assert against.
const rules = [];
for (const [carrier, variants] of Object.entries(listRuleSets())) {
  for (const [variant, set] of Object.entries(variants)) {
    for (const rule of resolveRuleSetTemplates(set).rules || []) {
      if (rule.disabled) continue;
      rules.push({ file: `${carrier}/${variant}`, set: set.id, rule });
    }
  }
}

test('rule corpus is non-empty (guards against this suite silently testing nothing)', () => {
  assert.ok(files.length >= 10, `expected the rule files to be discovered, found ${files.length}`);
  assert.ok(rules.length >= 100, `expected a populated rule corpus, found ${rules.length} rules`);
});

test('every assert op used by a shipped rule is implemented by the engine', () => {
  const unknown = [];
  for (const { file, rule } of rules) {
    for (const node of assertNodes(rule)) {
      let res;
      try {
        res = evalAssert({ ...node, op: node.op }, 'probe', {}, null, {});
      } catch {
        continue; // reached the operator and threw on the probe value: it exists
      }
      if (res && res.message === `Unknown assert op ${node.op}.`) {
        unknown.push(`${file} ${rule.id}: op "${node.op}"`);
      }
    }
  }
  assert.deepEqual(unknown, [], `rules reference assert ops the engine does not implement:\n  ${unknown.join('\n  ')}`);
});

test('every named rule function referenced by a shipped rule is registered', () => {
  const missing = [];
  for (const { file, rule } of rules) {
    for (const node of assertNodes(rule)) {
      if (node.op !== 'fn') continue;
      const res = evalAssert({ op: 'fn', name: node.name }, 'probe', {}, null, {});
      if (res && res.message === `Rule function ${node.name} is not registered.`) {
        missing.push(`${file} ${rule.id}: fn "${node.name}"`);
      }
    }
  }
  assert.deepEqual(missing, [], `rules call unregistered functions:\n  ${missing.join('\n  ')}`);
});

test('every normalize step named by a shipped rule is implemented', () => {
  // applyNormalize skips steps it does not recognise, so a typo here is completely
  // silent: the comparison just runs un-normalized and quietly stops matching.
  const unknown = [];
  for (const { file, rule } of rules) {
    for (const node of assertNodes(rule)) {
      for (const step of node.normalize || []) {
        if (!NORMALIZE_STEP_NAMES.includes(step)) unknown.push(`${file} ${rule.id}: normalize "${step}"`);
      }
      for (const step of node.args?.normalize || []) {
        if (!NORMALIZE_STEP_NAMES.includes(step)) unknown.push(`${file} ${rule.id}: fn args normalize "${step}"`);
      }
    }
  }
  assert.deepEqual(unknown, [], `rules name normalize steps the engine does not implement:\n  ${unknown.join('\n  ')}`);
});

test('every normalize step actually transforms its input', () => {
  // Guards the reverse direction: a step can be dropped from the engine while callers
  // still name it. `digitsOnly` has no rule-JSON user but the ltePath operator calls it
  // directly, so a rules/ search alone will wrongly report it as dead.
  const probes = {
    stripSpaces: [' a b ', 'ab'],
    upper: ['ab', 'AB'],
    trim: ['  ab  ', 'ab'],
    digitsOnly: ['2025-10-24 17:00', '202510241700']
  };
  for (const step of NORMALIZE_STEP_NAMES) {
    const probe = probes[step];
    assert.ok(probe, `normalize step "${step}" has no probe in this test - add one`);
    assert.equal(applyNormalize(probe[0], [step]), probe[1], `normalize step "${step}" did not transform its input`);
  }
  assert.deepEqual(NORMALIZE_STEP_NAMES.slice().sort(), Object.keys(probes).sort());
});

test('an unrecognised normalize step is inert, never fatal', () => {
  // Rule JSON is repo-authored, but a step name that collides with an Object.prototype
  // key must still be a no-op: throwing here would escape evaluateRuleSet and abort the
  // whole audit rather than failing a single rule.
  for (const step of ['nope', 'valueOf', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(applyNormalize('AP123 x', [step]), 'AP123 x', `normalize step "${step}" must leave the value alone`);
  }
});

test('ltePath compares numerically after stripping non-digits', () => {
  // Regression: ltePath normalizes both sides with digitsOnly. When that step was
  // removed as "unused", Number() saw the raw string, both sides became NaN, and the
  // comparison flipped to false for any value carrying a separator.
  const ctx = { other: '2025-10-24 17:00' };
  const lte = value => evalAssert({ op: 'ltePath', path: 'other' }, value, ctx, null, {}).pass;
  assert.equal(lte('202510230800'), true, 'earlier date must compare as <=');
  assert.equal(lte('2025-10-23 08:00'), true, 'separators must not break the comparison');
  assert.equal(lte('202510251200'), false, 'later date must still fail');
});

test('every rule carries the fields the report renders', () => {
  // The report shows rule definition, input and outcome side by side (AGENTS.md §5), so a
  // rule missing its id/title/category would render a blank row rather than fail loudly.
  const bad = [];
  for (const { file, rule } of rules) {
    for (const field of ['id', 'title', 'category', 'severity']) {
      if (!rule[field]) bad.push(`${file} ${rule.id || '(no id)'}: missing ${field}`);
    }
  }
  assert.deepEqual(bad, [], `rules missing report fields:\n  ${bad.join('\n  ')}`);
});

test('rule ids are unique within each rule FILE', () => {
  // Checked on the raw files, not the merged sets: merging is by id, so a duplicate id
  // inside one file would silently collapse into a single rule and the second definition
  // would vanish without any error.
  for (const f of files) {
    const set = JSON.parse(readFileSync(f, 'utf8'));
    const seen = new Set();
    for (const rule of set.rules || []) {
      assert.ok(!seen.has(rule.id), `duplicate rule id ${rule.id} in ${f}`);
      seen.add(rule.id);
    }
  }
});
