/**
 * Rate Limiting for Authentication Endpoints
 *
 * Uses the Convex database to track request counts per key within
 * a sliding time window. Designed for brute-force prevention on
 * OTP send and verify endpoints.
 *
 * Records auto-reset when the time window expires -- no cleanup job needed.
 */

import type { MutationCtx } from "../_generated/server";

/**
 * Check and increment rate limit counter.
 *
 * If the caller has exceeded `maxAttempts` within `windowMs`, throws
 * with a generic "Too many attempts" error (no details leaked).
 *
 * If the previous window has expired, the counter resets automatically.
 *
 * @param ctx - Convex mutation context (needs DB read/write)
 * @param key - Rate limit key, e.g. "otp:+12025550123"
 * @param maxAttempts - Max allowed attempts within the window
 * @param windowMs - Window duration in milliseconds
 */
export async function checkRateLimit(
  ctx: MutationCtx,
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<void> {
  const now = Date.now();

  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  if (existing) {
    const windowExpired = now - existing.windowStart >= windowMs;

    if (windowExpired) {
      // Window expired -- reset counter
      await ctx.db.patch(existing._id, {
        attempts: 1,
        windowStart: now,
      });
      return;
    }

    // Still within the window
    if (existing.attempts >= maxAttempts) {
      throw new Error("Too many attempts. Please try again later.");
    }

    // Increment
    await ctx.db.patch(existing._id, {
      attempts: existing.attempts + 1,
    });
    return;
  }

  // First attempt -- create record
  await ctx.db.insert("rateLimits", {
    key,
    attempts: 1,
    windowStart: now,
  });
}
