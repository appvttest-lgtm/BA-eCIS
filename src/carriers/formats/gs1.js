// GS1 barcode primitives shared across carriers: scanner-output normalization,
// the GS1 mod-10 check digit, and the AI 00 SSCC parser. SSCC symbols appear on
// both eParcel and StarTrack labels, so this module must stay carrier-neutral.

/** Normalizes scanner output before parsing GS1 application identifiers and separators. */
export function normalizeBarcode(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\]C1/, '')
    .replace(/^\]d2/, '')
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

export function stripAiDecorations(raw) {
  return String(raw || '')
    .replace(/^\]C1/, '')
    .replace(/^\]d2/, '')
    .replace(/[\u001d\x1d\u001e\x1e\u001c\x1c|]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
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
  // The spec requires FNC1 + AI 00 + the 20-digit SSCC and NOTHING else in the
  // linear symbol; trailing payload means the symbol is not a conforming SSCC.
  if (match[2]) {
    return {
      valid: false,
      type: 'sscc',
      raw,
      ai: '00',
      sscc,
      articleId: `00${sscc}`,
      reason: `SSCC barcode carries unexpected data after the 20-digit SSCC ("${match[2].slice(0, 24)}${match[2].length > 24 ? '...' : ''}"). The symbol must contain AI 00 + SSCC and nothing else.`
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
