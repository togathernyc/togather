/**
 * Scheduling — teams (ADR-025)
 *
 * A serving team is a first-class `teams` row: a roster of volunteers that
 * owns roles and is scheduled onto event plans. A team *optionally* has a
 * chat channel (`teams.channelId`) — a channel-less team is a pure roster.
 *
 * These functions create, read, update, and archive teams, and manage a
 * team channel's manually-added ("permanent") members. Roles, events, and
 * assignments live in `roles.ts` / `events.ts` / `assignments.ts`.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { generateChannelSlug } from "../../lib/slugs";
import { updateChannelMemberCount } from "../messaging/helpers";
import {
  requireGroupMember,
  requireGroupScheduler,
  requireTeam,
  requireTeamScheduler,
} from "./permissions";
import {
  purgeSyncedMembers,
  reconcileTeamChannelImpl,
} from "./teamChannelSync";

/** Validate a team (or channel) name; returns the trimmed value. */
function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 50) {
    throw new ConvexError("Team name must be 1-50 characters.");
  }
  if (!/[a-zA-Z0-9]/.test(name)) {
    throw new ConvexError(
      "Team name must contain at least one letter or number.",
    );
  }
  return name;
}

/**
 * Insert the chat channel that backs a serving team — shared by
 * `createServingTeam` (initial creation) and `linkChannel` (a team gaining a
 * channel after the fact). Enforces the same 20-channel-per-group cap as
 * `createCustomChannel` and computes a slug unique across archived channels
 * too (see PR #400 thread: the `by_group_slug` index spans archived rows).
 */
async function createTeamChannel(
  ctx: MutationCtx,
  args: {
    groupId: Id<"groups">;
    name: string;
    description: string | undefined;
    createdById: Id<"users">;
    now: number;
  },
): Promise<Id<"chatChannels">> {
  const existingChannels = await ctx.db
    .query("chatChannels")
    .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
    .collect();
  const activeChannelCount = existingChannels.filter(
    (ch) => ch.isArchived === false,
  ).length;
  if (activeChannelCount >= 20) {
    throw new ConvexError(
      "This group has reached the maximum of 20 channels. Archive some channels to create new ones.",
    );
  }
  const existingSlugs = existingChannels
    .map((ch) => ch.slug)
    .filter((slug): slug is string => slug !== undefined);
  return ctx.db.insert("chatChannels", {
    groupId: args.groupId,
    slug: generateChannelSlug(args.name, existingSlugs),
    channelType: "custom",
    name: args.name,
    description: args.description,
    createdById: args.createdById,
    createdAt: args.now,
    updatedAt: args.now,
    isArchived: false,
    isServingTeam: true,
    memberCount: 0,
    joinMode: "open",
  });
}

/**
 * Create a serving team (ADR-025) — the shared implementation behind the
 * `createServingTeam` mutation and any other mutation that needs to bootstrap
 * a team as part of a larger flow (e.g. `quickStartRostering`). Callers are
 * responsible for auth; this assumes the caller is an authorized scheduler.
 *
 * By default the team also gets a chat channel — a `custom` channel flagged
 * `isServingTeam`. Pass `withChannel: false` for a channel-less team. The
 * channel's membership is auto-synced from assignments, so the creator is not
 * added as a member.
 */
export async function createServingTeamImpl(
  ctx: MutationCtx,
  args: {
    groupId: Id<"groups">;
    communityId: Id<"communities">;
    name: string;
    description?: string;
    createdById: Id<"users">;
    withChannel?: boolean;
  },
): Promise<{ teamId: Id<"teams">; channelId: Id<"chatChannels"> | null }> {
  const name = validateName(args.name);
  const now = Date.now();
  const withChannel = args.withChannel ?? true;

  // The team's chat channel: a custom channel flagged as a serving team.
  // Membership is auto-synced from assignments (ADR-023), so the creator
  // is not added as a member — they manage it as a group leader.
  const channelId = withChannel
    ? await createTeamChannel(ctx, {
        groupId: args.groupId,
        name,
        description: args.description,
        createdById: args.createdById,
        now,
      })
    : undefined;

  const teamId = await ctx.db.insert("teams", {
    groupId: args.groupId,
    communityId: args.communityId,
    name,
    description: args.description,
    channelId,
    createdAt: now,
    createdById: args.createdById,
    updatedAt: now,
  });

  return { teamId, channelId: channelId ?? null };
}

/**
 * Create a serving team (ADR-025).
 *
 * By default the team also gets a chat channel — a `custom` channel flagged
 * `isServingTeam`. Pass `withChannel: false` for a channel-less team (a pure
 * roster with no chat surface). The channel's membership is auto-synced from
 * event-plan assignments, so the creator is not added as a member.
 *
 * Auth: campus group leader or community admin.
 */
export const createServingTeam = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
    /** Whether to also create the team's chat channel. Defaults to `true`. */
    withChannel: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupScheduler(ctx, args.groupId, userId);

    return createServingTeamImpl(ctx, {
      groupId: args.groupId,
      communityId: group.communityId,
      name: args.name,
      description: args.description,
      createdById: userId,
      withChannel: args.withChannel,
    });
  },
});

/**
 * List the serving teams for a campus group (ADR-025). Archived teams are
 * excluded.
 *
 * Auth: an active member of the group, or a community admin — so a private
 * group's teams are not enumerable by arbitrary authenticated users.
 */
export const listTeams = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupMember(ctx, args.groupId, userId);

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    return Promise.all(
      teams
        .filter((team) => team.isArchived !== true)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (team) => {
          const channel = team.channelId
            ? await ctx.db.get(team.channelId)
            : null;
          return {
            _id: team._id,
            name: team.name,
            description: team.description,
            channelId: team.channelId ?? null,
            hasChannel: team.channelId !== undefined,
            memberCount: channel?.memberCount ?? 0,
          };
        }),
    );
  },
});

/**
 * Fetch a single serving team by id (ADR-025).
 *
 * Auth: an active member of the team's campus group, or a community admin.
 *
 * @throws ConvexError if the team is missing or the caller lacks access.
 */
export const getTeam = query({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new ConvexError("Team not found");
    }
    await requireGroupMember(ctx, team.groupId, userId);

    const channel = team.channelId ? await ctx.db.get(team.channelId) : null;
    return {
      _id: team._id,
      groupId: team.groupId,
      name: team.name,
      description: team.description,
      channelId: team.channelId ?? null,
      hasChannel: team.channelId !== undefined,
      // Slug is resolved here (group-membership-gated, which the team's
      // scheduler always satisfies) so the team detail screen can deep-link
      // into the chat without a separate `getChannel` lookup — that one is
      // membership-gated, and `createServingTeam` deliberately does not add
      // the creator as a member.
      channelSlug: channel?.slug ?? null,
      isArchived: team.isArchived === true,
      memberCount: channel?.memberCount ?? 0,
      createdAt: team.createdAt,
    };
  },
});

/**
 * Update a team's name and/or description (ADR-025). When the team has a
 * chat channel, a rename is mirrored onto the channel so the conversation
 * and the roster stay labelled consistently.
 *
 * Auth: team admin/moderator, campus group leader, or community admin.
 */
export const updateTeam = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const team = await requireTeamScheduler(ctx, args.teamId, userId);

    const now = Date.now();
    const patch: { name?: string; description?: string; updatedAt: number } = {
      updatedAt: now,
    };
    if (args.name !== undefined) patch.name = validateName(args.name);
    if (args.description !== undefined) patch.description = args.description;

    await ctx.db.patch(args.teamId, patch);

    if (team.channelId && (patch.name || args.description !== undefined)) {
      await ctx.db.patch(team.channelId, {
        ...(patch.name ? { name: patch.name } : {}),
        ...(args.description !== undefined
          ? { description: args.description }
          : {}),
        updatedAt: now,
      });
    }

    return { teamId: args.teamId };
  },
});

/**
 * Archive (or unarchive) a team (ADR-025). Archiving also archives the
 * team's chat channel and purges its auto-synced members — the rotation
 * engine skips archived teams, so synced members would otherwise be
 * stranded as permanent members.
 *
 * Auth: team admin/moderator, campus group leader, or community admin.
 */
export const archiveTeam = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    /** Defaults to `true` (archive). Pass `false` to unarchive. */
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const team = await requireTeamScheduler(ctx, args.teamId, userId);

    const archived = args.archived ?? true;
    const now = Date.now();

    await ctx.db.patch(args.teamId, { isArchived: archived, updatedAt: now });

    let removedSyncedMembers = 0;
    if (team.channelId) {
      await ctx.db.patch(team.channelId, {
        isArchived: archived,
        archivedAt: archived ? now : undefined,
        updatedAt: now,
      });
      if (archived) {
        removedSyncedMembers = await purgeSyncedMembers(ctx, team.channelId);
      }
    }

    return { teamId: args.teamId, isArchived: archived, removedSyncedMembers };
  },
});

// ============================================================================
// Channel linking — turning a team's chat channel on / off
// ============================================================================

/**
 * Turn a team's chat channel on. Creates a fresh `custom` chat channel
 * flagged `isServingTeam`, links it to the team, and reconciles it against
 * the team's in-window assignments so existing volunteers are populated
 * immediately. Errors if the team already has a channel.
 *
 * Auth: team admin/moderator, campus group leader, or community admin.
 */
export const linkChannel = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const team = await requireTeamScheduler(ctx, args.teamId, userId);
    if (team.channelId) {
      throw new ConvexError("This team already has a chat channel.");
    }
    if (team.isArchived === true) {
      throw new ConvexError("Cannot add a channel to an archived team.");
    }

    const now = Date.now();
    const channelId = await createTeamChannel(ctx, {
      groupId: team.groupId,
      name: team.name,
      description: team.description,
      createdById: userId,
      now,
    });

    await ctx.db.patch(args.teamId, { channelId, updatedAt: now });

    // Populate the new channel with anyone already assigned in-window.
    const reconcile = await reconcileTeamChannelImpl(ctx, args.teamId);

    return {
      teamId: args.teamId,
      channelId,
      addedMembers: reconcile.added,
    };
  },
});

/**
 * Turn a team's chat channel off. The channel itself stays in the inbox as
 * a regular custom channel (its `isServingTeam` flag is cleared and the team
 * detaches its `channelId`); auto-synced members owned by the rotation
 * engine are purged. Permanent members are untouched.
 *
 * This is team-wide — it affects every event plan the team is on. Errors if
 * the team has no channel to unlink.
 *
 * Auth: team admin/moderator, campus group leader, or community admin.
 */
export const unlinkChannel = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const team = await requireTeamScheduler(ctx, args.teamId, userId);
    if (!team.channelId) {
      throw new ConvexError("This team has no chat channel.");
    }
    const formerChannelId = team.channelId;
    const now = Date.now();

    await ctx.db.patch(args.teamId, {
      channelId: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(formerChannelId, {
      isServingTeam: undefined,
      updatedAt: now,
    });
    const removedSyncedMembers = await purgeSyncedMembers(
      ctx,
      formerChannelId,
    );

    return {
      teamId: args.teamId,
      formerChannelId,
      removedSyncedMembers,
    };
  },
});

/**
 * List every serving team across the caller's community, organized by the
 * group that owns it and enriched with each team's (non-archived) roles.
 *
 * Powers the cross-team channel picker: a leader narrows down which groups
 * to draw from, then picks roles from the teams in those groups. Only groups
 * that actually have a team are returned.
 *
 * Auth: an active member of `groupId` (the group the picker is opened from),
 * or a community admin — the same read gate as `listTeams`.
 */
export const listCommunityTeams = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupMember(ctx, args.groupId, userId);

    const communityGroups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", group.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const result: Array<{
      group: { _id: Id<"groups">; name: string };
      teams: Array<{
        _id: Id<"teams">;
        name: string;
        hasChannel: boolean;
        memberCount: number;
        roles: Array<{
          _id: Id<"teamRoles">;
          name: string;
          color?: string;
          sortOrder: number;
        }>;
      }>;
    }> = [];

    for (const g of communityGroups) {
      const groupTeams = await ctx.db
        .query("teams")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      const activeTeams = groupTeams.filter((t) => t.isArchived !== true);
      if (activeTeams.length === 0) continue;

      const teams = await Promise.all(
        activeTeams.map(async (team) => {
          const roles = await ctx.db
            .query("teamRoles")
            .withIndex("by_team", (q) => q.eq("teamId", team._id))
            .collect();
          const channel = team.channelId
            ? await ctx.db.get(team.channelId)
            : null;
          return {
            _id: team._id,
            name: team.name,
            hasChannel: team.channelId !== undefined,
            memberCount: channel?.memberCount ?? 0,
            roles: roles
              .filter((role) => role.isArchived !== true)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((role) => ({
                _id: role._id,
                name: role.name,
                color: role.color,
                sortOrder: role.sortOrder,
              })),
          };
        }),
      );

      result.push({ group: { _id: g._id, name: g.name }, teams });
    }

    // The picker's own group first, then alphabetical by group name.
    result.sort((a, b) => {
      if (a.group._id === args.groupId) return -1;
      if (b.group._id === args.groupId) return 1;
      return a.group.name.localeCompare(b.group.name);
    });

    return result;
  },
});

// ============================================================================
// Permanent members
// ============================================================================
//
// A team channel's day-to-day membership is auto-synced from event-plan
// assignments by `reconcileTeamChannel` — but that engine only ever touches
// `chatChannelMembers` rows tagged `syncSource === "event_plan"`. A "permanent
// member" is a `chatChannelMembers` row with NO `syncSource`: a leader added
// them by hand, and the rotation engine leaves them alone. They stay in the
// channel regardless of event plans, on top of whoever is auto-added.
//
// These functions require the team to have a chat channel — a channel-less
// team has no `chatChannelMembers` to manage.

/** Resolve a team's channel id for a scheduler, erroring if it has none. */
async function requireTeamChannel(
  ctx: Parameters<typeof requireTeam>[0],
  teamId: Id<"teams">,
  userId: Id<"users">,
): Promise<Id<"chatChannels">> {
  const team = await requireTeamScheduler(ctx, teamId, userId);
  if (!team.channelId) {
    throw new ConvexError("This team has no chat channel.");
  }
  return team.channelId;
}

/**
 * Add a permanent member to a team's channel.
 *
 * Inserts a `chatChannelMembers` row with role `member` and no `syncSource`
 * so the auto-sync engine never removes it. Idempotent: if the user already
 * has an active membership row (synced or manual) this is a no-op.
 *
 * Auth: team admin/moderator, campus group leader, or community admin.
 */
export const addPermanentMember = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const channelId = await requireTeamChannel(ctx, args.teamId, callerId);

    const existing = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", args.userId),
      )
      .first();

    // Already present (active row, synced or manual) — nothing to do.
    if (existing && existing.leftAt === undefined) {
      return { teamId: args.teamId, userId: args.userId, added: false };
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError("User not found");
    }
    const displayName = getDisplayName(user.firstName, user.lastName);
    const profilePhoto = getMediaUrl(user.profilePhoto);

    if (existing) {
      // A previously soft-left row exists — revive it as a permanent member.
      await ctx.db.patch(existing._id, {
        leftAt: undefined,
        role: "member",
        syncSource: undefined,
        syncEventId: undefined,
        scheduledRemovalAt: undefined,
        syncMetadata: undefined,
        joinedAt: Date.now(),
        displayName,
        profilePhoto,
      });
    } else {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: args.userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        displayName,
        profilePhoto,
      });
    }

    await updateChannelMemberCount(ctx, channelId);
    return { teamId: args.teamId, userId: args.userId, added: true };
  },
});

/**
 * Remove a permanent member from a team's channel.
 *
 * Soft-removes (`leftAt`) the user's NON-synced membership row only. A synced
 * (`syncSource === "event_plan"`) row is never touched — it is owned by the
 * rotation engine and reflects a live event-plan assignment.
 *
 * Auth: team admin/moderator, campus group leader, or community admin.
 */
export const removePermanentMember = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const channelId = await requireTeamChannel(ctx, args.teamId, callerId);

    const rows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", args.userId),
      )
      .collect();

    const manualRow = rows.find(
      (r) => r.leftAt === undefined && r.syncSource === undefined,
    );
    if (!manualRow) {
      throw new ConvexError("That person is not a permanent member.");
    }

    await ctx.db.patch(manualRow._id, { leftAt: Date.now() });
    await updateChannelMemberCount(ctx, channelId);
    return { teamId: args.teamId, userId: args.userId, removed: true };
  },
});

/**
 * List a team's permanent members — active channel rows with no `syncSource`.
 * Excludes auto-synced event-plan members.
 *
 * Auth: team admin/moderator, campus group leader, or community admin.
 */
export const listPermanentMembers = query({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const channelId = await requireTeamChannel(ctx, args.teamId, callerId);

    const rows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const permanent = rows.filter((r) => r.syncSource === undefined);

    return Promise.all(
      permanent.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return {
          userId: row.userId,
          displayName: user
            ? getDisplayName(user.firstName, user.lastName)
            : (row.displayName ?? "Unknown"),
          profilePhoto: user
            ? getMediaUrl(user.profilePhoto)
            : row.profilePhoto,
          role: row.role,
          joinedAt: row.joinedAt,
        };
      }),
    );
  },
});
