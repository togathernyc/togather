/**
 * Admin functions for duplicate account management
 *
 * Includes:
 * - Listing duplicate accounts grouped by phone number
 * - Merging duplicate accounts
 * - Viewing merged accounts history
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import { now } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { requireCommunityAdmin } from "./auth";

// ============================================================================
// Duplicate Accounts
// ============================================================================

/**
 * List all duplicate accounts grouped by phone number
 *
 * Uses cursor-based pagination with safety limit to avoid collecting entire users table
 */
export const listDuplicateAccounts = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Fetch users in a single query (Convex only allows one paginated query per function)
    const MAX_USERS = 5000;

    // Define user type for proper typing
    type UserRecord = {
      _id: Id<"users">;
      phone?: string | null;
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      lastLogin?: number | null;
      createdAt?: number | null;
    };

    const allUsers = await ctx.db
      .query("users")
      .filter((q) =>
        q.and(
          q.eq(q.field("isActive"), true),
          q.neq(q.field("phone"), null),
          q.neq(q.field("phone"), "")
        )
      )
      .take(MAX_USERS);

    const phoneGroups = new Map<string, UserRecord[]>();

    for (const user of allUsers) {
      if (!user.phone) continue;
      if (user.email?.includes("@relaymember.gettogather.co")) continue;

      if (!phoneGroups.has(user.phone)) {
        phoneGroups.set(user.phone, []);
      }
      phoneGroups.get(user.phone)!.push(user);
    }

    // Filter to only duplicates
    const duplicateGroups = Array.from(phoneGroups.entries())
      .filter(([_, accounts]) => accounts.length > 1)
      .map(([phone, accounts]) => ({ phone, accounts }));

    // Build response with details
    const duplicateGroupsWithDetails = await Promise.all(
      duplicateGroups.map(async ({ phone, accounts }) => {
        const accountsWithDetails = await Promise.all(
          accounts.map(async (account) => {
            // Get community memberships
            const userCommunities = await ctx.db
              .query("userCommunities")
              .withIndex("by_user", (q) => q.eq("userId", account._id))
              .collect();

            const communities = await Promise.all(
              userCommunities.map(async (uc) => {
                const community = await ctx.db.get(uc.communityId);
                return {
                  communityId: uc.communityId,
                  communityName: community?.name || "",
                  role: uc.roles || 0,
                  status: uc.status || 0,
                  createdAt: uc.createdAt || 0,
                };
              })
            );

            // Get group memberships
            const groupMemberships = await ctx.db
              .query("groupMembers")
              .withIndex("by_user", (q) => q.eq("userId", account._id))
              .collect();

            const groupsData = await Promise.all(
              groupMemberships.map(async (gm) => {
                const group = await ctx.db.get(gm.groupId);
                return {
                  groupId: gm.groupId,
                  groupName: group?.name || "",
                  role: gm.role === "leader" ? 2 : 1,
                  joinedAt: gm.joinedAt || null,
                };
              })
            );

            const groupsCount = groupsData.length;

            // Calculate activity score
            let score = 0;
            if (account.lastLogin) score += 10;
            score += Math.min(groupsCount * 2, 20);
            score += Math.min(communities.length * 5, 15);
            if (account.email?.includes("@")) score += 5;

            return {
              id: account._id,
              email: account.email || "",
              firstName: account.firstName || "",
              lastName: account.lastName || "",
              phone: account.phone,
              createdAt: account.createdAt || 0,
              lastLogin: account.lastLogin || null,
              communities,
              groups: groupsData,
              groupsCount,
              score,
            };
          })
        );

        // Find best account (highest score)
        const bestAccount = accountsWithDetails.reduce((best, current) =>
          current.score > best.score ? current : best
        );

        const accountsWithRecommendation = accountsWithDetails.map((acc) => ({
          ...acc,
          isRecommended: acc.id === bestAccount.id,
          score: undefined,
        }));

        // Find most recent login
        const loginTimes = accounts
          .map((acc) => acc.lastLogin)
          .filter((d): d is number => d !== null && d !== undefined)
          .sort((a, b) => b - a);
        const mostRecentLogin = loginTimes[0] || null;

        return {
          phone,
          accounts: accountsWithRecommendation,
          mostRecentLogin,
          sortKey: mostRecentLogin || 0,
        };
      })
    );

    // Sort by most recent login
    duplicateGroupsWithDetails.sort((a, b) => b.sortKey - a.sortKey);

    const totalAffected = duplicateGroupsWithDetails.reduce(
      (sum, group) => sum + group.accounts.length,
      0
    );

    return {
      totalDuplicatePhones: duplicateGroupsWithDetails.length,
      totalAffectedAccounts: totalAffected,
      accountsToMerge: totalAffected - duplicateGroupsWithDetails.length,
      duplicateGroups: duplicateGroupsWithDetails.map((g) => ({
        phone: g.phone,
        accounts: g.accounts,
        mostRecentLogin: g.mostRecentLogin,
      })),
    };
  },
});

/**
 * Merge duplicate accounts into a primary account
 */
export const mergeDuplicateAccounts = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    phone: v.string(),
    primaryAccountId: v.id("users"),
    secondaryAccountIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Validate primary account exists
    const primary = await ctx.db.get(args.primaryAccountId);
    if (!primary) {
      throw new Error("Primary account not found");
    }

    // Validate secondary accounts exist
    const secondaryAccounts = await Promise.all(
      args.secondaryAccountIds.map((id) => ctx.db.get(id))
    );
    if (secondaryAccounts.some((acc) => !acc)) {
      throw new Error("One or more secondary accounts not found");
    }

    // Verify all accounts have the same phone number
    const allPhones = new Set(
      [primary.phone, ...secondaryAccounts.map((acc) => acc?.phone)].filter(Boolean)
    );
    if (allPhones.size > 1) {
      throw new Error("All accounts must have the same phone number");
    }

    let mergedCount = 0;
    const timestamp = now();

    for (const secondary of secondaryAccounts) {
      if (!secondary) continue;

      // Transfer group memberships
      const groupMemberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", secondary._id))
        .collect();

      for (const membership of groupMemberships) {
        // Check if primary already has this membership
        const existing = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", membership.groupId).eq("userId", args.primaryAccountId)
          )
          .first();

        if (!existing) {
          // Transfer membership to primary
          await ctx.db.patch(membership._id, {
            userId: args.primaryAccountId,
          });
        } else {
          // Keep higher role
          const existingRolePriority = existing.role === "leader" ? 2 : 1;
          const membershipRolePriority = membership.role === "leader" ? 2 : 1;

          if (membershipRolePriority > existingRolePriority) {
            await ctx.db.patch(existing._id, {
              role: membership.role,
            });
          }
          // Delete duplicate membership
          await ctx.db.delete(membership._id);
        }
      }

      // Transfer community memberships
      const userCommunities = await ctx.db
        .query("userCommunities")
        .withIndex("by_user", (q) => q.eq("userId", secondary._id))
        .collect();

      for (const uc of userCommunities) {
        const existing = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", args.primaryAccountId).eq("communityId", uc.communityId)
          )
          .first();

        if (!existing) {
          // Transfer community membership to primary
          await ctx.db.patch(uc._id, {
            userId: args.primaryAccountId,
          });
        } else {
          // Keep higher role
          if ((uc.roles || 0) > (existing.roles || 0)) {
            await ctx.db.patch(existing._id, {
              roles: uc.roles,
            });
          }
          // Delete duplicate membership
          await ctx.db.delete(uc._id);
        }
      }

      // Deactivate secondary account (soft delete)
      const newEmail = secondary.email?.startsWith("merged_")
        ? secondary.email
        : `merged_${secondary._id}_${secondary.email}`;

      await ctx.db.patch(secondary._id, {
        isActive: false,
        email: newEmail,
        updatedAt: timestamp,
      });

      mergedCount++;
    }

    return {
      success: true,
      mergedCount,
      primaryAccountId: args.primaryAccountId,
      message: `Successfully merged ${mergedCount} account(s) into primary account`,
    };
  },
});

/**
 * List merged accounts history
 *
 * Returns accounts that have been merged (deactivated with merged_ email prefix).
 * Grouped by phone number to show merge decisions.
 * Uses cursor-based pagination with safety limit.
 */
export const listMergedAccounts = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Find deactivated users with merged_ email prefix
    const MAX_USERS = 5000; // Safety limit

    // Get all inactive users (Convex only allows one paginate per function, so use take())
    const allInactiveUsers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), false))
      .take(MAX_USERS);

    // Filter for merged users (those with merged_ email prefix)
    const mergedUsers = allInactiveUsers.filter(
      (user) => user?.email?.startsWith("merged_")
    );

    // Group by phone number
    const phoneGroups = new Map<
      string,
      {
        phone: string;
        primaryAccountId: Id<"users"> | null;
        primaryEmail: string;
        primaryName: string;
        secondaryAccountIds: Id<"users">[];
        secondaryAccounts: {
          id: Id<"users">;
          email: string;
          firstName: string;
          lastName: string;
          groupsTransferred: number;
        }[];
        groups: {
          groupId: Id<"groups">;
          groupName: string;
          role: number;
          wasTransferred: boolean;
        }[];
        mergedAt: number | null;
        mergedBy: string | null;
      }
    >();

    for (const mergedUser of mergedUsers) {
      if (!mergedUser.phone) continue;

      // Parse the original email from merged_<id>_<email>
      const originalEmail = mergedUser.email?.replace(
        /^merged_[^_]+_/,
        ""
      ) || "";

      // Find the primary account (active account with same phone)
      const primaryAccount = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", mergedUser.phone!))
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();

      if (!primaryAccount) continue;

      // Get group memberships for merged user (they would have been transferred)
      const mergedUserGroups = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", mergedUser._id))
        .collect();

      const groupsTransferred = mergedUserGroups.length;

      // Create or update phone group entry
      if (!phoneGroups.has(mergedUser.phone)) {
        // Get primary account's groups
        const primaryGroups = await ctx.db
          .query("groupMembers")
          .withIndex("by_user", (q) => q.eq("userId", primaryAccount._id))
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .collect();

        const groupsWithDetails = await Promise.all(
          primaryGroups.map(async (gm) => {
            const group = await ctx.db.get(gm.groupId);
            return {
              groupId: gm.groupId,
              groupName: group?.name || "",
              role: gm.role === "leader" ? 2 : 1,
              wasTransferred: false, // Primary's original groups
            };
          })
        );

        phoneGroups.set(mergedUser.phone, {
          phone: mergedUser.phone,
          primaryAccountId: primaryAccount._id,
          primaryEmail: primaryAccount.email || "",
          primaryName: `${primaryAccount.firstName || ""} ${primaryAccount.lastName || ""}`.trim(),
          secondaryAccountIds: [],
          secondaryAccounts: [],
          groups: groupsWithDetails,
          mergedAt: mergedUser.updatedAt || null,
          mergedBy: null, // We don't track who performed the merge
        });
      }

      const entry = phoneGroups.get(mergedUser.phone)!;
      entry.secondaryAccountIds.push(mergedUser._id);
      entry.secondaryAccounts.push({
        id: mergedUser._id,
        email: originalEmail,
        firstName: mergedUser.firstName || "",
        lastName: mergedUser.lastName || "",
        groupsTransferred,
      });
    }

    // Convert to array and sort by most recent merge
    const decisions = Array.from(phoneGroups.values())
      .sort((a, b) => (b.mergedAt || 0) - (a.mergedAt || 0));

    return {
      totalDecisions: decisions.length,
      decisions: decisions.map((d) => ({
        phone: d.phone,
        primary_account_id: d.primaryAccountId,
        primary_email: d.primaryEmail,
        primary_name: d.primaryName,
        secondary_account_ids: d.secondaryAccountIds,
        secondary_accounts: d.secondaryAccounts.map((sa) => ({
          id: sa.id,
          email: sa.email,
          first_name: sa.firstName,
          last_name: sa.lastName,
          groups_transferred: sa.groupsTransferred,
        })),
        groups: d.groups.map((g) => ({
          group_id: g.groupId,
          group_name: g.groupName,
          role: g.role,
          was_transferred: g.wasTransferred,
        })),
        merged_at: d.mergedAt,
        merged_by: d.mergedBy,
      })),
    };
  },
});
