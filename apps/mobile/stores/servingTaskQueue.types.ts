/**
 * Shared types + pure helpers for the serving task queue.
 *
 * Kept dependency-free (no zustand / AsyncStorage) so both the native store
 * (`servingTaskQueue.ts`) and the web no-op stub (`servingTaskQueue.web.ts`)
 * can import them without pulling native-only modules into the web bundle.
 */

/**
 * Which backing mutation a queued completion replays through:
 *   - `template` → `toggleTaskCompletion` (role/assigned task; `timeLabel` for "during")
 *   - `personal` → `togglePersonalTask`
 *   - `shared`   → `toggleSharedTeamTask` (whole-team; needs `planId`)
 * (Crew and All-teams are read-only rollups and are never queued.)
 */
export type ServingTaskKind = "template" | "personal" | "shared";

export interface QueuedCompletion {
  /** Stable dedupe key (see `completionId`). */
  id: string;
  planId: string;
  kind: ServingTaskKind;
  /** `eventTasks` id (template/shared) or `personalServingTasks` id (personal). */
  taskId: string;
  /** Service-time label — only meaningful for a template "during" task. */
  timeLabel?: string;
  /** Desired final completion state to converge the server to. */
  completed: boolean;
  queuedAt: number;
}

/**
 * The completable unit's identity. A template "during" task is completable once
 * per service time, so its identity includes `timeLabel` — matching the
 * `key` field `getMyServingTasks` returns (`${taskId}::${timeLabel}`). Personal
 * and shared tasks are unique by `taskId` alone.
 */
export function completionId(
  kind: ServingTaskKind,
  taskId: string,
  timeLabel?: string | null,
): string {
  return kind === "template"
    ? `template:${taskId}:${timeLabel ?? ""}`
    : `${kind}:${taskId}`;
}
