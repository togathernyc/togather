/**
 * Scheduling — live presence for the roster grid (#477)
 *
 * "Who else is viewing/editing this roster right now." A deliberately
 * lightweight, Convex-native presence system: clients send a `heartbeat` every
 * few seconds while the grid is open, and a reactive `listViewers` query
 * returns whoever's heartbeat is still fresh. No external presence service, no
 * native deps.
 *
 * Grid scope (`gridKey`): the rostering group's id as a string. The roster grid
 * is scoped per campus group (`rosterMatrix({ groupId })`), so the group id is
 * the natural, stable grid scope. `heartbeat`/`leave`/`listViewers` resolve the
 * key back to a `groups` doc and gate on `requireGroupScheduler` — the same
 * permission `rosterMatrix` requires — so only people who can actually open the
 * grid appear in presence.
 *
 * Staleness is enforced READ-side in `listViewers`: any row whose `lastSeenAt`
 * is older than `PRESENCE_STALE_MS` is treated as "gone". This means a missed
 * `leave` (tab closed, app backgrounded) self-heals after the window — a
 * cleanup cron is optional, not required for correctness. (If row volume ever
 * matters, add a cron that deletes rows older than the window.)
 *
 * @see ./roster.ts (`rosterMatrix`) for the grid this tracks.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getMediaUrl } from "../../lib/utils";
import { requireGroupScheduler } from "./permissions";

/**
 * How long after a heartbeat a viewer is still considered present. A client
 * heartbeats well inside this window (e.g. every ~10s); 30s tolerates a missed
 * beat or two before the viewer drops out of `listViewers`.
 */
export const PRESENCE_STALE_MS = 30_000;

/** Build the user's display name the same way the rest of the app does. */
function buildName(
  firstName: string | undefined,
  lastName: string | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (first && last) return `${first} ${last}`;
  return first || last || "Someone";
}

/**
 * Validate that `gridKey` is a real `groups` id and that the caller may view
 * its roster grid (scheduler gate, matching `rosterMatrix`). Returns the
 * resolved group id. Throws `ConvexError` so the mobile `AuthErrorBoundary`
 * can recover.
 */
async function requireGridAccess(
  ctx: Parameters<typeof requireGroupScheduler>[0],
  gridKey: string,
  userId: Id<"users">,
): Promise<Id<"groups">> {
  // `gridKey` is the group id as a string. `db.get` with a malformed/foreign
  // id throws; `requireGroupScheduler` re-checks existence + permission.
  const groupId = ctx.db.normalizeId("groups", gridKey);
  if (!groupId) {
    throw new ConvexError("Invalid roster grid");
  }
  await requireGroupScheduler(ctx, groupId, userId);
  return groupId;
}

/**
 * Upsert the calling user's presence row for a grid, stamping the current
 * time. Idempotent per (gridKey, userId): the client calls this on an interval
 * while the grid is open. Auth: roster scheduler for the grid's group.
 */
export const heartbeat = mutation({
  args: {
    token: v.string(),
    gridKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGridAccess(ctx, args.gridKey, userId);

    const now = Date.now();
    const user = await ctx.db.get(userId);
    const name = buildName(user?.firstName, user?.lastName);
    const avatarUrl = getMediaUrl(user?.profilePhoto);

    const existing = await ctx.db
      .query("rosterPresence")
      .withIndex("by_gridKey_user", (q) =>
        q.eq("gridKey", args.gridKey).eq("userId", userId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now, name, avatarUrl });
    } else {
      await ctx.db.insert("rosterPresence", {
        gridKey: args.gridKey,
        userId,
        lastSeenAt: now,
        name,
        avatarUrl,
      });
    }
    return null;
  },
});

/**
 * Reactive list of OTHER viewers currently present on a grid (caller excluded —
 * the UI shows "others editing"). Rows older than `PRESENCE_STALE_MS` are
 * filtered out, so a missed `leave` self-heals. Auth: roster scheduler.
 */
export const listViewers = query({
  args: {
    token: v.string(),
    gridKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGridAccess(ctx, args.gridKey, userId);

    const cutoff = Date.now() - PRESENCE_STALE_MS;
    const rows = await ctx.db
      .query("rosterPresence")
      .withIndex("by_gridKey", (q) => q.eq("gridKey", args.gridKey))
      .collect();

    return rows
      .filter((r) => r.userId !== userId && r.lastSeenAt >= cutoff)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((r) => ({
        userId: r.userId,
        name: r.name,
        avatarUrl: r.avatarUrl,
        lastSeenAt: r.lastSeenAt,
      }));
  },
});

/**
 * Best-effort removal of the caller's presence row on grid unmount. Not
 * required for correctness (the staleness window handles drop-off), but keeps
 * the "others" list tight when a viewer leaves cleanly. No-op if no row exists.
 */
export const leave = mutation({
  args: {
    token: v.string(),
    gridKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGridAccess(ctx, args.gridKey, userId);

    const existing = await ctx.db
      .query("rosterPresence")
      .withIndex("by_gridKey_user", (q) =>
        q.eq("gridKey", args.gridKey).eq("userId", userId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});
