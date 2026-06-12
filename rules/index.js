// Loads the carrier rule sets and resolves variant files over their base file.
// Rule files are the source of truth for label validation; see docs/checklists.
import { mergeRuleSets } from '../src/ruleEngine.js';
import eparcelBase from './eparcel/base.json' with { type: 'json' };
import eparcelParcelPost from './eparcel/parcel-post.json' with { type: 'json' };
import eparcelExpressPost from './eparcel/express-post.json' with { type: 'json' };
import eparcelReturns from './eparcel/returns.json' with { type: 'json' };
import eparcelSscc from './eparcel/sscc.json' with { type: 'json' };
import startrackBase from './startrack/base.json' with { type: 'json' };
import startrackExpress from './startrack/express.json' with { type: 'json' };
import startrackPremium from './startrack/premium.json' with { type: 'json' };
import startrackFpp from './startrack/fpp.json' with { type: 'json' };
import startrackSscc from './startrack/sscc.json' with { type: 'json' };

const RULE_SETS = {
  eparcel: {
    base: eparcelBase,
    'parcel-post': mergeRuleSets(eparcelBase, eparcelParcelPost),
    'express-post': mergeRuleSets(eparcelBase, eparcelExpressPost),
    returns: mergeRuleSets(eparcelBase, eparcelReturns),
    sscc: mergeRuleSets(eparcelBase, eparcelSscc)
  },
  startrack: {
    base: startrackBase,
    express: mergeRuleSets(startrackBase, startrackExpress),
    premium: mergeRuleSets(startrackBase, startrackPremium),
    fpp: mergeRuleSets(startrackBase, startrackFpp),
    sscc: mergeRuleSets(startrackBase, startrackSscc)
  }
};

// Canonical AU state list - shared with auditEngine text extraction so the
// visible-address heuristics and the address rules can never drift apart.
export const AU_STATES = eparcelBase.constants.auStates;

export function getRuleSet(carrier, variant) {
  const sets = RULE_SETS[carrier] || {};
  return sets[variant] || sets.base;
}

export function listRuleSets() {
  return RULE_SETS;
}
