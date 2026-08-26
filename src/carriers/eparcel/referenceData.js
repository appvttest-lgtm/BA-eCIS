// eParcel reference data shared by the audit engine, payload comparison and UI:
// product/service maps and the service-to-product matrix.

export const PRODUCT_CODE_MAP = {
  '00091': 'Parcel Post (Non-Signature)',
  '00093': 'Parcel Post + Signature',
  '00096': 'Express Post + Signature',
  '00087': 'Express Post (Non-Signature)',
  '00065': 'Parcel Post Return',
  '00068': 'Express Post Return',
  '00121': 'Metro (Non-Signature)',
  '00120': 'Metro + Signature'
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
// Metro (00121/00120) accepts all three service codes the Metro spec lists (09, 45, 51).
// The spec's product-attributes table (V2.0 p6) does not state which of the three belongs
// to which sub-product, so the union is accepted rather than hard-failing a valid pairing;
// tighten these three rows once Australia Post confirms the per-sub-product split.
export const SERVICE_TO_PRODUCT_MAP = {
  '03': ['00093', '00096', '00065', '00068'],
  '08': ['00093', '00096', '00065', '00068'],
  45: ['00093', '00096', '00121', '00120'],
  15: ['00093', '00096'],
  50: ['00093', '00096'],
  51: ['00093', '00096', '00121', '00120'],
  '09': ['00091', '00087', '00121', '00120'],
  49: ['00093'],
  81: ['00093'],
  82: ['00093'],
  83: ['00093']
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
