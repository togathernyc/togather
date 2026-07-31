import type { convexTest } from "convex-test";

/**
 * Drain scheduled functions on real timers after a mutation/action call that
 * used `ctx.scheduler.runAfter(...)` (directly, or transitively).
 *
 * Left running, a scheduled job leaves convex-test's global transaction
 * state open — `global.Convex` outlives a single test file in a reused
 * vitest worker fork, so an undrained job in one file can trip "test began
 * while previous transaction was still open" in a completely unrelated test
 * file later in the same worker. That's what made this bug so hard to pin
 * down: it kept surfacing in event-checkin.test.ts even after that file's
 * own leak was fixed, because followup-refresh-state.test.ts (and others)
 * were leaking too and just happened to run before it.
 *
 * A single `t.finishInProgressScheduledFunctions()` call right after the
 * triggering call is not always enough on its own: it only awaits jobs
 * already IN_PROGRESS, and a zero-delay job may still be PENDING (its
 * `setTimeout(0)` hasn't fired yet) the instant the mutation returns — under
 * real CPU contention that race is losable, and a scheduled function that
 * itself schedules further work needs another pass to catch the nested job
 * too. This helper yields to the real macrotask queue first so a pending
 * timer gets a chance to fire, then drains, repeating a few times.
 *
 * Deliberately real timers only — never call this from a file that has
 * `vi.useFakeTimers()` active without an accompanying `vi.useRealTimers()`.
 * Fake timers are installed process-wide and share the same worker-global
 * lifetime as `global.Convex`, so a file that leaves them on owns a second
 * way to strand another file's scheduled work — and it also freezes the
 * `setTimeout(0)` this helper relies on to make progress in the first place.
 */
export async function drainScheduledFunctions(
  t: ReturnType<typeof convexTest>,
  iterations = 5,
): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
}
