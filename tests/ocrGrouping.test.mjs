// Tests for the OCR word-geometry regrouping: noise filtering, run splitting and
// column-aware line ordering that keeps side-by-side label blocks contiguous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLineIntoRuns, groupBlockLinesIntoColumnText, textFromTesseractBlocks } from '../src/ocrText.js';

test('splitLineIntoRuns splits at column-sized gaps only', () => {
  const runs = splitLineIntoRuns(
    [
      { text: 'TO', x0: 0, x1: 20 },
      { text: 'JOHN', x0: 26, x1: 60 },
      { text: 'AVIATION', x0: 300, x1: 380 }
    ],
    100
  );
  assert.equal(runs.length, 2);
  assert.equal(runs[0].text, 'TO JOHN');
  assert.equal(runs[1].text, 'AVIATION');
});

const line = (height, ...words) => ({ words, height });
const word = (text, x0, x1) => ({ text, x0, x1 });

test('groupBlockLinesIntoColumnText keeps side-by-side columns contiguous', () => {
  const lines = [
    line(20, word('TO', 0, 20), word('JOHN', 26, 80), word('AVIATION', 300, 400), word('SECURITY', 406, 500)),
    line(
      20,
      word('1', 0, 10),
      word('MAIN', 16, 50),
      word('ST', 56, 90),
      word('DANGEROUS', 300, 420),
      word('GOODS', 426, 520)
    ),
    line(20, word('SYDNEY', 0, 60), word('NSW', 66, 95), word('2000', 101, 130))
  ];
  assert.deepEqual(groupBlockLinesIntoColumnText(lines), [
    'TO JOHN',
    '1 MAIN ST',
    'SYDNEY NSW 2000',
    'AVIATION SECURITY',
    'DANGEROUS GOODS'
  ]);
});

test('groupBlockLinesIntoColumnText passes single-column blocks through unchanged', () => {
  const lines = [
    line(18, word('DELIVERY', 0, 90), word('INSTRUCTIONS', 96, 220)),
    line(18, word('Leave', 0, 50), word('safe', 56, 90))
  ];
  assert.deepEqual(groupBlockLinesIntoColumnText(lines), ['DELIVERY INSTRUCTIONS', 'Leave safe']);
});

// Builds the nested block > paragraph > line > word shape tesseract.js returns, from simple word specs.
function tesseractBlock(linesSpec) {
  return {
    paragraphs: [
      {
        lines: linesSpec.map(words => ({
          bbox: { y0: 0, y1: 20 },
          words: words.map(w => ({
            text: w.text,
            confidence: w.confidence ?? 90,
            bbox: { x0: w.x0, x1: w.x1, y0: 0, y1: 20 }
          }))
        }))
      }
    ]
  };
}

test('textFromTesseractBlocks drops low-confidence noise words', () => {
  const blocks = [
    tesseractBlock([
      [
        { text: 'SYDNEY', x0: 0, x1: 60 },
        { text: '|l1I;', x0: 66, x1: 80, confidence: 8 },
        { text: 'NSW', x0: 86, x1: 120 }
      ]
    ])
  ];
  assert.equal(textFromTesseractBlocks(blocks), 'SYDNEY NSW');
});

test('textFromTesseractBlocks returns empty for missing block data so callers fall back', () => {
  assert.equal(textFromTesseractBlocks(null), '');
  assert.equal(textFromTesseractBlocks([]), '');
});
