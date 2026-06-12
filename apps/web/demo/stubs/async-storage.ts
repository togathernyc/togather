/**
 * In-memory stand-in for @react-native-async-storage/async-storage used only by
 * the demo (mock-data) build. The real app persists theme preference to native
 * storage; the demo doesn't need persistence, so this no-op keeps ThemeProvider
 * happy without pulling in the native module.
 */
const store = new Map<string, string>();

// Seed the app's theme preference so demos render in dark mode (matching a
// typical phone in dark appearance) rather than depending on the headless
// browser's color scheme.
store.set("@togather/theme-preference", "dark");

const AsyncStorage = {
  getItem: async (key: string) => store.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: async (key: string) => {
    store.delete(key);
  },
  clear: async () => {
    store.clear();
  },
};

export default AsyncStorage;
