import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfWatchdog, PDF_WATCHDOG_MS } from '../src/scanner/pdfWatchdog.js';

test('pdfWatchdog passes a resolved value through', async () => {
  assert.equal(await pdfWatchdog(Promise.resolve('ok'), 'rendering page 1', null, 50), 'ok');
});

test('pdfWatchdog passes the underlying rejection through', async () => {
  await assert.rejects(pdfWatchdog(Promise.reject(new Error('boom')), 'rendering page 1', null, 50), /boom/);
});

test('pdfWatchdog rejects a never-settling promise with the worker guidance', async () => {
  await assert.rejects(
    pdfWatchdog(new Promise(() => {}), 'rendering page 3 of PP.pdf', null, 20),
    /did not respond while rendering page 3 of PP\.pdf.*PDF worker may have failed to load.*reload/
  );
});

test('pdfWatchdog calls onTimeout after rejecting, so a cancel cannot mask the message', async () => {
  let cancelled = false;
  const hung = new Promise((_, reject) => {
    // Mimics pdf.js render cancellation: cancel() rejects the task's own promise.
    setTimeout(() => {
      if (cancelled) reject(new Error('RenderingCancelledException'));
    }, 0);
  });
  await assert.rejects(
    pdfWatchdog(hung, 'rendering page 1 of x.pdf', () => (cancelled = true), 20),
    /did not respond/
  );
  assert.equal(cancelled, true);
});

test('pdfWatchdog default delay is long enough for slow real renders', () => {
  assert.ok(PDF_WATCHDOG_MS >= 30_000);
});
