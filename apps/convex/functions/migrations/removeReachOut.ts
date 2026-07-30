/**
 * Migration: remove all Reach Out data
 *
 * The Reach Out channel feature is gone. Its schema surface went with it —
 * the `reachOutRequests` table, `groups.reachOutConfig`,
 * `chatMessages.reachOutRequestId`, and `memberFollowups.reachOutRequestId`.
 *
 * ORDERING MATTERS. Convex validates every existing document against the
 * schema at push time, and an undeclared field on a live document fails that
 * check. So on any deployment that already holds Reach Out data, this cleanup
 * has to run BEFORE the schema removal deploys — otherwise the deploy is
 * rejected. Per deployment (staging, then production):
 *
 *   1. From a checkout that still has the old schema (i.e. the commit before
 *      the Reach Out removal), push this file on its own:
 *        npx convex deploy   # or `npx convex dev` for a personal deployment
 *   2. Count what would change, then run it for real:
 *        npx convex run functions/migrations/removeReachOut:removeReachOutData '{"dryRun":true}'
 *        npx convex run functions/migrations/removeReachOut:removeReachOutData
 *   3. Watch it finish — the run is asynchronous (see below):
 *        npx convex logs | grep removeReachOut
 *      Wait for `[removeReachOut] DONE`, which carries the tallies. In dry-run
 *      mode those are the counts a real run would touch.
 *   4. Deploy the Reach Out removal. Schema validation now passes.
 *
 * A brand-new or empty deployment needs none of this — the dry run reports
 * zeroes and the schema pushes clean.
 *
 * WHY IT IS ASYNCHRONOUS. None of these collections is bounded: `chatMessages`
 * spans every channel in the deployment, and a Reach Out channel on a
 * whole-community group carries a membership row per member. A single mutation
 * cannot read or write them all — it would blow Convex's per-transaction
 * document limit and abort with nothing committed, which no amount of
 * re-running would get past. So the work is a chain of scheduled mutations,
 * each with its own transaction budget, each committing its page before
 * scheduling the next. Progress is durable: a page that commits stays
 * committed, and no step ever scans an unbounded range inline.
 *
 * Two traversal styles, picked per step:
 *   - Steps that DELETE rows drain: take the first page, delete it, and come
 *     back for another page until the query returns empty. A saved cursor
 *     would be invalidated by the deletes; "is there anything left?" is
 *     self-correcting. (Dry runs delete nothing, so they cursor-walk instead —
 *     a drain loop would never terminate.)
 *   - Steps that PATCH rows cursor-walk. The row survives the write, so the
 *     cursor stays valid, and the patch clears the field that made the row
 *     match, so one pass is enough.
 *
 * What it does, in order (idempotent — safe to re-run at any point):
 *   1. Deletes every `reachOutRequests` document.
 *   2. Deletes each `reach_out` chat channel, first draining its membership
 *      rows, messages, and read state.
 *   3. Clears `reachOutRequestId` from the remaining chat messages, and
 *      retypes the `reach_out_request` cards in leaders channels to
 *      `contentType: "system"`. Their text ("<name>: <preview>") is left as
 *      written, so the leaders-channel history still reads sensibly with no
 *      card left to render.
 *   4. Clears `reachOutRequestId` from member followups and retypes rows of
 *      type `reach_out` to `note` — the history entry stays, it just lands in
 *      the generic bucket.
 *   5. Retypes tasks with `sourceType: "reach_out"` to `manual` and strips the
 *      `reach_out` tag; leaders keep the open work item.
 *   6. Clears `reachOutConfig` from groups.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Documents touched per scheduled call. Each call gets its own 4096-document
 * read budget; 200 leaves generous headroom for the per-row work above.
 */
const PAGE = 200;

const statsValidator = v.object({
  requests: v.number(),
  channels: v.number(),
  channelMembers: v.number(),
  channelMessages: v.number(),
  channelReadStates: v.number(),
  messages: v.number(),
  followups: v.number(),
  tasks: v.number(),
  groups: v.number(),
});

type Stats = {
  requests: number;
  channels: number;
  channelMembers: number;
  channelMessages: number;
  channelReadStates: number;
  messages: number;
  followups: number;
  tasks: number;
  groups: number;
};

const ZERO: Stats = {
  requests: 0,
  channels: 0,
  channelMembers: 0,
  channelMessages: 0,
  channelReadStates: 0,
  messages: 0,
  followups: 0,
  tasks: 0,
  groups: 0,
};

const cursorValidator = v.union(v.string(), v.null());

/**
 * Entry point. Kicks off the chain and returns immediately — follow the run in
 * `npx convex logs` and wait for `[removeReachOut] DONE`.
 */
export const removeReachOutData = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    console.log(`[removeReachOut] starting (dryRun=${dryRun})`);
    await ctx.scheduler.runAfter(
      0,
      internal.functions.migrations.removeReachOut.purgeRequests,
      { dryRun, stats: ZERO, cursor: null },
    );
    return {
      started: true,
      dryRun,
      note: "Asynchronous. Watch `npx convex logs` for `[removeReachOut] DONE`.",
    };
  },
});

/** Step 1 — clear out `reachOutRequests`. */
export const purgeRequests = internalMutation({
  args: {
    dryRun: v.boolean(),
    stats: statsValidator,
    cursor: cursorValidator,
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const stats: Stats = { ...args.stats };

    if (args.dryRun) {
      const page = await db
        .query("reachOutRequests")
        .paginate({ cursor: args.cursor, numItems: PAGE });
      stats.requests += page.page.length;
      if (!page.isDone) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.migrations.removeReachOut.purgeRequests,
          { dryRun: true, stats, cursor: page.continueCursor },
        );
        return;
      }
    } else {
      const page = await db.query("reachOutRequests").take(PAGE);
      if (page.length > 0) {
        for (const request of page) {
          await db.delete(request._id);
        }
        stats.requests += page.length;
        // Deletes committed; look again from the top for whatever is left.
        await ctx.scheduler.runAfter(
          0,
          internal.functions.migrations.removeReachOut.purgeRequests,
          { dryRun: false, stats, cursor: null },
        );
        return;
      }
    }

    await ctx.scheduler.runAfter(
      0,
      internal.functions.migrations.removeReachOut.findNextChannel,
      { dryRun: args.dryRun, stats, cursor: null },
    );
  },
});

/**
 * Step 2a — walk `chatChannels` looking for `reach_out` channels.
 *
 * Real runs hand the first one found to `purgeChannel`, which restarts this
 * walk from the top once the channel is gone: deleting the channel invalidates
 * any cursor we were holding, and since each pass removes one channel the
 * restart terminates. `chatChannels` is small next to the message tables, so
 * re-walking it is cheap. Dry runs delete nothing, so they just tally each
 * page and cursor straight through.
 */
export const findNextChannel = internalMutation({
  args: {
    dryRun: v.boolean(),
    stats: statsValidator,
    cursor: cursorValidator,
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const page = await db
      .query("chatChannels")
      .paginate({ cursor: args.cursor, numItems: PAGE });

    const stats: Stats = { ...args.stats };
    const reachOut = page.page.filter(
      (channel: any) => channel.channelType === "reach_out",
    );

    if (args.dryRun) {
      // Dependents are cascaded by the real run; the channel count is what a
      // dry run can report without an unbounded per-channel scan.
      stats.channels += reachOut.length;
    } else if (reachOut.length > 0) {
      stats.channels += 1;
      await ctx.scheduler.runAfter(
        0,
        internal.functions.migrations.removeReachOut.purgeChannel,
        { dryRun: false, stats, channelId: reachOut[0]._id },
      );
      return;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.migrations.removeReachOut.findNextChannel,
        { dryRun: args.dryRun, stats, cursor: page.continueCursor },
      );
      return;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.functions.migrations.removeReachOut.clearMessages,
      { dryRun: args.dryRun, stats, cursor: null },
    );
  },
});

/**
 * Step 2b — drain one channel's dependents, then delete the channel itself.
 *
 * Members, messages, and read state each drain a page per call. The channel row
 * is deleted only once all three come back empty, so an interrupted run never
 * leaves orphaned rows pointing at a channel that no longer exists.
 */
export const purgeChannel = internalMutation({
  args: {
    dryRun: v.boolean(),
    stats: statsValidator,
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const stats: Stats = { ...args.stats };

    const dependents = [
      ["chatChannelMembers", "channelMembers"],
      ["chatMessages", "channelMessages"],
      ["chatReadState", "channelReadStates"],
    ] as const;

    for (const [table, key] of dependents) {
      const page = await db
        .query(table)
        .withIndex("by_channel", (q: any) => q.eq("channelId", args.channelId))
        .take(PAGE);
      if (page.length === 0) continue;

      for (const row of page) {
        await db.delete(row._id);
      }
      stats[key] += page.length;
      // More may remain — come back for the next page before deleting the
      // channel.
      await ctx.scheduler.runAfter(
        0,
        internal.functions.migrations.removeReachOut.purgeChannel,
        { dryRun: false, stats, channelId: args.channelId },
      );
      return;
    }

    await db.delete(args.channelId);
    console.log(
      `[removeReachOut] purged channel ${args.channelId} ` +
        `(cumulative: ${stats.channelMembers} members, ` +
        `${stats.channelMessages} messages)`,
    );
    await ctx.scheduler.runAfter(
      0,
      internal.functions.migrations.removeReachOut.findNextChannel,
      { dryRun: false, stats, cursor: null },
    );
  },
});

/**
 * Step 3 — clear `reachOutRequestId` off the remaining chat messages.
 *
 * Messages inside Reach Out channels are already gone; what's left are the
 * request cards posted into leaders channels. There is no index on
 * `reachOutRequestId`, so this is a full cursor walk of `chatMessages`. The
 * patch clears the matching field, so a single pass suffices.
 */
export const clearMessages = internalMutation({
  args: {
    dryRun: v.boolean(),
    stats: statsValidator,
    cursor: cursorValidator,
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const page = await db
      .query("chatMessages")
      .paginate({ cursor: args.cursor, numItems: PAGE });

    const stats: Stats = { ...args.stats };
    for (const message of page.page) {
      const isCard =
        message.reachOutRequestId !== undefined ||
        message.contentType === "reach_out_request";
      if (!isCard) continue;
      stats.messages++;
      if (args.dryRun) continue;
      // Keep the message so the leaders-channel timeline isn't torn up, but
      // drop the card reference — nothing renders `reach_out_request` now.
      await db.patch(message._id, {
        reachOutRequestId: undefined,
        contentType:
          message.contentType === "reach_out_request"
            ? "system"
            : message.contentType,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.migrations.removeReachOut.clearMessages,
        { dryRun: args.dryRun, stats, cursor: page.continueCursor },
      );
      return;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.functions.migrations.removeReachOut.clearFollowups,
      { dryRun: args.dryRun, stats, cursor: null },
    );
  },
});

/** Step 4 — clear the followup link and retype `reach_out` rows to `note`. */
export const clearFollowups = internalMutation({
  args: {
    dryRun: v.boolean(),
    stats: statsValidator,
    cursor: cursorValidator,
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const page = await db
      .query("memberFollowups")
      .paginate({ cursor: args.cursor, numItems: PAGE });

    const stats: Stats = { ...args.stats };
    for (const followup of page.page) {
      if (
        followup.reachOutRequestId === undefined &&
        followup.type !== "reach_out"
      ) {
        continue;
      }
      stats.followups++;
      if (args.dryRun) continue;
      await db.patch(followup._id, {
        reachOutRequestId: undefined,
        type: followup.type === "reach_out" ? "note" : followup.type,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.migrations.removeReachOut.clearFollowups,
        { dryRun: args.dryRun, stats, cursor: page.continueCursor },
      );
      return;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.functions.migrations.removeReachOut.retypeTasks,
      { dryRun: args.dryRun, stats, cursor: null },
    );
  },
});

/** Step 5 — retype reach-out tasks to `manual` and strip the tag. */
export const retypeTasks = internalMutation({
  args: {
    dryRun: v.boolean(),
    stats: statsValidator,
    cursor: cursorValidator,
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const page = await db
      .query("tasks")
      .paginate({ cursor: args.cursor, numItems: PAGE });

    const stats: Stats = { ...args.stats };
    for (const task of page.page) {
      const tags: string[] = task.tags ?? [];
      if (task.sourceType !== "reach_out" && !tags.includes("reach_out")) {
        continue;
      }
      stats.tasks++;
      if (args.dryRun) continue;
      await db.patch(task._id, {
        sourceType: task.sourceType === "reach_out" ? "manual" : task.sourceType,
        tags: tags.filter((tag) => tag !== "reach_out"),
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.migrations.removeReachOut.retypeTasks,
        { dryRun: args.dryRun, stats, cursor: page.continueCursor },
      );
      return;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.functions.migrations.removeReachOut.clearGroupConfig,
      { dryRun: args.dryRun, stats, cursor: null },
    );
  },
});

/** Step 6 — clear `reachOutConfig` from groups, then report. */
export const clearGroupConfig = internalMutation({
  args: {
    dryRun: v.boolean(),
    stats: statsValidator,
    cursor: cursorValidator,
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const page = await db
      .query("groups")
      .paginate({ cursor: args.cursor, numItems: PAGE });

    const stats: Stats = { ...args.stats };
    for (const group of page.page) {
      if (group.reachOutConfig === undefined) continue;
      stats.groups++;
      if (args.dryRun) continue;
      await db.patch(group._id, { reachOutConfig: undefined });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.migrations.removeReachOut.clearGroupConfig,
        { dryRun: args.dryRun, stats, cursor: page.continueCursor },
      );
      return;
    }

    console.log(
      `[removeReachOut] DONE (dryRun=${args.dryRun}) ${JSON.stringify(stats)}`,
    );
  },
});
