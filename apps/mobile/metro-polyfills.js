/**
 * Polyfills for Metro bundler compatibility
 */

// Polyfill for URL.canParse (available in Node 18.17+, 19.9+, 20+)
// Some environments may not have it available
if (typeof URL !== 'undefined' && !URL.canParse) {
  URL.canParse = function (url, base) {
    try {
      new URL(url, base);
      return true;
    } catch {
      return false;
    }
  };
}
