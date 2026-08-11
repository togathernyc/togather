/**
 * Admin functions for community member management
 *
 * Includes:
 * - Listing and searching community members
 * - Member role management
 * - Primary admin transfer
 * - User group history
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import {
  now,
  normalizePhone,
  getMediaUrl,
  isValidPhone,
  buildSearchText,
} from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { searchCommunityMembersPaginated } from "../../lib/memberSearch";
import { getUsersWithNotificationsDisabled } from "../../lib/notifications/enabledStatus";
import { syncAnnouncementGroupMembership } from "../sync/memberships";
import {
  requireCommunityAdmin,
  requirePrimaryAdmin,
  COMMUNITY_ROLES,
  ADMIN_ROLE_THRESHOLD,
} from "./auth";

// ============================================================================
// Member Profile Edits — claim and authority guards (ADR-034)
// ============================================================================

/**
 * Why any of this exists: `users.phone` and `users.email` are not data, they
 * are credentials. The phone receives sign-in OTPs, and the email is
 * sufficient on its own — `auth/accountClaim.ts` exposes an *unauthenticated*
 * `verify_and_link` action that mails a code to whatever address is on the
 * record and hands back access and refresh tokens for that account. Both
 * fields live on the global `users` row while admin roles are per-community,
 * so an unrestricted admin edit reaches into communities the acting admin has
 * no authority over.
 *
 * Hence the rule: contact details are editable ONLY while nobody has claimed
 * the account AND the account holds no authority anywhere. Names and dates of
 * birth are not credentials and follow ordinary role rules.
 */

/**
 * Ownership signals that mean a human has actually signed in as this account.
 *
 * Deliberately broader than `phoneVerified`, because that flag does not mean
 * what its name suggests: `auth/login.ts` `legacyLogin` authenticates a
 * migrated password holder and issues real JWTs without ever setting it. Any
 * ONE of these signals means the account is someone's identity, not data an
 * admin typed off a paper card.
 *
 * Returns a human-readable reason, or null when the account is unclaimed.
 */
async function describeAccountClaim(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string | null> {
  const user = await ctx.db.get(userId);
  if (!user) return null;

  // 1. Verified phone — the OTP path completed.
  if (user.phoneVerified === true) {
    return "this member has verified their phone number";
  }

  // 2. Stored password — legacy migrated accounts sign in via `legacyLogin`,
  //    which issues real tokens and never touches `phoneVerified`.
  if (user.password) {
    return "this member has a password on their account";
  }

  // 3. Recorded login on the user row (backfilled from legacy login data by
  //    admin/cleanup.ts, so it is an independent record of the same fact).
  if (user.lastLogin) {
    return "this member has signed in before";
  }

  // 4. Recorded login on ANY membership row. Current sign-in paths stamp
  //    `lastLogin` here (`ensureUserCommunityInternal`), NOT on the user, so
  //    checking only `users.lastLogin` misses almost everyone who has
  //    actually signed in.
  const memberships = await ctx.db
    .query("userCommunities")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  if (memberships.some((m) => m.lastLogin)) {
    return "this member has signed in before";
  }

  return null;
}

/**
 * Every table and field in this codebase that grants a user a capability
 * beyond their own rows. Returns a human-readable description of the first
 * authority found, or null when the account holds none.
 *
 * ⚠️ A FEATURE THAT ADDS A NEW KIND OF ROLE MUST ADD IT HERE. ⚠️
 *
 * This enumeration is the whole safety of admin-written contact details: if a
 * role-bearing table is missing below, a local admin can redirect the contact
 * details of an account holding that role, claim it via the OTP or
 * account-claim flow, and inherit the capability. Nothing in the type system
 * will flag the omission — see the known limitation in ADR-034.
 *
 * Note that "unclaimed" does NOT imply "powerless", which is why this runs
 * alongside `describeAccountClaim` rather than instead of it: legacy accounts
 * were migrated with roles intact, leaders are routinely entered before they
 * first sign in, and a placeholder row's `_id` is stable so it can already
 * carry `roleAssignments` / `groupMembers` / `userCommunities` rows (see
 * `auth/registration.ts`).
 */
async function describeAccountAuthority(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string | null> {
  // --- Platform-global authority, all on the users doc itself ---------------
  const user = await ctx.db.get(userId);
  if (!user) return null;

  // `isSuperuser` / `isStaff` bypass every other platform check
  // (posters.ts `hasPlatformRole`, devAssistant/access.ts).
  if (user.isSuperuser === true) return "this member is a platform superuser";
  if (user.isStaff === true) return "this member is platform staff";

  // Delegated platform roles: "poster_admin" (posters.ts) and
  // "dev_maintainer" (devAssistant/access.ts) today.
  if (user.platformRoles && user.platformRoles.length > 0) {
    return `this member holds the platform role ${user.platformRoles.join(", ")}`;
  }

  // GLOBAL users.roles — not the per-community one. `messaging/flagging.ts`
  // `isUserAdmin` reads this field directly, with no membership behind it,
  // and grants cross-community flag review and message moderation.
  if ((user.roles ?? 0) >= ADMIN_ROLE_THRESHOLD) {
    return "this member has a global admin role";
  }

  // --- Community-scoped authority ------------------------------------------
  const memberships = await ctx.db
    .query("userCommunities")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  // Only status 1 counts: `isCommunityAdmin` / `isPrimaryAdmin` require it, so
  // a stale role in a community the member has left confers nothing and must
  // not permanently lock their contact details.
  const activeAdminMemberships = memberships.filter(
    (m) => m.status === 1 && (m.roles ?? 0) >= ADMIN_ROLE_THRESHOLD,
  );
  if (activeAdminMemberships.length > 0) {
    return "this member is an admin of a community";
  }

  // Community finance roles (ADR-033). The grant alone is not authority —
  // `canManageCommunityFinance` also requires the holder to still be a
  // community admin, which the check above has already ruled out. Included so
  // the enumeration stays complete if that conjunction is ever relaxed.
  const financeRoles = await ctx.db
    .query("communityFinanceRoles")
    .withIndex("by_user_community", (q) => q.eq("userId", userId))
    .collect();
  const activeCommunityIds = new Set(
    memberships.filter((m) => m.status === 1).map((m) => m.communityId),
  );
  if (
    financeRoles.some(
      (r) => r.revokedAt === undefined && activeCommunityIds.has(r.communityId),
    )
  ) {
    return "this member holds a community finance role";
  }

  // --- Group-scoped authority ----------------------------------------------
  const groupMemberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  for (const membership of groupMemberships) {
    // `isGroupLeader` semantics (lib/membership.ts): active, accepted, leader.
    const isActive =
      membership.leftAt === undefined &&
      (!membership.requestStatus || membership.requestStatus === "accepted");
    if (!isActive || membership.role !== "leader") continue;

    // Leading an archived group confers nothing — `isCommunityGroupLeader`
    // (scheduling/permissions.ts) excludes archived groups too.
    const group = await ctx.db.get(membership.groupId);
    if (!group || group.isArchived === true) continue;

    return "this member leads a group";
  }

  // Fund roles (ADR-032). `revokedAt === undefined` means active; re-grants
  // leave the revoked row in place, so filter rather than taking the first.
  const fundRoles = await ctx.db
    .query("fundRoles")
    .withIndex("by_user_fund", (q) => q.eq("userId", userId))
    .collect();
  if (fundRoles.some((r) => r.revokedAt === undefined)) {
    return "this member holds a fund role";
  }

  // Serving-team managers (ADR-025). The row itself is never cleaned up when
  // someone leaves the group, so `isTeamManager` re-verifies active group
  // membership on every check — mirror that here rather than trusting the row.
  const teamManagerRows = await ctx.db
    .query("teamManagers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of teamManagerRows) {
    const team = await ctx.db.get(row.teamId);
    if (!team || team.isArchived === true) continue;
    // Still an active member of the team's group?
    const stillInGroup = groupMemberships.some(
      (m) =>
        m.groupId === team.groupId &&
        m.leftAt === undefined &&
        (!m.requestStatus || m.requestStatus === "accepted"),
    );
    if (stillInGroup) return "this member manages a serving team";
  }

  // --- Channel-scoped authority --------------------------------------------
  // `chatChannelMembers` roles are granted directly, with no group leadership
  // behind them. "owner" is a real fourth value the schema comment omits.
  // Moderators can delete other people's messages (messaging/messages.ts);
  // owners can remove members and delete the channel (messaging/channels.ts).
  const channelMemberships = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const CHANNEL_AUTHORITY_ROLES = new Set(["owner", "admin", "moderator"]);
  if (
    channelMemberships.some(
      (m) => m.leftAt === undefined && CHANNEL_AUTHORITY_ROLES.has(m.role),
    )
  ) {
    return "this member holds a channel admin or moderator role";
  }

  return null;
}

/**
 * The single source of truth for "may this admin edit this member's profile,
 * and may they touch the contact fields?"
 *
 * Called by BOTH `updateMemberProfile` and `getCommunityMemberById`, so the
 * detail screen hides exactly the actions the mutation would reject. Keeping
 * these in one place is deliberate: when the query and the mutation disagree,
 * the UI offers buttons that always fail.
 */
async function getProfileEditPermissions(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  targetUserId: Id<"users">,
): Promise<{ canEditProfile: boolean; contactEditBlockedReason: string | null }> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", targetUserId).eq("communityId", communityId),
    )
    .first();

  // Status 1 (active) only. Status 2 is "left" and status 3 is "blocked";
  // both are retained in People search, and a community that someone has left
  // has no business editing their global user record.
  if (!membership || membership.status !== 1) {
    return {
      canEditProfile: false,
      contactEditBlockedReason: "this member is not active in this community",
    };
  }

  const claimReason = await describeAccountClaim(ctx, targetUserId);
  if (claimReason) {
    return { canEditProfile: true, contactEditBlockedReason: claimReason };
  }

  const authorityReason = await describeAccountAuthority(ctx, targetUserId);
  if (authorityReason) {
    return { canEditProfile: true, contactEditBlockedReason: authorityReason };
  }

  return { canEditProfile: true, contactEditBlockedReason: null };
}

// ============================================================================
// Community Members
// ============================================================================

/**
 * List community members with pagination and filters
 *
 * Optimized to reduce reads by:
 * 1. Fetching groups once upfront
 * 2. Paginating memberships at the database level
 * 3. Only processing members needed for current page
 */
export const listCommunityMembers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    search: v.optional(v.string()),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Use the shared paginated search helper
    const result = await searchCommunityMembersPaginated(ctx, {
      communityId: args.communityId,
      search: args.search,
      groupId: args.groupId,
      page: args.page,
      pageSize: Math.min(args.pageSize ?? 20, 50),
    });

    return result;
  },
});

/**
 * Search community members by name, email, or phone
 * Uses Convex search index for efficient full-text search across all users
 * Results are ordered by: 1) community login activity, 2) app login activity
 */
export const searchCommunityMembers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    search: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const limit = Math.min(args.limit ?? 50, 100);

    if (!args.search.trim()) {
      return { members: [], total: 0 };
    }

    // Use Convex search index to find users matching the search term
    // This searches across all users efficiently without the 2000 limit
    const searchResults = await ctx.db
      .query("users")
      .withSearchIndex("search_users", (q) => q.search("searchText", args.search))
      .take(500); // Get more results to filter by community membership

    // Also handle phone number search with normalization
    // Full-text search doesn't handle formatted phone numbers well,
    // so we do a separate phone lookup if the search contains digits
    const normalizedPhone = normalizePhone(args.search).replace(/\D/g, "");
    let phoneSearchResults: typeof searchResults = [];
    if (normalizedPhone.length >= 4) {
      // Get community members and check for phone matches
      const communityMemberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
        .filter((q) => q.neq(q.field("status"), 3)) // Not blocked
        .take(2000);

      const phoneMatchPromises = communityMemberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (user?.phone?.includes(normalizedPhone)) {
          return user;
        }
        return null;
      });
      const phoneMatches = await Promise.all(phoneMatchPromises);
      phoneSearchResults = phoneMatches.filter((u): u is NonNullable<typeof u> => u !== null);
    }

    // Merge results, deduplicating by user ID
    const seenUserIds = new Set<string>();
    const allResults = [...searchResults, ...phoneSearchResults].filter((user) => {
      if (seenUserIds.has(user._id)) return false;
      seenUserIds.add(user._id);
      return true;
    });

    if (allResults.length === 0) {
      return { members: [], total: 0 };
    }

    // Check which of these users are members of this community
    const membershipPromises = allResults.map((user) =>
      ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", user._id).eq("communityId", args.communityId)
        )
        .first()
    );
    const memberships = await Promise.all(membershipPromises);

    // Build results for users who are community members
    const matches: Array<{
      id: typeof allResults[0]["_id"];
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      profilePhoto: string | null;
      isAdmin: boolean;
      role: number;
      communityLastLogin: number;
      appLastLogin: number;
    }> = [];

    for (let i = 0; i < allResults.length; i++) {
      const user = allResults[i];
      const membership = memberships[i];

      // Skip if not a member or blocked
      if (!membership || membership.status === 3) continue;

      matches.push({
        id: user._id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: user.phone || null,
        profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
        isAdmin: (membership.roles ?? 0) >= ADMIN_ROLE_THRESHOLD,
        role: membership.roles ?? COMMUNITY_ROLES.MEMBER,
        communityLastLogin: membership.lastLogin ?? 0,
        appLastLogin: user.lastLogin ?? 0,
      });
    }

    // Sort by: 1) community login activity (desc), 2) app login activity (desc)
    matches.sort((a, b) => {
      // First compare by community login
      if (a.communityLastLogin !== b.communityLastLogin) {
        return b.communityLastLogin - a.communityLastLogin;
      }
      // Then by app login
      return b.appLastLogin - a.appLastLogin;
    });

    // Slice to the response limit BEFORE looking up notif-disabled status —
    // pushTokens reads should scale with the number of rows we're actually
    // returning, not with how many candidates the search index pulled
    // back (up to 500). For broad queries this avoids hundreds of extra
    // reads per keystroke (codex review #372).
    const sliced = matches.slice(0, limit);
    const sliceNotifsDisabled = await getUsersWithNotificationsDisabled(
      ctx,
      sliced.map((m) => m.id),
    );
    const limitedMatches = sliced.map(
      ({ communityLastLogin, appLastLogin, ...rest }) => ({
        ...rest,
        notificationsDisabled: sliceNotifsDisabled.has(rest.id),
      }),
    );

    return {
      members: limitedMatches,
      total: limitedMatches.length,
    };
  },
});


/**
 * Get community member details by ID
 */
export const getCommunityMemberById = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const user = await ctx.db.get(args.targetUserId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get community membership
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!communityMembership) {
      // User was removed from community - return null instead of throwing
      return null;
    }

    // Get active group memberships
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const groupIds = new Set(groups.map((g) => g._id));

    const allMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .collect();

    const activeGroups = allMemberships.filter(
      (m) =>
        !m.leftAt &&
        groupIds.has(m.groupId) &&
        (m.requestStatus === undefined || m.requestStatus === null || m.requestStatus === "accepted")
    );

    // Get recent attendance
    const allAttendances = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .collect();

    // Filter to community meetings and get recent 20
    const communityAttendances: {
      _id: typeof allAttendances[0]["_id"];
      meetingId: typeof allAttendances[0]["meetingId"];
      status: number;
      recordedAt: number;
      meeting: any;
    }[] = [];

    for (const attendance of allAttendances) {
      const meeting = await ctx.db.get(attendance.meetingId);
      if (meeting && groupIds.has(meeting.groupId)) {
        const group = groups.find((g) => g._id === meeting.groupId);
        communityAttendances.push({
          ...attendance,
          meeting: {
            ...meeting,
            group: {
              id: group?._id,
              name: group?.name,
            },
          },
        });
      }
    }

    // Sort by recordedAt and take 20
    communityAttendances.sort((a, b) => b.recordedAt - a.recordedAt);
    const recentAttendance = communityAttendances.slice(0, 20);

    // Calculate attendance stats
    const totalAttendance = communityAttendances.length;
    const attendedCount = communityAttendances.filter((a) => a.status === 1).length;
    const attendanceRate = totalAttendance > 0 ? (attendedCount / totalAttendance) * 100 : 0;

    const notifsDisabled = await getUsersWithNotificationsDisabled(ctx, [
      user._id,
    ]);

    // Reported here so the detail screen offers exactly the actions
    // `updateMemberProfile` would accept — see `getProfileEditPermissions`.
    const { canEditProfile, contactEditBlockedReason } =
      await getProfileEditPermissions(ctx, args.communityId, args.targetUserId);

    return {
      id: user._id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      phone: user.phone || null,
      phoneVerified: user.phoneVerified || false,
      profilePhoto: getMediaUrl(user.profilePhoto),
      notificationsDisabled: notifsDisabled.has(user._id),
      canEditProfile,
      contactEditBlockedReason,
      // `?? null`, never `|| null`: timestamp 0 is 1970-01-01, a real
      // birthday, and turning it into null would make the edit form think the
      // date was empty.
      dateOfBirth: user.dateOfBirth ?? null,
      lastLogin: communityMembership.lastLogin || null,
      communityMembership: {
        roles: communityMembership.roles || 0,
        isAdmin: (communityMembership.roles ?? 0) >= ADMIN_ROLE_THRESHOLD,
        isPrimaryAdmin: communityMembership.roles === COMMUNITY_ROLES.PRIMARY_ADMIN,
        status: communityMembership.status || 0,
        joinedAt: communityMembership.createdAt || null,
        anniversary: communityMembership.communityAnniversary || null,
      },
      activeGroups: await Promise.all(
        activeGroups.map(async (m) => {
          const group = groups.find((g) => g._id === m.groupId);
          const groupType = group?.groupTypeId ? await ctx.db.get(group.groupTypeId) : null;
          return {
            groupId: m.groupId,
            groupName: group?.name || "",
            groupTypeId: groupType?._id || null,
            groupTypeName: groupType?.name || "",
            groupTypeSlug: groupType?.slug || "",
            role: m.role,
            joinedAt: m.joinedAt,
            notificationsEnabled: m.notificationsEnabled,
          };
        })
      ),
      recentAttendance: recentAttendance.map((a) => ({
        id: a._id,
        meetingId: a.meeting._id,
        meetingTitle: a.meeting.title,
        meetingScheduledAt: a.meeting.scheduledAt,
        meetingStatus: a.meeting.status,
        groupId: a.meeting.group.id,
        groupName: a.meeting.group.name,
        status: a.status,
        recordedAt: a.recordedAt,
      })),
      attendance: {
        total: totalAttendance,
        attended: attendedCount,
        rate: Math.round(attendanceRate * 100) / 100,
      },
    };
  },
});

/**
 * Update a community member's admin role
 */
export const updateMemberRole = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
    role: v.number(),
  },
  handler: async (ctx, args) => {
    const adminUserId = await requireAuth(ctx, args.token);

    // Get target user's current role
    const targetMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!targetMembership || targetMembership.status !== 1) {
      throw new Error("User not found in community");
    }

    const currentRole = targetMembership.roles ?? COMMUNITY_ROLES.MEMBER;
    const newRole = args.role;

    // Check if this involves admin-level changes
    const isPromotingToAdmin = newRole >= ADMIN_ROLE_THRESHOLD && currentRole < ADMIN_ROLE_THRESHOLD;
    const isDemotingFromAdmin = newRole < ADMIN_ROLE_THRESHOLD && currentRole >= ADMIN_ROLE_THRESHOLD;
    const involvesAdminChange = isPromotingToAdmin || isDemotingFromAdmin;

    // Primary Admin cannot be modified through this endpoint
    if (currentRole === COMMUNITY_ROLES.PRIMARY_ADMIN) {
      throw new Error("Cannot modify Primary Admin role. Use transfer instead.");
    }

    // Only Primary Admin can promote/demote admins
    if (involvesAdminChange) {
      await requirePrimaryAdmin(ctx, args.communityId, adminUserId);
    } else {
      await requireCommunityAdmin(ctx, args.communityId, adminUserId);
    }

    // Prevent Primary Admin from demoting themselves
    if (adminUserId === args.targetUserId && isDemotingFromAdmin) {
      const callerMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", adminUserId).eq("communityId", args.communityId)
        )
        .first();

      if (callerMembership?.roles === COMMUNITY_ROLES.PRIMARY_ADMIN) {
        throw new Error("Primary Admin cannot demote themselves. Transfer Primary Admin role first.");
      }
    }

    await ctx.db.patch(targetMembership._id, {
      roles: newRole,
      updatedAt: now(),
    });

    // Sync announcement group membership if admin status changed (transactional)
    if (isPromotingToAdmin || isDemotingFromAdmin) {
      await syncAnnouncementGroupMembership(ctx, args.targetUserId, args.communityId);
    }

    return { success: true };
  },
});

/**
 * Transfer the CALLER's Primary Admin role to another community member.
 *
 * Primary admin is a set, not a singleton (see PRIMARY_ADMIN_ROLE) — so read
 * this as "hand over MY primary-admin standing", not "reassign the
 * community's one owner". It demotes exactly two rows: the caller (4 → 3) and
 * the target (whatever → 4). Any OTHER primary admin in the community is
 * untouched and stays a primary admin, which is what makes this compose
 * correctly with the multi-primary state: the set shrinks by the caller and
 * grows by the target, net size unchanged.
 *
 * One exception to "net size unchanged": if the TARGET already holds role 4,
 * promoting them is a no-op and the set shrinks by one (the caller), who has
 * in effect just demoted themselves.
 *
 * That is DELIBERATE and must not be rejected. Both `updateMemberRole`
 * mutations refuse to touch a role-4 row ("Cannot modify Primary Admin role.
 * Use transfer instead."), so this mutation is the ONLY way out of the
 * primary-admin set. In a community with several primary admins, transferring
 * to a fellow primary admin is therefore the only way one of them can step
 * down WITHOUT promoting some third person. Blocking an already-primary target
 * would leave them permanently stuck at role 4. It is also safe: the target
 * remains an owner, so it can never strand a community with zero primary
 * admins.
 *
 * `targetWasAdmin` still holds under those semantics: it is read from the
 * TARGET's own row before the patch and only decides whether the target needs
 * to be added to the announcement group as a leader. Whether some third
 * person is also a primary admin has no bearing on it — the caller keeps
 * roles >= 3 and so keeps their own announcement-group standing, needing no
 * resync.
 */
export const transferPrimaryAdmin = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentAdminUserId = await requireAuth(ctx, args.token);

    // Require current user to be Primary Admin
    await requirePrimaryAdmin(ctx, args.communityId, currentAdminUserId);

    // Cannot transfer to yourself
    if (currentAdminUserId === args.targetUserId) {
      throw new Error("Cannot transfer Primary Admin to yourself");
    }

    // Verify target is a community member
    const targetMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!targetMembership || targetMembership.status !== 1) {
      throw new Error("Target user is not a community member");
    }

    // Get current admin's membership
    const currentAdminMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", currentAdminUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!currentAdminMembership) {
      throw new Error("Current admin membership not found");
    }

    const timestamp = now();
    const targetWasAdmin = (targetMembership.roles ?? 0) >= ADMIN_ROLE_THRESHOLD;

    // Demote current Primary Admin to regular Admin
    await ctx.db.patch(currentAdminMembership._id, {
      roles: COMMUNITY_ROLES.ADMIN,
      updatedAt: timestamp,
    });

    // Promote target to Primary Admin
    await ctx.db.patch(targetMembership._id, {
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      updatedAt: timestamp,
    });

    // Sync announcement group if target was not previously an admin (transactional)
    // (they need to become a leader in the announcement group)
    if (!targetWasAdmin) {
      await syncAnnouncementGroupMembership(ctx, args.targetUserId, args.communityId);
    }

    return { success: true };
  },
});

// ============================================================================
// Member Profile Edits (ADR-034)
// ============================================================================

const MAX_REASON_LENGTH = 500;

/**
 * `dateOfBirth` is stored as UTC midnight of the calendar day, which is what
 * `new Date("YYYY-MM-DD")` produces in the signup path
 * (`auth/helpers.parseAndValidateDate`). The API therefore speaks in
 * `YYYY-MM-DD` strings rather than timestamps: a calendar date has no
 * timezone, so there is nothing for the client and server to disagree about.
 */
function isoDateToUtcTimestamp(isoDate: string): number {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Date of birth must be in YYYY-MM-DD format");
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const timestamp = Date.UTC(year, month - 1, day);
  const reconstructed = new Date(timestamp);
  // Rejects impossible calendar dates like 2026-02-30, which Date.UTC would
  // otherwise silently roll forward into March.
  if (
    reconstructed.getUTCFullYear() !== year ||
    reconstructed.getUTCMonth() !== month - 1 ||
    reconstructed.getUTCDate() !== day
  ) {
    throw new Error("Date of birth is not a valid calendar date");
  }
  if (timestamp > Date.now()) {
    throw new Error("Date of birth cannot be in the future");
  }
  return timestamp;
}

/** Format a stored dateOfBirth timestamp back to YYYY-MM-DD, read in UTC. */
function utcTimestampToIsoDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Update a community member's profile, recording an append-only audit row.
 *
 * Callers submit ONLY the fields the admin actually changed. Every argument is
 * optional and `undefined` means "untouched": sending the whole form would let
 * a stale copy revert a concurrent edit by another admin, and the audit trail
 * would then record that reversal as a deliberate change by someone who never
 * touched the field. `null` is an explicit clear, which `email` and
 * `dateOfBirth` accept.
 *
 * See ADR-034 for why contact fields are gated the way they are.
 */
export const updateMemberProfile = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
    // YYYY-MM-DD, or null to clear.
    dateOfBirth: v.optional(v.union(v.string(), v.null())),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorUserId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, actorUserId);

    const target = await ctx.db.get(args.targetUserId);
    if (!target) {
      throw new Error("User not found");
    }

    const { canEditProfile, contactEditBlockedReason } =
      await getProfileEditPermissions(ctx, args.communityId, args.targetUserId);

    if (!canEditProfile) {
      throw new Error(
        "This member is not an active member of this community, so their profile cannot be edited here.",
      );
    }

    // Editing a fellow admin's record requires Primary Admin, mirroring
    // `updateMemberRole`. Editing your OWN record is always allowed — you can
    // already change all of it through self-service profile settings.
    const isSelfEdit = actorUserId === args.targetUserId;
    if (!isSelfEdit) {
      const targetMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", args.targetUserId).eq("communityId", args.communityId),
        )
        .first();
      if ((targetMembership?.roles ?? 0) >= ADMIN_ROLE_THRESHOLD) {
        await requirePrimaryAdmin(ctx, args.communityId, actorUserId);
      }
    }

    if (args.reason !== undefined && args.reason.length > MAX_REASON_LENGTH) {
      throw new Error(
        `Reason must be ${MAX_REASON_LENGTH} characters or fewer`,
      );
    }

    const changes: Array<{
      field: string;
      previousValue: string | null;
      newValue: string | null;
    }> = [];
    const updates: Record<string, unknown> = {};

    // --- Names ---------------------------------------------------------------
    if (args.firstName !== undefined) {
      const trimmed = args.firstName.trim();
      if (trimmed.length === 0) {
        throw new Error("First name is required");
      }
      if (trimmed !== (target.firstName ?? "")) {
        changes.push({
          field: "firstName",
          previousValue: target.firstName || null,
          newValue: trimmed,
        });
        updates.firstName = trimmed;
      }
    }

    if (args.lastName !== undefined) {
      const trimmed = args.lastName.trim();
      if (trimmed !== (target.lastName ?? "")) {
        changes.push({
          field: "lastName",
          previousValue: target.lastName || null,
          newValue: trimmed || null,
        });
        updates.lastName = trimmed || undefined;
      }
    }

    // --- Contact details -----------------------------------------------------
    // Order matters throughout this block: compare against the STORED value
    // before validating anything. Legacy rows hold values today's rules reject
    // (seven-digit phones, addresses with no public TLD), and validating a
    // value that has not actually changed would take an unrelated name edit
    // down with it. Comparison is on canonical forms, so `(202) 555-0123` and
    // `+12025550123` — or `Rafael@Test.com` and `rafael@test.com` — are the
    // same value and produce no change, no audit row and no blocker.

    let phoneChanged = false;
    let normalizedNewPhone: string | null = null;
    if (args.phone !== undefined) {
      const submitted = args.phone?.trim() ?? "";
      const stored = target.phone ?? "";

      if (submitted.length === 0) {
        // An empty phone means "none on file", not "remove it". Members
        // without a phone are common in migrated data, so a profile edit must
        // never require inventing one — but removing an existing number would
        // lock the member out of sign-in.
        if (stored.length > 0) {
          throw new Error(
            "A member's phone number cannot be removed, because it is how they sign in.",
          );
        }
      } else {
        const canonicalSubmitted = normalizePhone(submitted);
        const canonicalStored = stored ? normalizePhone(stored) : "";
        if (canonicalSubmitted !== canonicalStored) {
          phoneChanged = true;
          normalizedNewPhone = canonicalSubmitted;
        }
      }
    }

    let emailChanged = false;
    let normalizedNewEmail: string | null = null;
    if (args.email !== undefined) {
      const submitted = args.email?.trim() ?? "";
      const stored = target.email ?? "";

      if (submitted.length === 0) {
        if (stored.length > 0) {
          emailChanged = true;
          normalizedNewEmail = null;
        }
      } else {
        const canonicalSubmitted = submitted.toLowerCase();
        const canonicalStored = stored.toLowerCase();
        if (canonicalSubmitted !== canonicalStored) {
          emailChanged = true;
          normalizedNewEmail = canonicalSubmitted;
        }
      }
    }

    // Only a REAL contact change trips the guard.
    if ((phoneChanged || emailChanged) && contactEditBlockedReason) {
      throw new Error(
        `Phone and email cannot be changed here because ${contactEditBlockedReason}. ` +
          `They are sign-in credentials, so only the member can change them, through a flow that proves they own the new details.`,
      );
    }

    if (phoneChanged && normalizedNewPhone) {
      if (!isValidPhone(normalizedNewPhone)) {
        throw new Error("Please enter a valid phone number");
      }
      const existing = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", normalizedNewPhone))
        .first();
      if (existing && existing._id !== args.targetUserId) {
        throw new Error("Another account already uses this phone number");
      }

      changes.push({
        field: "phone",
        previousValue: target.phone || null,
        newValue: normalizedNewPhone,
      });
      updates.phone = normalizedNewPhone;
      // An admin typing a number is not proof the member owns it, so the
      // account must not inherit the previous number's verified status.
      updates.phoneVerified = false;
    }

    if (emailChanged) {
      if (normalizedNewEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNewEmail)) {
          throw new Error("Please enter a valid email address");
        }
        const existing = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", normalizedNewEmail))
          .first();
        if (existing && existing._id !== args.targetUserId) {
          throw new Error("Another account already uses this email address");
        }
      }

      changes.push({
        field: "email",
        previousValue: target.email || null,
        newValue: normalizedNewEmail,
      });
      updates.email = normalizedNewEmail ?? undefined;
    }

    // --- Date of birth -------------------------------------------------------
    if (args.dateOfBirth !== undefined) {
      // `?? null`, never `|| null`: timestamp 0 is 1970-01-01, a real birthday.
      const storedTimestamp = target.dateOfBirth ?? null;
      const storedIso =
        storedTimestamp === null ? null : utcTimestampToIsoDate(storedTimestamp);

      if (args.dateOfBirth === null) {
        if (storedIso !== null) {
          changes.push({
            field: "dateOfBirth",
            previousValue: storedIso,
            newValue: null,
          });
          updates.dateOfBirth = undefined;
        }
      } else if (args.dateOfBirth !== storedIso) {
        const timestamp = isoDateToUtcTimestamp(args.dateOfBirth);
        changes.push({
          field: "dateOfBirth",
          previousValue: storedIso,
          newValue: args.dateOfBirth,
        });
        updates.dateOfBirth = timestamp;
      }
    }

    // --- Apply ---------------------------------------------------------------
    // A no-op edit writes nothing at all, including no audit row: a save that
    // changed nothing is not an event worth recording, and a reason alone is
    // not an edit.
    if (changes.length === 0) {
      return { success: true, changed: false, changedFields: [] as string[] };
    }

    const nameChanged = changes.some(
      (c) => c.field === "firstName" || c.field === "lastName",
    );
    const contactChanged = changes.some(
      (c) => c.field === "email" || c.field === "phone",
    );

    // Keep the member findable by their corrected details.
    if (nameChanged || contactChanged) {
      updates.searchText = buildSearchText({
        firstName: (updates.firstName as string | undefined) ?? target.firstName,
        lastName:
          "lastName" in updates
            ? (updates.lastName as string | undefined)
            : target.lastName,
        email:
          "email" in updates
            ? (updates.email as string | undefined)
            : target.email,
        phone: (updates.phone as string | undefined) ?? target.phone,
      });
    }

    await ctx.db.patch(args.targetUserId, {
      ...updates,
      updatedAt: now(),
    });

    const timestamp = now();
    await ctx.db.insert("memberProfileAudits", {
      communityId: args.communityId,
      targetUserId: args.targetUserId,
      actorUserId,
      changes,
      reason: args.reason?.trim() || undefined,
      createdAt: timestamp,
    });

    // Refresh the denormalized display name held in `chatChannelMembers`.
    if (nameChanged) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.sync.memberships.syncUserProfileToChannels,
        { userId: args.targetUserId },
      );
    }

    return {
      success: true,
      changed: true,
      changedFields: changes.map((c) => c.field),
    };
  },
});

/**
 * The edit history for one member, newest first.
 *
 * Uses the framework's cursor pagination rather than a capped window: a capped
 * window makes rows past the cap permanently unreachable while `hasMore` stays
 * true, which is not much of an append-only audit trail.
 */
export const listMemberProfileAudits = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const result = await ctx.db
      .query("memberProfileAudits")
      .withIndex("by_community_target", (q) =>
        q
          .eq("communityId", args.communityId)
          .eq("targetUserId", args.targetUserId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (entry) => {
        const actor = await ctx.db.get(entry.actorUserId);
        return {
          id: entry._id,
          changes: entry.changes,
          reason: entry.reason ?? null,
          createdAt: entry.createdAt,
          actor: actor
            ? {
                id: actor._id,
                firstName: actor.firstName || "",
                lastName: actor.lastName || "",
              }
            : null,
        };
      }),
    );

    return { ...result, page };
  },
});

// ============================================================================
// User Group History
// ============================================================================

/**
 * Get user's complete group membership history
 */
export const getUserGroupHistory = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Get all groups in community (including archived)
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const groupIds = new Set(groups.map((g) => g._id));

    // Get all memberships for user
    const allMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .collect();

    // Filter to community groups
    const memberships = allMemberships.filter((m) => groupIds.has(m.groupId));

    // Sort by requestedAt desc, joinedAt desc
    memberships.sort((a, b) => {
      const aTime = a.requestedAt || a.joinedAt || 0;
      const bTime = b.requestedAt || b.joinedAt || 0;
      return bTime - aTime;
    });

    return Promise.all(
      memberships.map(async (m) => {
        const group = groups.find((g) => g._id === m.groupId);
        const groupType = group?.groupTypeId ? await ctx.db.get(group.groupTypeId) : null;
        const reviewer = m.requestReviewedById ? await ctx.db.get(m.requestReviewedById) : null;

        return {
          id: m._id,
          groupId: m.groupId,
          groupName: group?.name || "",
          groupTypeId: groupType?._id || null,
          groupTypeName: groupType?.name || "",
          groupTypeSlug: groupType?.slug || "",
          role: m.role,
          joinedAt: m.joinedAt,
          leftAt: m.leftAt || null,
          requestStatus: m.requestStatus || null,
          requestedAt: m.requestedAt || null,
          requestReviewedAt: m.requestReviewedAt || null,
          requestReviewedBy: reviewer
            ? {
                id: reviewer._id,
                firstName: reviewer.firstName || "",
                lastName: reviewer.lastName || "",
              }
            : null,
          isArchived: group?.isArchived || false,
          groupArchivedAt: group?.archivedAt || null,
          notificationsEnabled: m.notificationsEnabled,
        };
      })
    );
  },
});
