// Identity-gated Get Shipments payload comparison. The pasted payload must
// match the label identity (article/freight/SSCC/consignment) before any
// secondary field comparison reports as a match.
import { SERVICE_CODE_MAP } from './referenceData.js';

const MAX_PAYLOAD_FLAT_ENTRIES = 20000;

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}

/** Parses JSON or plain-text Get Shipments snippets into local evidence for comparison. */
export function parseApiPayloadText(payloadText) {
  const rawText = String(payloadText || '').trim();
  if (!rawText) return { provided: false, rawText: '', parsed: null, parseError: null, flat: [], normalizedText: '' };
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(rawText.slice(start, end + 1));
      } catch (err2) {
        parseError = err2.message || String(err2);
      }
    } else {
      parseError = err.message || String(err);
    }
  }

  // Pasted payloads are user/attacker-influenced: an explicit stack instead of
  // recursion means deep nesting cannot overflow the call stack, and the
  // flattened evidence list is capped to bound memory. Real Get Shipments
  // responses are far below both limits.
  const flat = [];
  const stack = parsed === null || parsed === undefined ? [] : [{ value: parsed, path: '' }];
  while (stack.length && flat.length < MAX_PAYLOAD_FLAT_ENTRIES) {
    const { value, path } = stack.pop();
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (let idx = value.length - 1; idx >= 0; idx -= 1) stack.push({ value: value[idx], path: `${path}[${idx}]` });
      continue;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        stack.push({ value: entries[i][1], path: path ? `${path}.${entries[i][0]}` : entries[i][0] });
      }
      continue;
    }
    const text = String(value);
    flat.push({
      path,
      value,
      text,
      normalizedPath: normalizePayloadText(path),
      normalizedValue: normalizePayloadText(text)
    });
  }
  const normalizedText = normalizePayloadText(rawText);
  return {
    provided: true,
    rawText,
    parsed,
    parseError,
    flat,
    normalizedText,
    normalizedValueText: flat
      .map(item => item.normalizedValue)
      .filter(Boolean)
      .join('|'),
    normalizedPathText: flat
      .map(item => item.normalizedPath)
      .filter(Boolean)
      .join('|')
  };
}

function normalizePayloadText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function uniquePayloadEvidenceLines(lines = []) {
  return [...new Set(lines.map(line => String(line || '').trim()).filter(Boolean))].slice(0, 12);
}

function payloadEvidenceForValues(ctx, values = []) {
  if (!ctx?.provided) return '';
  const cleaned = [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
  if (!cleaned.length) return '';
  const lines = [];
  if (ctx.flat?.length) {
    for (const item of ctx.flat) {
      const itemValue = String(item.value ?? '');
      const itemNormalized = item.normalizedValue || normalizePayloadText(itemValue);
      for (const value of cleaned) {
        const valueNormalized = normalizePayloadText(value);
        if (!valueNormalized || valueNormalized.length < 2) continue;
        if (
          itemNormalized.includes(valueNormalized) ||
          (valueNormalized.includes(itemNormalized) && itemNormalized.length >= 3)
        ) {
          lines.push(`${item.path || '(root)'}: ${itemValue}`);
          break;
        }
      }
    }
  }
  if (!lines.length && payloadContainsAny(ctx, cleaned) === true) {
    lines.push(`raw_payload: contains ${cleaned.join(', ')}`);
  }
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadEvidenceForPathPatterns(ctx, patterns = []) {
  if (!ctx?.provided || !ctx.flat?.length) return '';
  const lines = [];
  for (const item of ctx.flat) {
    const path = String(item.path || '');
    if (patterns.some(pattern => pattern.test(path))) {
      lines.push(`${path || '(root)'}: ${String(item.value ?? '')}`);
    }
  }
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadEvidenceForTokens(ctx, tokens = []) {
  if (!ctx?.provided) return '';
  const cleaned = [...new Set(tokens.map(v => String(v || '').trim()).filter(Boolean))];
  if (!cleaned.length) return '';
  const lines = [];
  if (ctx.flat?.length) {
    for (const item of ctx.flat) {
      const itemValue = String(item.value ?? '');
      const itemNormalized = item.normalizedValue || normalizePayloadText(itemValue);
      const matched = cleaned.filter(token => itemNormalized.includes(normalizePayloadText(token)));
      if (matched.length) lines.push(`${item.path || '(root)'}: ${itemValue}  [matched: ${matched.join(', ')}]`);
    }
  }
  if (!lines.length) lines.push(`matched_tokens: ${cleaned.join(', ')}`);
  return uniquePayloadEvidenceLines(lines).join('\n');
}

function payloadContainsValue(ctx, value) {
  const normalized = normalizePayloadText(value);
  if (!ctx?.provided || !normalized || normalized.length < 2) return null;
  return ctx.normalizedText.includes(normalized);
}

function payloadContainsAny(ctx, values = []) {
  const cleaned = values.map(v => String(v || '').trim()).filter(Boolean);
  if (!ctx?.provided || !cleaned.length) return null;
  return cleaned.some(value => payloadContainsValue(ctx, value) === true);
}

function payloadComparableFieldName(v) {
  const id = String(v?.id || '').toUpperCase();
  if (/CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE|EP-ART-03|EP-ART-07|ST-QR-F03|ST-X-01/.test(id))
    return 'consignment_id';
  if (
    /ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|ST_FREIGHT_BARCODE_PRESENT|DATAMATRIX_PRESENT|GS1_128_PRESENT|EP-ART-0[124568]|EP-LIN|EP-SS-|EP-DM-01|ST-FRT|ST-SSC|ST-X-02|ST-QR-F04/.test(
      id
    )
  )
    return 'article_id';
  if (/PRODUCT|ST_QR_PRODUCT|ST_PRODUCT_KNOWN|EP-SVC-02|EP-SVC-07|ST-PRD|ST-QR-F05/.test(id)) return 'product_code';
  if (/SERVICE|SERVICE_PRODUCT_MATCH|EP-SVC-01|EP-SVC-03|EP-RET-01/.test(id)) return 'service_code';
  if (/ROUTE|ROUTING|ST_ROUTE|ST-RTE-02A|ST-RTE-03/.test(id)) return 'routing_code';
  if (/POSTCODE|DM_POSTCODE|ST_QR_POSTCODE|EP-DM-05|EP-TO-08|ST-QR-F02|ST-RTE-02B|ST-RTE-04/.test(id))
    return 'delivery_postcode';
  if (/WEIGHT|ST_WEIGHT|ST-QR-F09|ST-ITM-04/.test(id)) return 'weight';
  if (/CUBE|CUBIC|ST-ITM-05/.test(id)) return 'cubic_volume';
  if (/DG|DANGEROUS|EP-LAY-07|ST-QR-F19/.test(id)) return 'dangerous_goods';
  if (/ADDR_TO|RECEIVER|EP-TO-|ST-RCV/.test(id)) return 'receiver_address';
  if (/ADDR_FROM|SENDER|LODGE|LODGEMENT|EP-FR-|ST-SND/.test(id)) return 'lodgement_address';
  if (/DATE|8008|EP-DM-07|EP-LAY-06|ST-QR-F11/.test(id)) return 'label_generation_datetime';
  if (/LABEL_CODE|BRAND|LOGO|HEADER|EP-LAY-05|ST-HDR-0[12]/.test(id)) return 'label_branding';
  return '';
}

function tokeniseComparableText(values = []) {
  const stop = new Set([
    'THE',
    'AND',
    'FOR',
    'WITH',
    'FROM',
    'TO',
    'PH',
    'PHONE',
    'AU',
    'AUS',
    'NSW',
    'VIC',
    'QLD',
    'SA',
    'WA',
    'TAS',
    'ACT',
    'NT',
    'KG',
    'M3',
    'POST',
    'PARCEL',
    'EXPRESS',
    'STARTRACK',
    'AUSTRALIA'
  ]);
  return [
    ...new Set(
      values
        .flatMap(
          value =>
            String(value || '')
              .toUpperCase()
              .match(/[A-Z0-9]{3,}/g) || []
        )
        .filter(token => !stop.has(token) && !/^0+$/.test(token))
    )
  ];
}

function payloadTokenCoverage(ctx, values = [], options = {}) {
  if (!ctx?.provided) return null;
  const tokens = tokeniseComparableText(values);
  if (!tokens.length) return null;
  const matches = tokens.filter(token => payloadContainsValue(ctx, token) === true);
  const minTokens = options.minTokens ?? Math.min(3, Math.max(1, Math.ceil(tokens.length * 0.45)));
  const postcodeTokens = tokens.filter(token => /^\d{4}$/.test(token));
  const postcodeOk = !postcodeTokens.length || postcodeTokens.some(token => matches.includes(token));
  return { ok: matches.length >= minTokens && postcodeOk, tokens, matches, minTokens, postcodeOk };
}

function payloadBool(ctx, patterns = []) {
  if (!ctx?.provided || !ctx.flat?.length) return null;
  for (const item of ctx.flat) {
    const path = String(item.path || '');
    const normalizedPath = item.normalizedPath || normalizePayloadText(path);
    if (!patterns.some(pattern => pattern.test(path) || pattern.test(normalizedPath))) continue;
    if (typeof item.value === 'boolean') return item.value;
    const text = String(item.value).trim().toLowerCase();
    if (['true', 'y', 'yes', '1', 'enabled'].includes(text)) return true;
    if (['false', 'n', 'no', '0', 'disabled'].includes(text)) return false;
  }
  return null;
}

function payloadMatchResult(match, detail = '') {
  if (match === true) return { label: 'Match', status: 'match', detail };
  if (match === false) return { label: 'Does not match', status: 'mismatch', detail };
  return { label: 'N/A', status: 'na', detail: '' };
}

function serviceFlagPayloadMatch(article, ctx) {
  if (!article?.serviceCode || !SERVICE_CODE_MAP[article.serviceCode]) return null;
  const service = SERVICE_CODE_MAP[article.serviceCode];
  const comparisons = [];
  const atl = payloadBool(ctx, [/authority[_\s-]*to[_\s-]*leave/i, /atl/i]);
  const partial = payloadBool(ctx, [/allow[_\s-]*partial[_\s-]*delivery/i, /partial[_\s-]*delivery/i]);
  const safeDrop = payloadBool(ctx, [/safe[_\s-]*drop/i]);
  if (atl !== null) comparisons.push(atl === Boolean(service.authority_to_leave));
  if (partial !== null) comparisons.push(partial === Boolean(service.allow_partial_delivery));
  if (safeDrop !== null) comparisons.push(safeDrop === Boolean(service.safe_drop_enabled));
  if (!comparisons.length) return null;
  return comparisons.every(Boolean);
}

function auditIdentityValues(audit) {
  const facts = audit?.labelFacts || {};
  const articles = audit?.articles || [];
  const startrack = audit?.startrack || {};
  return uniqueNonEmpty([
    ...(facts.articleIds || []),
    ...(facts.consignmentIds || []),
    ...articles.flatMap(a => [a.articleId, a.freightItemId, a.sscc, a.consignmentId]),
    ...(audit?.parsed || []).flatMap(p => [
      p.articleId,
      p.article,
      p.articleIdValue,
      p.consignmentId,
      p.sscc,
      p.freightItemId,
      p.connoteNumber
    ]),
    ...(startrack.freightParses || []).flatMap(f => [f.freightItemId, f.connoteNumber]),
    ...(startrack.qrParses || []).flatMap(q => [q.fields?.freightItemNumber, q.fields?.connoteNumber]),
    ...(startrack.ssccParses || []).flatMap(s => [`00${s.sscc}`, s.sscc])
  ]).filter(v => normalizePayloadText(v).length >= 6);
}

/** Gates payload comparisons so fields are compared only when the payload matches this label. */
function applyPayloadIdentityGate(audit, apiPayload) {
  const identityValues = auditIdentityValues(audit);
  const identityMatchesLabel = identityValues.length ? payloadContainsAny(apiPayload, identityValues) === true : null;
  return {
    ...apiPayload,
    identityValues,
    identityGateApplied: identityValues.length > 0,
    identityMatchesLabel,
    identityEvidence: identityMatchesLabel ? payloadEvidenceForValues(apiPayload, identityValues) : ''
  };
}

function payloadIdentityRule(id) {
  return /ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|GS1_PREFIX|DATAMATRIX_PRESENT|GS1_128_PRESENT|ST_FREIGHT_BARCODE_PRESENT|ST_SSCC|CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE|EP-ART|EP-LIN|EP-SS|EP-DM-01|ST-FRT|ST-SSC|ST-X-0[12]|ST-QR-F0[34]/i.test(
    String(id || '')
  );
}

/** Compares one validation row against matched Get Shipments evidence where a field mapping exists. */
function compareValidationToApiPayload(v, audit, ctx) {
  if (!ctx?.provided) return undefined;
  const id = String(v?.id || '');
  const canonicalField = payloadComparableFieldName(v);
  const facts = audit?.labelFacts || {};
  const articles = audit?.articles || [];
  const eparcelArticles = articles.filter(a => a?.type !== 'sscc');
  const ssccArticles = articles.filter(a => a?.type === 'sscc');
  const startrack = audit?.startrack || {};

  const withField = (match, detail = '', evidence = '') => ({
    ...payloadMatchResult(match, detail),
    field: canonicalField,
    evidence
  });

  if (ctx.identityGateApplied && ctx.identityMatchesLabel === false && !payloadIdentityRule(id)) {
    return withField(
      null,
      'Get Shipments payload identity did not match this label; secondary field comparison suppressed.'
    );
  }

  if (
    /ARTICLE|FREIGHT|VISIBLE_ARTICLE|SSCC|AI91|GS1_PREFIX|DATAMATRIX_PRESENT|GS1_128_PRESENT|ST_FREIGHT_BARCODE_PRESENT|ST_SSCC|EP-ART-0[124568]|EP-LIN|EP-SS-|EP-DM-01|ST-FRT|ST-SSC|ST-X-02|ST-QR-F04/i.test(
      id
    )
  ) {
    const articleValues = [
      ...articles.map(a => a.articleId || a.freightItemId || a.sscc).filter(Boolean),
      ...ssccArticles.map(a => a.sscc).filter(Boolean),
      ...(facts.articleIds || []),
      ...(startrack.freightParses || []).map(f => f.freightItemId),
      ...(startrack.ssccParses || []).flatMap(s => [`00${s.sscc}`, s.sscc])
    ];
    const match = payloadContainsAny(ctx, articleValues);
    return withField(
      match,
      articleValues.length ? `Compared article_id values: ${articleValues.join(', ')}` : '',
      payloadEvidenceForValues(ctx, articleValues)
    );
  }

  if (/CONSIGNMENT|CONS_NO|CONNOTE|VISIBLE_CONS|ST_CONNOTE|EP-ART-03|EP-ART-07|ST-QR-F03|ST-X-01/i.test(id)) {
    const connoteValues = [
      ...(facts.consignmentIds || []),
      ...eparcelArticles.map(a => a.consignmentId).filter(Boolean),
      ...(startrack.freightParses || []).map(f => f.connoteNumber),
      ...(startrack.qrParses || []).map(q => q.fields?.connoteNumber).filter(Boolean)
    ];
    const match = payloadContainsAny(ctx, connoteValues);
    return withField(
      match,
      connoteValues.length ? `Compared consignment_id values: ${connoteValues.join(', ')}` : '',
      payloadEvidenceForValues(ctx, connoteValues)
    );
  }

  if (
    /PRODUCT|SERVICE_KNOWN|SERVICE_PRODUCT_MATCH|ST_QR_PRODUCT|ST_ROUTE_PRODUCT_MATCH|EP-SVC|EP-RET-01|ST-PRD|ST-QR-F05|ST-RTE-03/i.test(
      id
    )
  ) {
    const productCodes = [
      ...eparcelArticles.map(a => a.productCode).filter(Boolean),
      ...(startrack.freightParses || []).map(f => f.productCode),
      ...(startrack.qrParses || []).map(q => q.productCode).filter(Boolean)
    ];
    const serviceCodes = eparcelArticles.map(a => a.serviceCode).filter(Boolean);
    const labelCodes = [
      ...(startrack.routingParses || []).map(r => r.labelCode),
      ...(startrack.freightParses || []).map(f => f.expectedLabelCode),
      facts.labelCode
    ].filter(Boolean);
    const hasProductOrService = payloadContainsAny(ctx, [...productCodes, ...serviceCodes, ...labelCodes]);
    const serviceFlagMatch = eparcelArticles.length ? serviceFlagPayloadMatch(eparcelArticles[0], ctx) : null;
    const finalMatch =
      serviceFlagMatch === null ? hasProductOrService : hasProductOrService === true && serviceFlagMatch === true;
    return withField(
      finalMatch,
      `Compared product_code/service_code/label_code values: ${[...productCodes, ...serviceCodes, ...labelCodes].join(', ') || 'none'}.`,
      payloadEvidenceForValues(ctx, [...productCodes, ...serviceCodes, ...labelCodes])
    );
  }

  if (/ROUTE|ROUTING|POSTCODE|DM_POSTCODE|ST_QR_POSTCODE|EP-DM-05|EP-TO-08|ST-QR-F02|ST-RTE/i.test(id)) {
    const postcodes = [
      ...((facts.postcodeLines || []).join(' ').match(/\b\d{4}\b/g) || []),
      ...(audit?.parsed || []).map(p => p.postcode).filter(Boolean),
      ...(startrack.routingParses || []).map(r => r.postcode),
      ...(startrack.qrParses || []).map(q => q.fields?.receiverPostcode).filter(Boolean)
    ];
    const match = payloadContainsAny(ctx, [...new Set(postcodes)]);
    return withField(
      match,
      postcodes.length ? `Compared delivery_postcode values: ${[...new Set(postcodes)].join(', ')}` : '',
      payloadEvidenceForValues(ctx, [...new Set(postcodes)])
    );
  }

  if (/WEIGHT|ST_WEIGHT|ST-QR-F09|ST-ITM-04/i.test(id)) {
    const weights = [facts.weightKg, ...(startrack.qrParses || []).map(q => q.fields?.consignmentWeight)].filter(
      Boolean
    );
    const normalizedWeights = weights.flatMap(w => {
      const asText = String(w).trim();
      const noZeros = asText.replace(/\.0+$/, '');
      return [asText, noZeros, `${noZeros}KG`, `${asText}KG`];
    });
    const match = payloadContainsAny(ctx, normalizedWeights);
    return withField(
      match,
      weights.length ? `Compared weight values: ${weights.join(', ')}` : '',
      payloadEvidenceForValues(ctx, normalizedWeights)
    );
  }

  if (/CUBE|CUBIC|ST-ITM-05/i.test(id)) {
    const cubes = [facts.cube, ...(startrack.qrParses || []).map(q => q.fields?.consignmentCube)].filter(Boolean);
    const match = payloadContainsAny(ctx, cubes);
    return withField(
      match,
      cubes.length ? `Compared cubic_volume values: ${cubes.join(', ')}` : '',
      payloadEvidenceForValues(ctx, cubes)
    );
  }

  if (/DG|DANGEROUS|EP-LAY-07|ST-QR-F19/i.test(id)) {
    const apiDg = payloadBool(ctx, [/dangerous[_\s-]*goods/i, /dg[_\s-]*indicator/i, /contains[_\s-]*dangerous/i]);
    if (apiDg === null) return withField(null);
    const labelDg = Boolean(
      facts.dangerousGoodsDeclarationPresent ||
        (startrack.qrParses || []).some(q => q.fields?.dangerousGoodsIndicator === 'Y')
    );
    return withField(
      apiDg === labelDg,
      `API dangerous_goods=${apiDg}; label dangerous_goods=${labelDg}.`,
      payloadEvidenceForPathPatterns(ctx, [
        /dangerous[_\s-]*goods/i,
        /dg[_\s-]*indicator/i,
        /contains[_\s-]*dangerous/i
      ])
    );
  }

  if (/ADDR_TO|RECEIVER|EP-TO-|ST-RCV/i.test(id)) {
    const receiverValues = [...(facts.toBlock || []), ...(facts.postcodeLines || [])];
    const coverage = payloadTokenCoverage(ctx, receiverValues, { minTokens: 3 });
    if (!coverage) return withField(null);
    return withField(
      coverage.ok,
      `receiver_address token match ${coverage.matches.length}/${coverage.tokens.length}: ${coverage.matches.slice(0, 8).join(', ')}`,
      payloadEvidenceForTokens(ctx, coverage.matches)
    );
  }

  if (/ADDR_FROM|SENDER|LODGE|LODGEMENT|EP-FR-|ST-SND/i.test(id)) {
    const senderValues = [...(facts.fromBlock || [])];
    const coverage = payloadTokenCoverage(ctx, senderValues, { minTokens: 3 });
    if (!coverage) return withField(null);
    return withField(
      coverage.ok,
      `lodgement_address token match ${coverage.matches.length}/${coverage.tokens.length}: ${coverage.matches.slice(0, 8).join(', ')}`,
      payloadEvidenceForTokens(ctx, coverage.matches)
    );
  }

  if (/DATE|8008|EP-DM-07|EP-LAY-06|ST-QR-F11/i.test(id)) {
    const dates = [v.actual, ...(audit?.parsed || []).map(p => p.dateTime).filter(Boolean)].filter(Boolean);
    const match = payloadContainsAny(ctx, dates);
    return withField(
      match,
      dates.length ? `Compared label_generation_datetime values: ${dates.join(', ')}` : '',
      payloadEvidenceForValues(ctx, dates)
    );
  }

  if (/LABEL_CODE|BRAND|LOGO|HEADER|EP-LAY-05|ST-HDR-0[12]/i.test(id)) {
    const values = [
      facts.labelType,
      facts.labelCode,
      audit?.carrier === 'startrack' ? 'StarTrack' : 'Australia Post'
    ].filter(Boolean);
    const match = payloadContainsAny(ctx, values);
    return withField(
      match,
      values.length ? `Compared label_branding values: ${values.join(', ')}` : '',
      payloadEvidenceForValues(ctx, values)
    );
  }

  return withField(null);
}

/** Adds payload-comparison metadata to validation rows without changing the original scan evidence. */
export function attachApiPayloadComparison(audit, payloadText) {
  const parsedPayload = parseApiPayloadText(payloadText);
  if (!parsedPayload.provided) return { ...audit, apiPayload: parsedPayload };
  const apiPayload = applyPayloadIdentityGate(audit, parsedPayload);
  const withPayload = { ...audit, apiPayload };
  const validations = (audit.validations || []).map(v => ({
    ...v,
    apiPayloadMatch: compareValidationToApiPayload(v, withPayload, apiPayload)
  }));
  return { ...withPayload, validations };
}

/** Runs the full eParcel rule set against one rendered label/page. */
// --- JSON rule-set support ---------------------------------------------------
// Custom assert functions referenced by name from the /rules JSON files, plus
// the evidence-context builders the declarative rules resolve their paths against.
