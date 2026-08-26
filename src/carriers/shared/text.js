// Shared visible-text primitives used by both carriers' fact extraction:
// line normalization, address/DG block walkers, and AU state matching.
// The AU state list comes from the eParcel base rule constants - the single
// source of truth - so the text heuristics and address rules can never drift.
import eparcelBase from '../eparcel/base/rules.json' with { type: 'json' };

export const AU_STATES = eparcelBase.constants.auStates;

export const STATE_REGEX = `(?:${AU_STATES.join('|')})`;
const POSTCODE_LINE_REGEX = new RegExp(`\\b([A-Z][A-Z\\s'-]+?\\s+${STATE_REGEX}\\s+\\d{4})\\b`, 'i');
const ADDRESS_STATE_REGEX = new RegExp(`\\b(${STATE_REGEX})\\b\\s+\\d{4}\\s*$`, 'i');

// Extracted text is attacker-controlled (crafted PDF text layers, OCR of
// uploaded images). Some extraction regexes backtrack quadratically on
// pathological lines, so line length and count are capped well above anything
// a real label produces.
const MAX_TEXT_LINE_LENGTH = 1000;
const MAX_TEXT_LINES = 2000;

/** Splits selectable PDF text into normalized non-empty lines for visible-content checks. */
export function textLines(extractedText) {
  return String(extractedText || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/, MAX_TEXT_LINES)
    .map(line => line.trim().slice(0, MAX_TEXT_LINE_LENGTH))
    .filter(Boolean);
}

export function firstLineValue(lines, regex) {
  for (const line of lines) {
    const match = line.match(regex);
    if (match) return match[1].trim();
  }
  return null;
}

function cleanAddressLine(line) {
  return String(line || '')
    .replace(/\s{3,}.*$/, '')
    .replace(/\bThe sender acknowledges\b.*$/i, '')
    .replace(/\band clearing procedures\b.*$/i, '')
    .replace(/\bthe article does not contain\b.*$/i, '')
    .replace(/\bprohibited goods\b.*$/i, '')
    .replace(/\s+Declaration$/i, '')
    .trim();
}

function isDgText(line) {
  return /Aviation\s+Security|Dangerous\s+Goods|Declaration|sender acknowledges|sender declares|carried by air|clearing procedures|does not contain|not contain|prohibited goods|explosive|incendiary|criminal offence/i.test(
    String(line || '')
  );
}

function isOperationalLine(line) {
  return /^(DELIVERY\s+INSTRUCTIONS|Delivery\s+features|Signature\b|Con(?:s(?:ignment)?)?\s*No\b|PARCEL\b|AP\s*Article|Postage\s*Paid|Dead\s*weight|Weight\b|Ph\b|PHONE\b)/i.test(
    String(line || '').trim()
  );
}

export function extractToBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /^\s*(To|Deliver\s*To)\b:?/i.test(line)) {
      inBlock = true;
      line = line.replace(/^\s*(To|Deliver\s*To)\b:?/i, '').trim();
      if (/^PHONE\b/i.test(line)) continue;
      line = line.replace(/^PHONE\b:?\s*/i, '').trim();
      if (line && !isOperationalLine(line)) out.push(cleanAddressLine(line));
      continue;
    }
    if (inBlock) {
      if (isOperationalLine(line) || /^From\b|^Sender\b/i.test(line)) break;
      const cleaned = cleanAddressLine(line);
      if (cleaned && !/^PHONE\b/i.test(cleaned)) out.push(cleaned);
    }
  }
  return out.filter(Boolean);
}

export function extractFromBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /^\s*(From|Sender)\b:?/i.test(line)) {
      inBlock = true;
      line = line.replace(/^\s*(From|Sender)\b:?/i, '').trim();
      line = line.replace(/Aviation\s+Security.*$/i, '').trim();
      const cleaned = cleanAddressLine(line);
      if (cleaned && !isDgText(cleaned)) out.push(cleaned);
      continue;
    }
    if (inBlock) {
      if (/^AP\s*Article|^Delivery\s*features|^DELIVER\s+TO|^TO\b/i.test(line)) break;
      const cleaned = cleanAddressLine(line);
      if (!cleaned) continue;
      if (isDgText(cleaned)) continue;
      out.push(cleaned);
      if (POSTCODE_LINE_REGEX.test(cleaned)) break;
    }
  }
  return out.filter(Boolean);
}

export function extractDgBlock(lines) {
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    let line = String(rawLine || '').trim();
    if (!inBlock && /Aviation\s+Security.*Dangerous\s+Goods/i.test(line)) {
      inBlock = true;
      const idx = line.search(/Aviation\s+Security/i);
      out.push(line.slice(idx).trim());
      continue;
    }
    if (inBlock) {
      if (/^AP\s*Article|^DELIVER\s+TO|^TO\b|^SENDER\b|^FROM\b/i.test(line) && !isDgText(line)) break;
      let dgLine = line;
      // PDF text extraction can merge the left sender address with the right DG declaration.
      // Remove the address prefix so DG evidence stays in the declaration block only.
      dgLine = dgLine.replace(/^Australia Postal Corporation\s+/i, '');
      dgLine = dgLine.replace(/^Level\s+[^\t]{1,40}?\s{2,}/i, '');
      dgLine = dgLine.replace(new RegExp(`^[A-Z][A-Z\\s'-]+\\s+${STATE_REGEX}\\s+\\d{4}\\s{2,}`, 'i'), '');
      dgLine = dgLine.trim();
      if (dgLine && isDgText(dgLine)) out.push(dgLine);
      if (/criminal offence/i.test(dgLine)) break;
    }
  }
  return out.filter(Boolean);
}

export function extractPostcodeLines(lines) {
  const found = [];
  for (const line of lines) {
    const m = String(line || '')
      .toUpperCase()
      .match(POSTCODE_LINE_REGEX);
    if (m) found.push(m[1].replace(/\s+/g, ' ').trim());
  }
  return [...new Set(found)];
}

/** Reads the state from a "SUBURB STATE POSTCODE" line so routing details can be cross-checked. */
export function addressState(line) {
  const match = String(line || '').match(ADDRESS_STATE_REGEX);
  return match ? match[1].toUpperCase() : null;
}

export function lastAddressLine(block = []) {
  return [...block].reverse().find(line => /\d{4}\s*$/.test(String(line))) || block[block.length - 1] || '';
}

export function uniqueNonEmpty(values = []) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}
