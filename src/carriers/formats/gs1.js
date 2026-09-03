// GS1 barcode primitives shared across carriers: scanner-output normalization, the GS1 mod-10
// check digit, and the SSCC parser. SSCC (Serial Shipping Container Code) is the GS1 article
// identifier carried under AI 00 (AI: the numeric Application Identifier prefix that names a
// GS1 field). SSCC symbols appear on both eParcel and StarTrack labels, so this module must
// stay carrier-neutral.

/** Normalizes scanner output for GS1 parsing: strips symbology prefixes, maps FNC1/group
 *  separators (the GS1 control characters between fields) and newlines to "|", and unwraps
 *  printed "(AI)" brackets. */
export function normalizeBarcode(raw) {
  // The leading ISO/IEC 15424 symbology identifier (]C1, ]d2, ]C0, ...) is decoder metadata,
  // never payload data, so any "]"+2 characters at the front is stripped before parsing.
  return String(raw || '')
    .trim()
    .replace(/^\][A-Za-z0-9]{2}/, '')
    .replace(/\u001d/g, '|')
    .replace(/\x1d/g, '|')
    .replace(/\u001e/g, '|')
    .replace(/\x1e/g, '|')
    .replace(/\u001c/g, '|')
    .replace(/\x1c/g, '|')
    .replace(/\(00\)/g, '00')
    .replace(/\(01\)/g, '01')
    .replace(/\(91\)/g, '91')
    .replace(/\(420\)/g, '|420')
    .replace(/\(92\)/g, '|92')
    .replace(/\(8008\)/g, '|8008')
    .replace(/[\t ]+/g, '')
    .replace(/\r?\n/g, '|');
}

/** Calculates the GS1 mod-10 check digit used by SSCC barcodes. */
export function gs1Mod10CheckDigit(numberWithoutCheckDigit) {
  const digits = String(numberWithoutCheckDigit || '').replace(/\D/g, '');
  if (!digits) return null;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Flattens a decoded value for pattern matching: symbology prefixes, separators and
 *  whitespace removed, uppercased. */
export function stripAiDecorations(raw) {
  return String(raw || '')
    .replace(/^\][A-Za-z0-9]{2}/, '')
    .replace(/[\u001d\x1d\u001e\x1e\u001c\x1c|]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

/**
 * FNC1-in-first-position evidence for a linear GS1-128 symbol. A GS1-128 barcode is Code 128
 * with the FNC1 control character in the first symbol position; the leading FNC1 is never
 * transmitted as data, so the only digital proof is the ISO/IEC 15424 symbology identifier:
 * ]C1 means Code 128 + FNC1 first (GS1-128), other ]Cn values mean plain/other Code 128.
 * With no identifier available, fnc1FirstPosition stays null (unknown) rather than guessing.
 */
export function gs1LinearComplianceEvidence({ raw = '', symbologyIdentifier = '', decoderSource = '' } = {}) {
  const identifier = String(symbologyIdentifier || '') || (String(raw).match(/^\]C\d/) || [])[0] || '';
  let fnc1FirstPosition = null;
  if (identifier === ']C1') fnc1FirstPosition = true;
  else if (/^\]C\d$/.test(identifier)) fnc1FirstPosition = false;
  return { symbologyIdentifier: identifier, fnc1FirstPosition, decoderSource: String(decoderSource || '') };
}

/** Parses a GS1 AI 00 SSCC barcode and validates the embedded check digit. */
export function parseSsccBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/\(00\)/g, '00');
  // AI 00 is the leading AI of an SSCC barcode, so anchor at the start. A floating
  // match would hit "00" + 18 digits inside unrelated payloads (e.g. zero-padded
  // account fields in the StarTrack QR data) and report false check-digit failures.
  const match = compact.match(/^00(\d{18})(.*)$/);
  if (!match) return { valid: false, raw, reason: 'No AI 00 + 18 digit SSCC found.' };
  const sscc = match[1];
  // The spec requires FNC1 (the GS1 start control character) + AI 00 + the 18-digit SSCC
  // (20 digits in total) and NOTHING else in the linear symbol; trailing payload means the
  // symbol is not a conforming SSCC.
  if (match[2]) {
    return {
      valid: false,
      type: 'sscc',
      raw,
      ai: '00',
      sscc,
      articleId: `00${sscc}`,
      reason: `SSCC barcode carries unexpected data after the 20 digits of AI 00 + SSCC ("${match[2].slice(0, 24)}${match[2].length > 24 ? '...' : ''}"). The symbol must contain AI 00 + SSCC and nothing else.`
    };
  }
  const body = sscc.slice(0, -1);
  const checkDigit = sscc.slice(-1);
  const expected = gs1Mod10CheckDigit(body);
  return {
    valid: expected === checkDigit,
    type: 'sscc',
    raw,
    ai: '00',
    sscc,
    articleId: `00${sscc}`,
    extensionDigit: sscc[0],
    companyPrefixAndSerial: sscc.slice(1, -1),
    checkDigit,
    expectedCheckDigit: expected,
    reason:
      expected === checkDigit
        ? 'Valid SSCC check digit.'
        : `SSCC check digit mismatch. Expected ${expected}, got ${checkDigit}.`
  };
}
