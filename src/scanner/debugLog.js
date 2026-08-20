// Diagnostic logging for unexpected scanner failures. Silent in production
// builds unless the operator opts in by running
//   localStorage.setItem('ba-debug', '1')
// in the browser console; always on under `npm run dev`.
function debugEnabled() {
  try {
    return Boolean(import.meta.env.DEV) || globalThis.localStorage?.getItem('ba-debug') === '1';
  } catch {
    return false;
  }
}

/** console.warn that is silent unless debug logging is enabled. */
export function debugWarn(...args) {
  if (debugEnabled()) console.warn(...args);
}
