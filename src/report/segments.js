// Display-layer barcode segmentation: slices decoded values into labelled,
// colour-coded fields. Slicing reuses the parsers (single source of truth).
import { analyzeArticleCandidate } from '../carriers/eparcel/formats/article.js';
import { STARTRACK_QR_FIELDS } from '../carriers/startrack/formats/qr.js';

/** Best-effort GS1 DataMatrix segmentation: split on group separators, else match the
 *  Australia Post AI pattern (01 GTIN, 91 article, 420 postcode, 92 DPID, 8008 date/time). */
/** Splits an eParcel article number into its individual spec elements (MLID + 7-digit
 *  consignment serial + article count + product + service + postage-paid + check digit).
 *  Structure and field lengths come from the audit engine's article parser (the single
 *  slicing source of truth); the original string is sliced so the display stays faithful.
 *  Returns null when the engine does not recognise a standard eParcel article. */
function articleSegments(article) {
  const c = String(article || '');
  const parsed = analyzeArticleCandidate(c)?.article;
  if (parsed?.type !== 'eparcel-standard' || parsed.articleId.length !== c.length) return null;
  const fields = [
    [parsed.mlidLength, 'MLID'],
    [7, 'Consignment serial'],
    [2, 'Article count'],
    [5, 'Product code'],
    [2, 'Service code'],
    [1, 'Postage paid'],
    [1, 'Check digit']
  ];
  let i = 0;
  return fields.map(([len, label]) => ({ text: c.slice(i, (i += len)), label }));
}

/** Length of the eParcel article ID at the front of an AI 91 payload. AusPost sometimes appends
 *  further AIs (420 postcode, 92 DPID, 8008 date) after the article with no separator, so prefer
 *  the shortest valid article length whose remainder is empty or begins with a known trailing AI.
 *  Also accepts the 20-char SSCC-as-article form (AI 00 + 18-digit SSCC in the AI 91 position,
 *  Parcel Post spec v1.4 p26); otherwise consume the whole payload (rendered as a single block). */
function eparcelArticleLength(payload) {
  const c = String(payload || '');
  const remainderOk = len => {
    const rest = c.slice(len);
    return rest === '' || /^(420|92|8008|00|01)/.test(rest);
  };
  for (const len of [21, 23]) {
    if (len <= c.length && articleSegments(c.slice(0, len)) && remainderOk(len)) return len;
  }
  if (/^00\d{18}$/.test(c.slice(0, 20)) && remainderOk(20)) return 20;
  return c.length;
}

function dataMatrixSegments(value, symbologyIdent = '') {
  const seg = (text, label) => ({ text, label });
  const AI_LABEL = {
    '00': 'AI 00 SSCC',
    '01': 'AI 01 GTIN',
    91: 'AI 91 article',
    420: 'AI 420 postcode',
    92: 'AI 92 DPID',
    8008: 'AI 8008 date/time'
  };
  // Fixed-value-length AIs can be consumed back-to-back without a separator; AI 91 (article) is
  // variable so it always runs to the end of its element.
  const FIXED = { '00': 18, '01': 14, 420: 4, 92: 8, 8008: 12 };
  const sepSeg = text => ({ text, label: 'FNC1 separator', display: '⟨FNC1⟩' });
  const splitElement = s => {
    const out = [];
    let i = 0;
    while (i < s.length) {
      // The spec's component table (Parcel Post v1.4 p19) places an FNC1 before AI 420,
      // 92 and 8008. When those AIs follow the previous element with no decoded
      // separator (many scanners strip FNC1 from the reported payload), mark the
      // expected boundary with a zero-length divider so the structure stays visible.
      if (i > 0 && /^(420|92|8008)/.test(s.slice(i, i + 4))) out.push(sepSeg(''));
      const fixed = Object.keys(FIXED).find(ai => s.startsWith(ai, i));
      if (fixed) {
        out.push(
          seg(fixed, AI_LABEL[fixed]),
          seg(s.slice(i + fixed.length, i + fixed.length + FIXED[fixed]), `${AI_LABEL[fixed]} value`)
        );
        i += fixed.length + FIXED[fixed];
        continue;
      }
      if (s.startsWith('91', i)) {
        const rest = s.slice(i + 2);
        out.push(seg('91', AI_LABEL['91']));
        // AI 91 (variable length) carries the eParcel article ID, sometimes followed by more
        // AusPost AIs (420 postcode, 92 DPID, 8008 date) with no separators. Peel the
        // fixed-length article off the front into its components, then let the loop parse the
        // trailing AIs instead of dumping the whole payload as one block.
        const artLen = eparcelArticleLength(rest);
        const artText = rest.slice(0, artLen);
        const artSegs = articleSegments(artText);
        if (artSegs) out.push(...artSegs);
        else if (/^00\d{18}$/.test(artText))
          // SSCC used as the article ID in the AI 91 position (Parcel Post spec v1.4 p26).
          out.push(seg('00', 'AI 00 SSCC'), seg(artText.slice(2), 'AI 00 SSCC value'));
        else out.push(seg(artText, `${AI_LABEL['91']} value`));
        i += 2 + artLen;
        continue;
      }
      out.push(seg(s.slice(i), 'GS1 element'));
      return out;
    }
    return out;
  };
  // Split on every separator representation a decoder can emit: GS/RS/FS control
  // characters, the pipe stand-in, CR/LF (some scanners report FNC1 as a newline),
  // and the literal "<GS>"/"<RS>"/"<FS>" strings produced by human-readable decode
  // modes. The separators are kept as their own segments - the original characters
  // stay as the segment text (so joins, positions and copies remain verbatim) and a
  // visible marker is rendered instead. Stray spaces/tabs at element edges are
  // trimmed the same way the engine's normalizeBarcode strips them before parsing.
  const tokens = String(value)
    .replace(/[()]/g, '')
    .split(/((?:[\x1d\x1e\x1c|\r\n]|<GS>|<RS>|<FS>)+)/);
  const out = tokens.flatMap((tok, idx) => {
    if (idx % 2 === 1) return [sepSeg(tok)];
    const t = tok.replace(/^[\t ]+|[\t ]+$/g, '');
    return t ? splitElement(t) : [];
  });
  // Zero-length segments survive only as display markers (expected-FNC1 dividers).
  const filtered = out.filter(s => String(s.text).length > 0 || s.display);
  // GS1 carriers require FNC1 in the FIRST position (GS1 DataMatrix: signalled as the
  // ]d2 symbology identifier, never as a data character). Mark the expected leading
  // position; when the decoder exposed the identifier it becomes the marker's text.
  const startMarker = {
    text: symbologyIdent,
    label: 'FNC1 start',
    display: symbologyIdent ? `⟨FNC1⟩ ${symbologyIdent}` : '⟨FNC1⟩'
  };
  return filtered.some(s => String(s.text).length > 0)
    ? [startMarker, ...filtered]
    : [seg(String(value), 'Decoded value')];
}

/** Splits a decoded barcode value into colour-coded field segments by its fixed format and field
 *  lengths, operating on the literal decoded value so the highlighted string matches the scan.
 *  Always returns at least one segment for a non-empty value; a concat check guarantees no
 *  character is dropped or duplicated (falls back to a single block when slicing is unreliable). */
export function rawSegments(rawValue, kind) {
  const v = String(rawValue || '').replace(/^\][A-Za-z0-9]{2}/, '');
  if (!v) return [];
  const seg = (text, label) => ({ text, label });
  const whole = [seg(v, 'Decoded value')];
  let out;
  switch (kind) {
    case 'qr': {
      out = STARTRACK_QR_FIELDS.map(f => seg(v.slice(f.pos - 1, f.pos - 1 + f.len), `${f.num}. ${f.label}`)).filter(
        s => s.text.length > 0
      );
      const consumed = STARTRACK_QR_FIELDS.reduce((m, f) => Math.max(m, f.pos - 1 + f.len), 0);
      if (v.length > consumed) out.push(seg(v.slice(consumed), 'Overflow / extra'));
      break;
    }
    case 'freight': {
      const c = v.replace(/[()]/g, '');
      if (/^00\d{18}$/.test(c)) return rawSegments(c, 'sscc');
      out = /^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(c)
        ? [
            seg(c.slice(0, 4), 'Despatch ID'),
            seg(c.slice(4, 12), 'Connote sequence'),
            seg(c.slice(12, 15), 'Product code'),
            seg(c.slice(15, 20), 'Item sequence')
          ]
        : whole;
      break;
    }
    case 'routing': {
      const c = v.replace(/[()\s]/g, '');
      const m421 = c.match(/^421(\d{3})(\d{4})(?:403([A-Z0-9]+))?$/);
      if (m421) {
        out = [seg('421', 'AI 421'), seg(m421[1], 'Country code'), seg(m421[2], 'Postcode')];
        if (m421[3]) out.push(seg('403', 'AI 403'), seg(m421[3], 'Label code'));
      } else {
        const m = c.match(/^([A-Z]{2,3})(\d{4})([A-Z0-9]{2,3})?$/);
        out = m ? [seg(m[1], 'Label code'), seg(m[2], 'Postcode'), ...(m[3] ? [seg(m[3], 'Depot/port')] : [])] : whole;
      }
      break;
    }
    case 'atl': {
      const m = v.replace(/[()]/g, '').match(/^(C)(\d{9})$/);
      out = m ? [seg('C', 'Prefix'), seg(m[2], 'Counter')] : whole;
      break;
    }
    case 'sscc': {
      const d = v.replace(/[()\s]/g, '');
      if (/^00\d{18}$/.test(d))
        out = [
          seg('00', 'AI 00'),
          seg(d.slice(2, 3), 'Extension digit'),
          seg(d.slice(3, 19), 'Company prefix + serial'),
          seg(d.slice(19), 'Check digit')
        ];
      else if (/^\d{18}$/.test(d))
        out = [
          seg(d.slice(0, 1), 'Extension digit'),
          seg(d.slice(1, 17), 'Company prefix + serial'),
          seg(d.slice(17), 'Check digit')
        ];
      else if (/^00/.test(d)) out = [seg('00', 'AI 00'), seg(d.slice(2), 'SSCC payload (malformed)')];
      else if (/^\d+$/.test(d)) out = [seg(d, 'SSCC payload (AI 00 missing)')];
      else out = whole;
      break;
    }
    case 'eparcel-linear-sscc':
    case 'eparcel-linear': {
      const c = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (/^00\d{18}$/.test(c)) return rawSegments(c, 'sscc');
      if (kind === 'eparcel-linear-sscc') return rawSegments(c, 'sscc');
      // GS1-128 carries AI 01 GTIN + AI 91 article; segment it by AI like the DataMatrix.
      if (/^01\d{14}91[A-Z0-9]+/.test(c)) return dataMatrixSegments(c);
      return rawSegments(c, 'article');
    }
    case 'article': {
      const c = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      out = articleSegments(c) || whole;
      break;
    }
    case 'datamatrix':
      return dataMatrixSegments(v, (String(rawValue).match(/^\][A-Za-z0-9]{2}/) || [])[0] || '');
    default:
      out = whole;
  }
  out = (out || []).filter(s => s && String(s.text).length > 0);
  if (!out.length) return whole;
  // Faithfulness guard: the coloured segments must reproduce the decoded value exactly.
  const joined = out.map(s => String(s.text)).join('');
  const cleaned = v.replace(/[()\s]/g, '').toUpperCase();
  if (joined !== v && joined.toUpperCase() !== cleaned) return whole;
  return out;
}
