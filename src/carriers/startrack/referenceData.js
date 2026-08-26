// StarTrack reference data shared by the audit engine and UI: product,
// label-code and unit-type tables.

// StarTrack freight product codes and the routing label code each product should use.
export const STARTRACK_PRODUCT_CODE_MAP = {
  TSE: { name: 'Tradeshow Express', group: 'Special Services', labelCode: 'TSE' },
  RET: { name: 'Express Tail-Lift', group: 'Special Services', labelCode: 'RET' },
  RE2: { name: 'Express Tail-Lift 2 man', group: 'Special Services', labelCode: 'RE2' },
  APT: { name: 'Premium Tail-Lift', group: 'Special Services', labelCode: 'APT' },
  PRM: { name: 'Premium', group: 'Premium services', labelCode: 'PRM' },
  FPP: { name: '1, 3 & 5Kg Fixed Price Premium', group: 'Premium services', labelCode: 'PRM' },
  ARL: { name: 'Airlock', group: 'Premium services', labelCode: 'ARL' },
  FPA: { name: '1, 3 & 5Kg Fixed Price Airlock', group: 'Premium services', labelCode: 'ARL' },
  EXP: { name: 'Express', group: 'Express services', labelCode: 'EXP' }
};

// Reverse lookup used when the routing barcode is decoded before the freight/QR data.
export const STARTRACK_LABEL_CODE_MAP = Object.entries(STARTRACK_PRODUCT_CODE_MAP).reduce((acc, [code, meta]) => {
  if (!acc[meta.labelCode]) acc[meta.labelCode] = [];
  acc[meta.labelCode].push(code);
  return acc;
}, {});

// Unit types accepted for each StarTrack product family when the fixed-width QR payload
// includes unit data.
// Spec-exact per MOS v9 Appendix A. TSE and APT are deliberately absent: the spec
// does not list them for any unit type ("non-standard units must be defined by
// arrangement with StarTrack"), so those labels surface as manual review.
export const STARTRACK_UNIT_TYPE_MAP = {
  BAG: ['EXP', 'PRM', 'RET', 'RE2', 'FPP', 'ARL', 'FPA'],
  CTN: ['EXP', 'PRM', 'RET', 'RE2', 'FPP', 'ARL', 'FPA'],
  ITM: ['EXP', 'PRM', 'RET', 'RE2', 'FPP', 'ARL', 'FPA'],
  JIF: ['EXP', 'PRM', 'RET', 'RE2', 'FPP', 'ARL', 'FPA'],
  PAL: ['EXP', 'PRM', 'RET', 'RE2'],
  SAT: ['FPP', 'FPA'],
  SKI: ['EXP', 'PRM', 'RET', 'RE2']
};
