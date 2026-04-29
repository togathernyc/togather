import { internalMutation } from "../_generated/server";

/**
 * One-shot cleanup migration for the unified channel `enabled` field.
 *
 * Runs alongside the rollout that introduces `enabled` on chatChannels and the new
 * `setChannelEnabled` mutation. Two jobs:
 *
 *   1. Fix bug-state: any `channelType === "main"` channel with `isArchived === true` is
 *      assumed to be a victim of the legacy `toggleMainChannel` mutation (which used
 *      `isArchived` as a leader on/off toggle). General channels are always-on per the
 *      new model, so we flip `isArchived` back to `false` and stamp `enabled = true`.
 *
 *   2. Backfill `enabled` for every other channel type from whatever per-type flag was
 *      previously the source of truth:
 *        - leaders / reach_out: `isArchived` doubled as the on/off toggle (set
 *          `enabled = !isArchived`). NOTE: leaving the channel archived for now —
 *          the new mutation surfaces archive vs disable as separate concepts and the
 *          frontend will use `enabled` going forward.
 *        - custom / pco_services / event / dm / group_dm: copy from the legacy
 *          `isEnabled` field.
 *
 * Run with:
 *   npx convex run migrations/cleanupChannelEnabled:cleanupChannelEnabled
 */
export const cleanupChannelEnabled = internalMutation({
  handler: async (ctx) => {
    const channels = await ctx.db.query("chatChannels").collect();
    const now = Date.now();

    let mainBugFixed = 0;
    const counts: Record<string, number> = {};

    for (const channel of channels) {
      const type = channel.channelType;
      counts[type] ??= 0;

      if (type === "main") {
        // General is always-on. Restore from archived bug-state and stamp enabled=true.
        if (channel.isArchived === true) {
          await ctx.db.patch(channel._id, {
            isArchived: false,
            archivedAt: undefined,
            enabled: true,
            updatedAt: now,
          });
          mainBugFixed++;
          counts[type]++;
        } else if (channel.enabled !== true) {
          await ctx.db.patch(channel._id, { enabled: true, updatedAt: now });
          counts[type]++;
        }
        continue;
      }

      // Skip if already has `enabled` populated (idempotent re-run safety).
      if (channel.enabled !== undefined) continue;

      let nextEnabled: boolean;

      if (type === "leaders" || type === "reach_out") {
        // Legacy toggleLeadersChannel / toggleReachOutChannel used `isArchived` as on/off.
        nextEnabled = channel.isArchived !== true;
      } else {
        // Custom, PCO, event, DM, etc. used `isEnabled`.
        nextEnabled = channel.isEnabled !== false;
      }

      await ctx.db.patch(channel._id, {
        enabled: nextEnabled,
        updatedAt: now,
      });
      counts[type]++;
    }

    console.log(
      `[cleanupChannelEnabled] complete — main bug-fixed: ${mainBugFixed}, ` +
        `touched per type: ${JSON.stringify(counts)}, total channels: ${channels.length}`,
    );

    return {
      totalChannels: channels.length,
      mainBugFixed,
      touchedByType: counts,
    };
  },
});
