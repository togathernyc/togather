/**
 * Inbox Cache Store (Web) - No-op
 *
 * Offline caching is a native-only concern. On web, all methods are no-ops.
 */

const noop = () => {};
const noopNull = () => null;

// Stable singleton — same object reference on every access to avoid
// unnecessary React effect re-fires in consumers.
const state = {
  communities: {},
  setInboxChannels: noop,
  getInboxChannels: noopNull,
  clear: noop,
};

const noopStore = {
  getState: () => state,
};

export const useInboxCache = Object.assign(
  () => state,
  noopStore
);
