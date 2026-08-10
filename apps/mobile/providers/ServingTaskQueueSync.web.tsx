/**
 * ServingTaskQueueSync (Web) - No-op
 *
 * Offline write queueing is native-only (`stores/servingTaskQueue.web.ts` is
 * itself a no-op stub), so there is nothing to flush on web.
 */
export function ServingTaskQueueSync() {
  return null;
}
