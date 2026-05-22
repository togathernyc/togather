/**
 * ADR-025 migration M2 — backfill the first-class `teams` table.
 *
 * Phase M1 (additive schema) added the `teams` table and the optional
 * `teamId` / `sourceTeamId` fields. This migration backfills them from the
 * existing ADR-023 "channel-as-team" data:
 *
 *   1. Create a `teams` row for every channel that acts as a serving team
 *      (`isServingTeam`, or referenced by a `teamRoles` row).
 *   2. Set `teamId` on every `teamRoles` / `neededRoles` / `roleAssignments`
 *      row from the team that owns its legacy `channelId`.
 *   3. Map every cross-team selector's `sourceChannelId` to `sourceTeamId`.
 *
 * Idempotent and re-runnable — each step skips already-migrated rows. Steps
 * 2–3 are bounded by `batchSize` to stay within Convex transaction limits;
 * re-run until the result reports `done: true`:
 *
 *   npx convex run functions/migrations/migrateChannelsToTeams:migrateChannelsToTeams
 *
 * Phase M3 (drop the legacy `channelId` columns and make `teamId` required)
 * is a separate follow-up, run only once this has completed everywhere.
 * See ADR-025.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/** Rows linked per call across teamRoles / neededRoles / roleAssignments. */
const DEFAULT_BATCH = 400;

export const migrateChannelsToTeams = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? DEFAULT_BATCH;
    const now = Date.now();
    const stats = {
      teamsCreated: 0,
      teamRolesLinked: 0,
      neededRolesLinked: 0,
      roleAssignmentsLinked: 0,
      crossTeamChannelsLinked: 0,
    };

    // ----- Step 1: ensure a `teams` row for every serving-team channel. -----
    // Runs fully each call — idempotent via the `by_channel` index. The set
    // of channels needing a team is every `isServingTeam` channel plus every
    // channel referenced by a `teamRoles` row (a channel can be un-flagged
    // while its roles live on), plus every cross-team selector's source.
    const allChannels = await ctx.db.query("chatChannels").collect();
    const channelById = new Map(allChannels.map((c) => [c._id, c]));
    const crossTeamChannels = allChannels.filter(
      (c) => c.channelType === "cross_team",
    );

    const channelIdsNeedingTeam = new Set<Id<"chatChannels">>();
    for (const c of allChannels) {
      if (c.isServingTeam === true) channelIdsNeedingTeam.add(c._id);
    }
    for (const role of await ctx.db.query("teamRoles").collect()) {
      channelIdsNeedingTeam.add(role.channelId);
    }
    for (const ch of crossTeamChannels) {
      for (const sel of ch.crossTeamSync?.selectors ?? []) {
        channelIdsNeedingTeam.add(sel.sourceChannelId);
      }
    }

    /** legacy channelId -> teamId */
    const teamByChannel = new Map<Id<"chatChannels">, Id<"teams">>();
    for (const channelId of channelIdsNeedingTeam) {
      const existing = await ctx.db
        .query("teams")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .first();
      if (existing) {
        teamByChannel.set(channelId, existing._id);
        continue;
      }
      const channel = channelById.get(channelId);
      if (!channel || !channel.groupId) {
        console.warn(
          `[migrateChannelsToTeams] channel ${channelId} missing or not group-scoped; skipped`,
        );
        continue;
      }
      const communityId =
        channel.communityId ??
        (await ctx.db.get(channel.groupId))?.communityId;
      if (!communityId) {
        console.warn(
          `[migrateChannelsToTeams] channel ${channelId} has no community; skipped`,
        );
        continue;
      }
      const teamId = await ctx.db.insert("teams", {
        groupId: channel.groupId,
        communityId,
        name: channel.name,
        description: channel.description,
        channelId: channel._id,
        isArchived: channel.isArchived === true ? true : undefined,
        createdAt: channel.createdAt,
        createdById: channel.createdById,
        updatedAt: now,
      });
      teamByChannel.set(channelId, teamId);
      stats.teamsCreated += 1;
    }

    // ----- Steps 2–4: link teamRoles / roleAssignments / neededRoles. -------
    let budget = batchSize;

    if (budget > 0) {
      const unlinked = await ctx.db
        .query("teamRoles")
        .withIndex("by_team", (q) => q.eq("teamId", undefined))
        .take(budget);
      for (const role of unlinked) {
        const teamId = teamByChannel.get(role.channelId);
        if (!teamId) continue;
        await ctx.db.patch(role._id, { teamId });
        stats.teamRolesLinked += 1;
        budget -= 1;
      }
    }

    if (budget > 0) {
      const unlinked = await ctx.db
        .query("roleAssignments")
        .withIndex("by_team_eventDate", (q) => q.eq("teamId", undefined))
        .take(budget);
      for (const assignment of unlinked) {
        const teamId = teamByChannel.get(assignment.channelId);
        if (!teamId) continue;
        await ctx.db.patch(assignment._id, { teamId });
        stats.roleAssignmentsLinked += 1;
        budget -= 1;
      }
    }

    if (budget > 0) {
      // `neededRoles` has no team-only index; a full scan is fine — it is the
      // smallest scheduling table (a few rows per event plan).
      const allNeeded = await ctx.db.query("neededRoles").collect();
      for (const needed of allNeeded) {
        if (budget <= 0) break;
        if (needed.teamId !== undefined) continue;
        const teamId = teamByChannel.get(needed.channelId);
        if (!teamId) continue;
        await ctx.db.patch(needed._id, { teamId });
        stats.neededRolesLinked += 1;
        budget -= 1;
      }
    }

    // ----- Step 5: map cross-team selectors to teams. ----------------------
    // Cross-team channels are few; processed fully every call (idempotent).
    for (const ch of crossTeamChannels) {
      const selectors = ch.crossTeamSync?.selectors;
      if (!selectors || selectors.length === 0) continue;
      if (selectors.every((sel) => sel.sourceTeamId !== undefined)) continue;
      await ctx.db.patch(ch._id, {
        crossTeamSync: {
          selectors: selectors.map((sel) =>
            sel.sourceTeamId !== undefined
              ? sel
              : {
                  ...sel,
                  sourceTeamId: teamByChannel.get(sel.sourceChannelId),
                },
          ),
        },
      });
      stats.crossTeamChannelsLinked += 1;
    }

    // `done` is conservative: if steps 2–4 used the whole budget there may be
    // more rows. Cross-team selectors are always fully processed in one call.
    const linkedThisRun =
      stats.teamRolesLinked +
      stats.roleAssignmentsLinked +
      stats.neededRolesLinked;
    return { done: linkedThisRun < batchSize, ...stats };
  },
});
