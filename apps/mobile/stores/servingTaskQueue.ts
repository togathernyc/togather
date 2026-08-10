/**
 * Serving Task Queue Store
 *
 * Persisted (AsyncStorage) queue of serving-task completion toggles made while
 * offline, so volunteers at a venue with poor signal can still check tasks off
 * and have them sync when connectivity returns.
 *
 * Unlike the chat send queue (`useConvexSendMessage`, in-memory only), this
 * queue is PERSISTED — a volunteer may close the app between going offline and
 * getting signal back, and their completions must not be lost.
 *
 * Semantics: last-write-wins. Each pending entry stores the DESIRED final
 * `completed` state for a task (not a flip), keyed by a stable id, so toggling
 * the same task twice offline collapses to a single entry. The three backing
 * mutations (`toggleTaskCompletion` / `togglePersonalTask` / `toggleSharedTeamTask`)
 * all take an explicit `completed` boolean and are idempotent, so replaying a
 * pending entry on reconnect is always safe (see ADR-028).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  completionId,
  type QueuedCompletion,
  type ServingTaskKind,
} from "./servingTaskQueue.types";

export { completionId };
export type { QueuedCompletion, ServingTaskKind };

interface ServingTaskQueueState {
  /** Pending completions keyed by `completionId`. */
  pending: Record<string, QueuedCompletion>;
  /** Upsert a desired completion state (last-write-wins on the same task). */
  enqueue: (op: {
    planId: string;
    kind: ServingTaskKind;
    taskId: string;
    timeLabel?: string | null;
    completed: boolean;
  }) => void;
  /** Remove a synced (or superseded) entry. */
  dequeue: (id: string) => void;
  /** The desired state for a task if one is queued, else undefined. */
  desiredState: (
    kind: ServingTaskKind,
    taskId: string,
    timeLabel?: string | null,
  ) => boolean | undefined;
  /** Every pending entry (used by the reconnect flusher; not plan-filtered). */
  all: () => QueuedCompletion[];
  clear: () => void;
}

export const useServingTaskQueue = create<ServingTaskQueueState>()(
  persist(
    (set, get) => ({
      pending: {},

      enqueue: ({ planId, kind, taskId, timeLabel, completed }) => {
        const id = completionId(kind, taskId, timeLabel);
        set((state) => ({
          pending: {
            ...state.pending,
            [id]: {
              id,
              planId,
              kind,
              taskId,
              timeLabel: timeLabel ?? undefined,
              completed,
              queuedAt: Date.now(),
            },
          },
        }));
      },

      dequeue: (id: string) => {
        set((state) => {
          if (!(id in state.pending)) return state;
          const pending = { ...state.pending };
          delete pending[id];
          return { pending };
        });
      },

      desiredState: (kind, taskId, timeLabel) => {
        const id = completionId(kind, taskId, timeLabel);
        return get().pending[id]?.completed;
      },

      all: () => Object.values(get().pending),

      clear: () => set({ pending: {} }),
    }),
    {
      name: "serving-task-queue",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pending: state.pending }),
    },
  ),
);
