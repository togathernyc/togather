// Minimal polyfill for Convex WebSocket manager
// Convex calls window.addEventListener("online", ...) for network monitoring
// In React Native, window exists but addEventListener is undefined
// These no-ops are safe because React Native handles network connectivity differently
if (typeof window !== 'undefined') {
  if (typeof window.addEventListener !== 'function') {
    window.addEventListener = () => {};
  }
  if (typeof window.removeEventListener !== 'function') {
    window.removeEventListener = () => {};
  }
}

// Polyfill URL.canParse for React Native compatibility
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

// Load the Expo Router entry point
import 'expo-router/entry';
