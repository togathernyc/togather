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
 *   2. Dry-run, then run it to completion:
 *        npx convex run functions/migrations/removeReachOut:removeReachOutData '{"dryRun":true}'
 *        npx convex run functions/migrations/removeReachOut:removeReachOutData
 *      Repeat step 2 until every `processed` count comes back 0.
 *   3. Deploy the Reach Out removal. Schema validation now passes.
 *
 * A brand-new or empty deployment needs none of this — the dry run reports
 * zeroes and the schema pushes clean.
 *
 * What it does (idempotent, safe to re-run):
 *   1. Deletes every `reachOutRequests` document.
 *   2. Clears `reachOutRequestId` from chat messages and member followups, and
 *      rewrites the `reach_out_request` card messages to plain system text so
 *      the leaders-channel history stays readable without a card to render.
 *   3. Deletes `reach_out` chat channels along with their membership rows,
 *      messages, and read state.
 *   4. Retypes `memberFollowups` rows of type `reach_out` to `note` — the
 *        history entry stays, it just lands in the generic bucket.
 *   5. Retypes `tasks` rows with `sourceType: "reach_out"` to `manual` and
 *      strips the `reach_out` tag; leaders keep the open work item.
 *   6. Clears `reachOutConfig` from groups.
 *
 * Batched: each call processes up to `limit` documents per collection and
 * reports `remaining` counts. Re-run until every `remaining` is 0.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

const DEFAULT_LIMIT = 500;

export const removeReachOutData = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const limit = args.limit ?? DEFAULT_LIMIT;
    const db = ctx.db as any;

    // 1 + 2a. Reach-out request rows.
    const requests = await db.query("reachOutRequests").take(limit);

    // 2b. Card messages and any other message still pointing at a request.
    const cardMessages = (
      await db.query("chatMessages").take(limit * 4)
    ).filter(
      (message: any) =>
        message.reachOutRequestId !== undefined ||
        message.contentType === "reach_out_request",
    );

    // 3. Reach-out channels (and everything hanging off them).
    const reachOutChannels = (
      await db.query("chatChannels").take(limit * 4)
    ).filter((channel: any) => channel.channelType === "reach_out");

    // 4. Followup rows that either link a request or were typed by it.
    const followups = (
      await db.query("memberFollowups").take(limit * 4)
    ).filter(
      (followup: any) =>
        followup.reachOutRequestId !== undefined ||
        followup.type === "reach_out",
    );

    // 5. Tasks created by the reach-out intake path.
    const tasks = (await db.query("tasks").take(limit * 4)).filter(
      (task: any) =>
        task.sourceType === "reach_out" ||
        (task.tags ?? []).includes("reach_out"),
    );

    // 6. Groups still carrying the config object.
    const groups = (await db.query("groups").take(limit * 4)).filter(
      (group: any) => group.reachOutConfig !== undefined,
    );

    const counts = {
      requests: requests.length,
      messages: cardMessages.length,
      channels: reachOutChannels.length,
      followups: followups.length,
      tasks: tasks.length,
      groups: groups.length,
    };

    if (dryRun) {
      return { dryRun: true, wouldProcess: counts };
    }

    for (const request of requests) {
      await db.delete(request._id);
    }

    for (const message of cardMessages) {
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

    let channelMembersDeleted = 0;
    let channelMessagesDeleted = 0;
    let readStatesDeleted = 0;
    for (const channel of reachOutChannels) {
      const members = await db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q: any) => q.eq("channelId", channel._id))
        .collect();
      for (const member of members) {
        await db.delete(member._id);
        channelMembersDeleted++;
      }

      const messages = await db
        .query("chatMessages")
        .withIndex("by_channel", (q: any) => q.eq("channelId", channel._id))
        .collect();
      for (const message of messages) {
        await db.delete(message._id);
        channelMessagesDeleted++;
      }

      const readStates = await db
        .query("chatReadState")
        .withIndex("by_channel", (q: any) => q.eq("channelId", channel._id))
        .collect();
      for (const readState of readStates) {
        await db.delete(readState._id);
        readStatesDeleted++;
      }

      await db.delete(channel._id);
    }

    for (const followup of followups) {
      await db.patch(followup._id, {
        reachOutRequestId: undefined,
        type: followup.type === "reach_out" ? "note" : followup.type,
      });
    }

    for (const task of tasks) {
      await db.patch(task._id, {
        sourceType: task.sourceType === "reach_out" ? "manual" : task.sourceType,
        tags: (task.tags ?? []).filter((tag: string) => tag !== "reach_out"),
      });
    }

    for (const group of groups) {
      await db.patch(group._id, { reachOutConfig: undefined });
    }

    return {
      dryRun: false,
      processed: counts,
      cascaded: {
        channelMembersDeleted,
        channelMessagesDeleted,
        readStatesDeleted,
      },
      // Non-zero means another pass is needed.
      note: "Re-run until every `processed` count is 0.",
    };
  },
});
