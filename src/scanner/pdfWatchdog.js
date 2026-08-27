// pdf.js promises can stay pending forever when the pdf.worker request never
// completes (seen in an embedded Chromium: the worker fetch hangs, render never
// settles, no console error). Every pdf.js await in the PDF pipeline runs under
// this watchdog so a dead worker surfaces as an error banner instead of a
// silent hang.
export const PDF_WATCHDOG_MS = 30_000;

export function pdfWatchdog(promise, what, onTimeout = null, ms = PDF_WATCHDOG_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Reject before onTimeout: cancelling a pdf.js render task rejects its
      // promise too, and this message must be the one that wins the race.
      reject(
        new Error(
          `PDF rendering engine did not respond while ${what} (waited ${ms / 1000}s) — ` +
            'the PDF worker may have failed to load; reload the page and retry.'
        )
      );
      onTimeout?.();
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
