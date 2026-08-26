// The optional StarTrack Authority To Leave barcode (C + 9-digit counter).
import { stripAiDecorations } from '../../formats/gs1.js';

/** Parses the optional StarTrack Authority To Leave barcode used when ATL is requested. */
export function parseStarTrackAtlBarcode(raw) {
  const compact = stripAiDecorations(raw).replace(/[()]/g, '');
  const match = compact.match(/^C(\d{9})$/);
  return match
    ? { valid: true, raw, atlNumber: compact, counter: match[1], counterNumber: Number(match[1]) }
    : { valid: false, raw, reason: 'Not a StarTrack ATL barcode.' };
}
