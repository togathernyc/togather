/**
 * ServingTaskQueueSync - Drains the persisted serving-task completion queue
 * app-wide.
 *
 * The queue (`stores/servingTaskQueue.ts`) survives app restarts, but the flush
 * used to live in `ServingTasksScreen`, so completions checked off offline only
 * synced while the Tasks tab happened to be mounted. A volunteer who ticked
 * tasks offline and then walked to another tab (or backgrounded the app) kept
 * their work queued until they reopened Tasks online. Mounting the flush at the
 * app root — next to `KnicksModeSync`, the same headless render-nothing pattern
 * — makes sync depend on connectivity alone, not on navigation.
 *
 * Two triggers, both needed:
 *   - connectivity returns (or a new entry is queued) while we're rendered;
 *   - the app returns to the foreground, which covers signal that came back
 *     while the app was backgrounded and NetInfo never told us mid-session.
 *
 * Replay is safe because all three backing mutations take an explicit
 * `completed` boolean and are idempotent (see ADR-028), so an entry that gets
 * sent twice converges to the same server state.
 *
 * Renders nothing.
 */
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useConnectionStatus } from "@providers/ConnectionProvider";
import { useServingTaskQueue } from "@/stores/servingTaskQueue";

export function ServingTaskQueueSync() {
  const { isEffectivelyOffline } = useConnectionStatus();
  const queuePending = useServingTaskQueue((s) => s.pending);
  const dequeueCompletion = useServingTaskQueue((s) => s.dequeue);
  const toggleSharedTeamTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.toggleSharedTeamTask,
  );
  const toggleTaskCompletion = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.toggleTaskCompletion,
  );
  const togglePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.togglePersonalTask,
  );

  // Re-entrancy guard: the two triggers can fire at once (foregrounding often
  // coincides with reconnecting), and a Convex mutation in flight must not be
  // duplicated by a second pass over the same queue.
  const flushingRef = useRef(false);
  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      for (const op of useServingTaskQueue.getState().all()) {
        try {
          if (op.kind === "personal") {
            await togglePersonalTask({
              taskId: op.taskId as Id<"personalServingTasks">,
              completed: op.completed,
            });
          } else if (op.kind === "template") {
            await toggleTaskCompletion({
              taskId: op.taskId as Id<"eventTasks">,
              timeLabel: op.timeLabel,
              completed: op.completed,
            });
          } else {
            await toggleSharedTeamTask({
              planId: op.planId as Id<"eventPlans">,
              taskId: op.taskId as Id<"eventTasks">,
              completed: op.completed,
            });
          }
          // Only drop it if the desired state hasn't changed since we
          // snapshotted `all()` — the user may have gone offline mid-flush and
          // re-toggled this task, in which case `enqueue` replaced the entry and
          // we must keep the newer intent for the next flush.
          const current = useServingTaskQueue.getState().pending[op.id];
          if (current && current.completed === op.completed) {
            dequeueCompletion(op.id);
          }
        } catch {
          // Leave it queued; the next reconnect or foreground retries it.
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [
    togglePersonalTask,
    toggleTaskCompletion,
    toggleSharedTeamTask,
    dequeueCompletion,
  ]);

  // Reconnect (and newly-queued entries, including the entries AsyncStorage
  // rehydrates on cold start).
  useEffect(() => {
    if (isEffectivelyOffline) return;
    if (Object.keys(queuePending).length === 0) return;
    void flushQueue();
  }, [isEffectivelyOffline, queuePending, flushQueue]);

  // Foreground. Read connectivity through a ref: the listener is registered
  // once per `flushQueue` identity, so a captured `isEffectivelyOffline` would
  // go stale. If it's stale-offline, NetInfo corrects it within moments and the
  // effect above flushes instead.
  const offlineRef = useRef(isEffectivelyOffline);
  offlineRef.current = isEffectivelyOffline;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      if (offlineRef.current) return;
      if (useServingTaskQueue.getState().all().length === 0) return;
      void flushQueue();
    });
    return () => subscription.remove();
  }, [flushQueue]);

  return null;
}
