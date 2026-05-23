/**
 * Tests for the placeholder claim path introduced alongside
 * `inviteAndAssign` (commit cf0fd57):
 *
 *   - A placeholder `users` row (created by inviteAndAssign with
 *     `isPlaceholder: true`, `isActive: false`) is claimed in-place when
 *     the owner of the phone signs up via the normal OTP flow.
 *   - The placeholder's `_id` is preserved, so pre-existing
 *     `roleAssignments` / `groupMembers` / `userCommunities` rows still
 *     point at the same user.
 *   - A real (non-placeholder) user is never claimed.
 *   - Email collisions during claim error out cleanly.
 *
 * Driving `registerNewUser` end-to-end requires a phone verification token
 * (the action's first guard). `verifyPhoneOTP` is a Twilio-backed action,
 * so we bypass it by seeding the token directly via the internal mutation
 * `storePhoneVerificationToken` — the same mutation `verifyPhoneOTP` would
 * have called. This is sufficient to exercise the claim mechanism (the
 * only branch this commit changes).
 */

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../test.setup";
import type { Id } from "../../_generated/dataModel";

/**
 * Seed a placeholder user (mirrors what `inviteAndAssign` would have
 * written) plus a community + group + active membership rows for that
 * placeholder. Returns the ids so claim tests can assert preservation.
 */
async function seedPlaceholderWithMemberships(
  t: ReturnType<typeof convexTest>,
  phone: string,
) {
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test",
      isPublic: true,
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Campus",
      slug: "campus",
      isActive: true,
      createdAt: Date.now(),
      displayOrder: 1,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Brooklyn Campus",
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const placeholderId = await ctx.db.insert("users", {
      firstName: "Pat",
      phone,
      isActive: false,
      isPlaceholder: true,
      phoneVerified: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const communityMembershipId = await ctx.db.insert("userCommunities", {
      userId: placeholderId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const groupMembershipId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: placeholderId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });

    return {
      placeholderId,
      communityId,
      groupId,
      communityMembershipId,
      groupMembershipId,
    } as {
      placeholderId: Id<"users">;
      communityId: Id<"communities">;
      groupId: Id<"groups">;
      communityMembershipId: Id<"userCommunities">;
      groupMembershipId: Id<"groupMembers">;
    };
  });
}

/**
 * Plant a phone verification token so `registerNewUser` accepts the call.
 * `verifyPhoneOTP` writes the same row via the same internal mutation; we
 * bypass it to keep tests off Twilio.
 */
async function plantPhoneToken(
  t: ReturnType<typeof convexTest>,
  phone: string,
): Promise<string> {
  const token = "test-phone-verification-token-" + Math.random().toString(36).slice(2);
  await t.mutation(
    internal.functions.authInternal.storePhoneVerificationToken,
    { phone, token },
  );
  return token;
}

describe("placeholder claim on phone-OTP registration", () => {
  it("claims an existing placeholder in-place (no new users row, _id preserved, flags cleared)", async () => {
    const t = convexTest(schema, modules);
    const phone = "+12025550555";
    const {
      placeholderId,
      communityMembershipId,
      groupMembershipId,
    } = await seedPlaceholderWithMemberships(t, phone);

    const tokenStr = await plantPhoneToken(t, phone);

    const result = await t.action(
      api.functions.auth.registration.registerNewUser,
      {
        phone,
        firstName: "Pat",
        lastName: "Smith",
        email: "pat.smith@example.com",
        otp: "000000",
        phoneVerificationToken: tokenStr,
      },
    );

    // The claimed user id MUST be the same row.
    expect(result.user.id).toBe(placeholderId);

    // Exactly one users row for this phone — no duplicate insert.
    const usersForPhone = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .collect(),
    );
    expect(usersForPhone).toHaveLength(1);
    expect(usersForPhone[0]._id).toBe(placeholderId);

    // Flags cleared, isActive flipped, name/email from registration applied.
    const claimed = await t.run((ctx) => ctx.db.get(placeholderId));
    expect(claimed?.isPlaceholder).toBeUndefined();
    expect(claimed?.isActive).toBe(true);
    expect(claimed?.phoneVerified).toBe(true);
    expect(claimed?.firstName).toBe("Pat");
    expect(claimed?.lastName).toBe("Smith");
    expect(claimed?.email).toBe("pat.smith@example.com");

    // Pre-existing memberships still point at the same user id (no rewrites).
    const com = await t.run((ctx) => ctx.db.get(communityMembershipId));
    expect(com?.userId).toBe(placeholderId);
    const gm = await t.run((ctx) => ctx.db.get(groupMembershipId));
    expect(gm?.userId).toBe(placeholderId);
  });

  it("a pre-existing role assignment for the placeholder survives the claim", async () => {
    const t = convexTest(schema, modules);
    const phone = "+12025550556";
    const seeded = await seedPlaceholderWithMemberships(t, phone);

    // Plant a team + role + assignment owned by the placeholder, as if
    // `inviteAndAssign` had run earlier.
    const { teamId, roleId, planId, assignmentId } = await t.run(async (ctx) => {
      const teamId = await ctx.db.insert("teams", {
        groupId: seeded.groupId,
        communityId: seeded.communityId,
        name: "Worship Team",
        isArchived: false,
        createdAt: Date.now(),
        createdById: seeded.placeholderId,
        updatedAt: Date.now(),
      });
      const roleId = await ctx.db.insert("teamRoles", {
        teamId,
        communityId: seeded.communityId,
        name: "Drums",
        sortOrder: 0,
        isArchived: false,
        createdAt: Date.now(),
        createdById: seeded.placeholderId,
      });
      const eventDate = Date.now() + 7 * 86400000;
      const planId = await ctx.db.insert("eventPlans", {
        groupId: seeded.groupId,
        communityId: seeded.communityId,
        title: "Sunday Service",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
        status: "draft",
        createdById: seeded.placeholderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const assignmentId = await ctx.db.insert("roleAssignments", {
        planId,
        teamId,
        roleId,
        userId: seeded.placeholderId,
        eventDate,
        status: "unconfirmed",
        assignedById: seeded.placeholderId,
        assignedAt: Date.now(),
      });
      return { teamId, roleId, planId, assignmentId };
    });

    const tokenStr = await plantPhoneToken(t, phone);
    const result = await t.action(
      api.functions.auth.registration.registerNewUser,
      {
        phone,
        firstName: "Pat",
        lastName: "Smith",
        otp: "000000",
        phoneVerificationToken: tokenStr,
      },
    );
    expect(result.user.id).toBe(seeded.placeholderId);

    // The assignment still points at the claimed user.
    const assignment = await t.run((ctx) => ctx.db.get(assignmentId));
    expect(assignment?.userId).toBe(seeded.placeholderId);
    expect(assignment?.planId).toBe(planId);
    expect(assignment?.teamId).toBe(teamId);
    expect(assignment?.roleId).toBe(roleId);
  });

  it("never claims a real (non-placeholder) user with the same phone — logs them in instead", async () => {
    const t = convexTest(schema, modules);
    const phone = "+12025550557";

    // Real user, no isPlaceholder flag.
    const realUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Real",
        lastName: "User",
        email: "real@example.com",
        phone,
        isActive: true,
        phoneVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const tokenStr = await plantPhoneToken(t, phone);
    const result = await t.action(
      api.functions.auth.registration.registerNewUser,
      {
        phone,
        firstName: "Pretender",
        lastName: "Smith",
        email: "pretender@example.com",
        otp: "000000",
        phoneVerificationToken: tokenStr,
      },
    );

    // Action returns existing user (idempotent), not a claim of theirs.
    expect(result.user.id).toBe(realUserId);

    // Their record is unchanged: firstName/lastName/email NOT overwritten.
    const after = await t.run((ctx) => ctx.db.get(realUserId));
    expect(after?.firstName).toBe("Real");
    expect(after?.lastName).toBe("User");
    expect(after?.email).toBe("real@example.com");
    expect(after?.isPlaceholder).toBeUndefined();

    // No duplicate user row.
    const usersForPhone = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .collect(),
    );
    expect(usersForPhone).toHaveLength(1);
  });

  it("rejects claim cleanly when registration supplies an email that already belongs to another user", async () => {
    const t = convexTest(schema, modules);
    const phone = "+12025550558";
    await seedPlaceholderWithMemberships(t, phone);

    // Another, unrelated real user already owns this email.
    await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Other",
        email: "shared@example.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const tokenStr = await plantPhoneToken(t, phone);

    await expect(
      t.action(api.functions.auth.registration.registerNewUser, {
        phone,
        firstName: "Pat",
        lastName: "Smith",
        email: "shared@example.com",
        otp: "000000",
        phoneVerificationToken: tokenStr,
      }),
    ).rejects.toThrow(/email already exists/i);
  });

  it("internal claimPlaceholderByPhoneInternal returns null for a non-placeholder user", async () => {
    const t = convexTest(schema, modules);
    const phone = "+12025550559";

    await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Real",
        phone,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const claimedId = await t.mutation(
      internal.functions.authInternal.claimPlaceholderByPhoneInternal,
      { phone, firstName: "X", lastName: "Y" },
    );
    expect(claimedId).toBeNull();
  });

  it("internal claimPlaceholderByPhoneInternal claims a placeholder and clears its flags", async () => {
    const t = convexTest(schema, modules);
    const phone = "+12025550560";
    const placeholderId = await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Old",
        phone,
        isActive: false,
        isPlaceholder: true,
        phoneVerified: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const claimedId = await t.mutation(
      internal.functions.authInternal.claimPlaceholderByPhoneInternal,
      {
        phone,
        firstName: "New",
        lastName: "Name",
        email: "new@example.com",
      },
    );
    expect(claimedId).toBe(placeholderId);

    const after = await t.run((ctx) => ctx.db.get(placeholderId));
    expect(after?.isPlaceholder).toBeUndefined();
    expect(after?.isActive).toBe(true);
    expect(after?.phoneVerified).toBe(true);
    expect(after?.firstName).toBe("New");
    expect(after?.lastName).toBe("Name");
    expect(after?.email).toBe("new@example.com");
  });
});
