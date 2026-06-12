// Carrier reference data shared by the audit engine, payload comparison and UI:
// eParcel product/service maps, the service-to-product matrix, and StarTrack
// product, label-code and unit-type tables.

export const PRODUCT_CODE_MAP = {
  '00091': 'Parcel Post (Non-Signature)',
  '00093': 'Parcel Post + Signature',
  '00096': 'Express Post + Signature',
  '00087': 'Express Post (Non-Signature)',
  '00065': 'Parcel Post Return',
  '00068': 'Express Post Return'
};

// eParcel service codes also define the delivery flags we expect to see in a matching
// Get Shipments payload.
export const SERVICE_CODE_MAP = {
  '03': {
    name: 'Signature Required',
    description:
      'Signature on delivery always required. If signature cannot be obtained, parcel must be carded to Post Office.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  '08': {
    name: 'Authority To Leave',
    description: 'Authority to leave if unattended.',
    authority_to_leave: true,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  45: {
    name: 'Partial Delivery Allowed',
    description: 'Signature required with partial delivery allowed.',
    authority_to_leave: false,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  15: {
    name: 'ATL + Partial Delivery',
    description: 'Authority to leave enabled with partial delivery allowed.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  50: {
    name: 'Safe Drop Enabled',
    description: 'Signature required with safe drop enabled.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: true
  },
  51: {
    name: 'Safe Drop + Partial Delivery',
    description: 'Safe drop enabled with partial delivery allowed.',
    authority_to_leave: false,
    allow_partial_delivery: true,
    safe_drop_enabled: true
  },
  '09': {
    name: 'Non-Signature + ATL',
    description: 'Authority to leave with non-signature service.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  49: {
    name: 'Wine Delivery - Addressee Only',
    description: 'Wine delivery requiring identity on delivery and addressee-only delivery.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false,
    requires_identity_on_delivery: true,
    id_capture_type: 'addressee'
  },
  81: {
    name: 'Wine Delivery - Signature',
    description: 'Wine delivery with mandatory signature.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: false
  },
  82: {
    name: 'Wine Delivery - ATL',
    description: 'Wine delivery with authority to leave enabled.',
    authority_to_leave: true,
    allow_partial_delivery: true,
    safe_drop_enabled: false
  },
  83: {
    name: 'Wine Delivery - Safe Drop',
    description: 'Wine delivery with safe drop enabled.',
    authority_to_leave: false,
    allow_partial_delivery: false,
    safe_drop_enabled: true
  }
};

// Standard eParcel article IDs encode both service and product. This matrix rejects
// combinations that can decode successfully but are not valid together.
export const SERVICE_TO_PRODUCT_MAP = {
  '03': ['00093', '00096', '00065', '00068'],
  '08': ['00093', '00096', '00065', '00068'],
  45: ['00093', '00096'],
  15: ['00093', '00096'],
  50: ['00093', '00096'],
  51: ['00093', '00096'],
  '09': ['00091', '00087'],
  49: ['00093'],
  81: ['00093'],
  82: ['00093'],
  83: ['00093']
};

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
/** Resolves an eParcel product code for report display; unknown values stay explicit. */
export function getProductCodeDescription(code) {
  return PRODUCT_CODE_MAP[code] || 'Unknown product code';
}

/** Resolves an eParcel service code into the report wording used by validation rows. */
export function getServiceCodeDescription(code) {
  const service = SERVICE_CODE_MAP[code];
  return service ? `${service.name} - ${service.description}` : 'Unknown service code';
}

/** Returns the service rule object used by payload comparison and service-matrix UI. */
export function getServiceCodeRules(code) {
  return SERVICE_CODE_MAP[code] || null;
}
