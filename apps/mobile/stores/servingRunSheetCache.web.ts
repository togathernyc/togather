/**
 * Serving Run Sheet Cache Store (Web) - No-op
 *
 * Offline caching is a native-only concern. On web, all methods are no-ops.
 */
const noop = () => {};
const noopNull = () => null;

// Stable singleton — same object reference on every access to avoid
// unnecessary React effect re-fires in consumers.
const state = {
  entries: {},
  setPlans: noop,
  getPlans: noopNull,
  getPlansStale: noopNull,
  setEvent: noop,
  getEvent: noopNull,
  getEventStale: noopNull,
  setItems: noop,
  getItems: noopNull,
  getItemsStale: noopNull,
  clearAll: noop,
};

const noopStore = {
  getState: () => state,
};

export const useServingRunSheetCache = Object.assign(() => state, noopStore);
