/**
 * Serving Task Queue Store (Web) - No-op
 *
 * Offline queueing is a native-only concern. On web, every method is a no-op
 * and nothing is ever pending, so consumers always take the online path.
 */
import { completionId, type QueuedCompletion } from "./servingTaskQueue.types";

const noop = () => {};

// Stable singleton — same object reference on every access to avoid
// unnecessary React effect re-fires in consumers.
const state = {
  pending: {} as Record<string, QueuedCompletion>,
  enqueue: noop,
  dequeue: noop,
  desiredState: () => undefined as boolean | undefined,
  all: () => [] as QueuedCompletion[],
  clear: noop,
};

const noopStore = {
  getState: () => state,
};

// Selector-aware so consumers using `useServingTaskQueue((s) => s.pending)`
// get the field, not the whole state object.
export const useServingTaskQueue = Object.assign(
  <T>(selector?: (s: typeof state) => T) =>
    selector ? selector(state) : (state as unknown as T),
  noopStore,
);
export { completionId };
