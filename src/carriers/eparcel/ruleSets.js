// Loads the eParcel rule sets and resolves each variant file over the base file.
// Rule files are the source of truth for label validation; tests/rulesCatalogue.test.mjs guards them.
import { mergeRuleSets } from '../../ruleEngine.js';
import base from './base/rules.json' with { type: 'json' };
import parcelPost from './parcel-post/rules.json' with { type: 'json' };
import expressPost from './express-post/rules.json' with { type: 'json' };
import returns from './returns/rules.json' with { type: 'json' };
import metro from './metro/rules.json' with { type: 'json' };
import sscc from './sscc/rules.json' with { type: 'json' };

export const RULE_SETS = {
  base,
  'parcel-post': mergeRuleSets(base, parcelPost),
  'express-post': mergeRuleSets(base, expressPost),
  returns: mergeRuleSets(base, returns),
  metro: mergeRuleSets(base, metro),
  sscc: mergeRuleSets(base, sscc)
};

export function ruleSetFor(variant) {
  return RULE_SETS[variant] || RULE_SETS.base;
}
