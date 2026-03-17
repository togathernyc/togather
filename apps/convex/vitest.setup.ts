/**
 * Vitest global setup
 *
 * Suppresses "Write outside of transaction" unhandled rejections from convex-test.
 * These occur when scheduled actions (from ctx.scheduler.runAfter) try to run
 * during finishAllScheduledFunctions() but the action internally calls mutations
 * that are outside the test's transaction context. This is a known limitation
 * of convex-test with nested action → mutation patterns.
 */
process.on("unhandledRejection", (reason: any) => {
  if (
    reason instanceof Error &&
    reason.message.includes("Write outside of transaction")
  ) {
    // Silently suppress — this is expected from scheduled actions in convex-test
    return;
  }
  // Re-throw other unhandled rejections
  throw reason;
});
