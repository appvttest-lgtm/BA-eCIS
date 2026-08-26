// Carrier registry: the one place that knows which carriers exist. A new
// carrier is a new pack folder (audit, facts, formats, referenceData,
// per-variant rules.json) plus one import line here.
import eparcel from './eparcel/index.js';
import startrack from './startrack/index.js';

export const CARRIERS = { eparcel, startrack };

export { AU_STATES } from './shared/text.js';

export function getRuleSet(carrier, variant) {
  const sets = CARRIERS[carrier]?.ruleSets || {};
  return sets[variant] || sets.base;
}

export function listRuleSets() {
  return Object.fromEntries(Object.values(CARRIERS).map(carrier => [carrier.id, carrier.ruleSets]));
}
