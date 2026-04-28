/**
 * Feature Flags
 *
 * Database-backed APP-WIDE on/off switches for staged feature rollouts.
 * Flipped by Togather superusers via `/(user)/admin/features`.
 *
 * Design notes:
 * - Flags are GLOBAL — one row per key, applied to every user across every
 *   community. Community primary admins are NOT permitted to flip them,
 *   only Togather staff/superusers, since these gate platform features
 *   that aren't community-scoped.
 * - Deliberately simpler than PostHog targeting — Seyi found PostHog too
 *   complex for the rollouts he actually does, so the operational model is
 *   "set up the flag, ramp by flipping the switch."
 * - When a flag's feature has fully ramped, the row and the gate sites are
 *   removed together — there's no "flag retired" intermediate state.
 * - Reads are an unauthenticated query so gates don't need to wait for the
 *   user's session before deciding what to render.
 */
import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";

/**
 * Throw unless the caller is a Togather superuser or staff member.
 * Inline with the rest of the codebase (proposals.ts, posters.ts) — no
 * dedicated helper because the check is small and only used in a few
 * platform-level admin endpoints.
 */
async function requireSuperuser(
  ctx: { db: { get: (id: any) => Promise<any> } },
  userId: any,
): Promise<void> {
  const user = await ctx.db.get(userId);
  if (!user?.isStaff && !user?.isSuperuser) {
    throw new Error("Superuser access required");
  }
}

/**
 * Get the current value of a single feature flag. Returns `false` if the row
 * doesn't exist yet (default-off semantics).
 */
export const getFeatureFlag = query({
  args: {
    key: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    return flag?.enabled ?? false;
  },
});

/**
 * List all feature flags for the admin UI. Returns flags ordered by key.
 * Auth-gated to superusers only — the existence of a flag (and its
 * description) can leak in-progress feature names, and these are
 * platform-level switches that community admins shouldn't be able to
 * see or flip.
 */
export const listFeatureFlags = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireSuperuser(ctx, userId);

    const flags = await ctx.db.query("featureFlags").collect();
    return flags
      .map((f) => ({
        _id: f._id,
        key: f.key,
        enabled: f.enabled,
        description: f.description ?? null,
        updatedAt: f.updatedAt,
        updatedById: f.updatedById ?? null,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  },
});

/**
 * Set a feature flag's value. Creates the row if it doesn't exist yet,
 * otherwise patches it. Authoring history is intentionally minimal —
 * `updatedAt` + `updatedById` cover the "who flipped this and when"
 * audit need without a separate event log table. Superuser only —
 * see `listFeatureFlags`.
 */
export const setFeatureFlag = mutation({
  args: {
    token: v.string(),
    key: v.string(),
    enabled: v.boolean(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireSuperuser(ctx, userId);

    const trimmedKey = args.key.trim();
    if (trimmedKey.length === 0) {
      throw new Error("Feature flag key cannot be empty");
    }

    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", trimmedKey))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        ...(args.description !== undefined
          ? { description: args.description }
          : {}),
        updatedAt: now,
        updatedById: userId,
      });
    } else {
      await ctx.db.insert("featureFlags", {
        key: trimmedKey,
        enabled: args.enabled,
        description: args.description,
        updatedAt: now,
        updatedById: userId,
      });
    }
    return { ok: true };
  },
});
