/**
 * Admin Member Profile Edit Tests (ADR-034)
 *
 * Covers `admin.members.updateMemberProfile` and `listMemberProfileAudits`:
 * - who may edit, and which fields
 * - the claimed-account rule (every ownership signal)
 * - the no-authority-anywhere rule (every authority surface)
 * - membership status, legacy-format values, validation, uniqueness
 * - audit row contents and ordering
 *
 * Run with: cd apps/convex && pnpm test __tests__/admin-member-profile-edit.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import { drainScheduledFunctions } from "./helpers/drainScheduledFunctions";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

interface TestSetup {
  adminId: Id<"users">;
  memberId: Id<"users">;
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupId: Id<"groups">;
  adminToken: string;
}

/**
 * A primary admin, and an UNCLAIMED plain member — no verified phone, no
 * password, no login anywhere. That is the population this feature exists for,
 * so it is the default fixture; individual tests add whatever signal they are
 * exercising.
 */
async function seed(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const ts = Date.now();

    const adminId = await ctx.db.insert("users", {
      firstName: "Reg",
      lastName: "Admin",
      email: "admin@test.com",
      phone: "+12025551001",
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Rafel",
      lastName: "Ortiz",
      email: "rafael@test.com",
      phone: "+12025550123",
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: ts,
      updatedAt: ts,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: ts,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group 1",
      isArchived: false,
      isPublic: true,
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1,
      createdAt: ts,
    });

    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: ts,
    });

    return { adminId, memberId, communityId, groupTypeId, groupId };
  });

  const tokens = await generateTokens(ids.adminId, ids.communityId);
  return { ...ids, adminToken: tokens.accessToken };
}

/**
 * Call the mutation and drain what it schedules.
 *
 * A name change schedules `syncUserProfileToChannels`; left running, that job
 * keeps convex-test's global transaction state open and trips "test began
 * while previous transaction was still open" in a LATER test — possibly in an
 * unrelated file sharing the vitest worker. See the helper's own comment.
 */
async function editProfile(
  t: ReturnType<typeof convexTest>,
  args: Parameters<typeof t.mutation>[1],
) {
  const result = await t.mutation(
    api.functions.admin.members.updateMemberProfile,
    args as any,
  );
  await drainScheduledFunctions(t);
  return result;
}

/** Read the target user row straight from the DB. */
async function readMember(t: ReturnType<typeof convexTest>, id: Id<"users">) {
  return await t.run(async (ctx) => await ctx.db.get(id));
}

async function listAudits(t: ReturnType<typeof convexTest>, s: TestSetup) {
  return await t.query(api.functions.admin.members.listMemberProfileAudits, {
    token: s.adminToken,
    communityId: s.communityId,
    targetUserId: s.memberId,
    paginationOpts: { numItems: 50, cursor: null },
  });
}

// ============================================================================
// Editing
// ============================================================================

describe("updateMemberProfile — editing", () => {
  test("corrects a misspelled first name and records one audit row", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const result = await editProfile(
      t,
      {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        firstName: "Rafael",
        reason: "Corrected from Gold Card",
      },
    );

    expect(result.changed).toBe(true);
    expect(result.changedFields).toEqual(["firstName"]);

    const user = await readMember(t, s.memberId);
    expect(user?.firstName).toBe("Rafael");

    const audits = await listAudits(t, s);
    expect(audits.page).toHaveLength(1);
    expect(audits.page[0].changes).toEqual([
      { field: "firstName", previousValue: "Rafel", newValue: "Rafael" },
    ]);
    expect(audits.page[0].reason).toBe("Corrected from Gold Card");
    expect(audits.page[0].actor?.id).toBe(s.adminId);
  });

  test("an edit touching two fields is ONE audit row, not two", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
      phone: "+12025559999",
    });

    const audits = await listAudits(t, s);
    expect(audits.page).toHaveLength(1);
    expect(audits.page[0].changes.map((c: any) => c.field).sort()).toEqual([
      "firstName",
      "phone",
    ]);
  });

  test("rebuilds searchText so the member stays findable by corrected details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
    });

    const user = await readMember(t, s.memberId);
    expect(user?.searchText).toContain("rafael");
  });

  test("a no-op edit writes nothing at all — not even an audit row", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const result = await editProfile(
      t,
      {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        firstName: "Rafel",
        reason: "a reason alone is not an edit",
      },
    );

    expect(result.changed).toBe(false);
    const audits = await listAudits(t, s);
    expect(audits.page).toHaveLength(0);
  });

  test("leaves another admin's concurrent name fix alone when only the phone changed", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // First admin corrects the name.
    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
    });

    // Second admin, working from a form opened BEFORE that fix, changes only
    // the phone. Because the client submits dirty fields only, the stale name
    // is never sent and cannot revert the first correction.
    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      phone: "+12025559999",
    });

    const user = await readMember(t, s.memberId);
    expect(user?.firstName).toBe("Rafael");
    expect(user?.phone).toBe("+12025559999");
  });

  test("allows profile edits for a member who has no phone on record", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { phone: undefined });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
      phone: "",
    });

    const user = await readMember(t, s.memberId);
    expect(user?.firstName).toBe("Rafael");
  });

  test("refuses to remove an existing phone, which is how the member signs in", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        phone: "",
      }),
    ).rejects.toThrow(/cannot be removed/i);
  });

  test("first name cannot be cleared", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        firstName: "   ",
      }),
    ).rejects.toThrow(/first name is required/i);
  });

  test("email can be cleared", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: null,
    });

    const user = await readMember(t, s.memberId);
    expect(user?.email).toBeUndefined();
  });

  test("changing a phone number leaves phoneVerified false", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      phone: "2025559999",
    });

    const user = await readMember(t, s.memberId);
    // Normalized to E.164 on the way in, and NOT trusted as verified: an admin
    // typing a number is not proof the member owns it.
    expect(user?.phone).toBe("+12025559999");
    expect(user?.phoneVerified).toBe(false);
  });
});

// ============================================================================
// Date of birth
// ============================================================================

describe("updateMemberProfile — date of birth", () => {
  test("stores a picked date as UTC midnight of that calendar day", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      dateOfBirth: "1990-04-12",
    });

    const user = await readMember(t, s.memberId);
    expect(user?.dateOfBirth).toBe(Date.UTC(1990, 3, 12));
    // Read back in UTC, the day must be the day that was picked — this is the
    // assertion that fails if the converters ever drift to local getters.
    expect(new Date(user!.dateOfBirth!).getUTCDate()).toBe(12);
  });

  test("treats the Unix epoch as a real birthday, not an empty value", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { dateOfBirth: 0 });
    });

    // The detail query must report timestamp 0 rather than null, or the edit
    // form treats the birthday as empty and clears it on the next save.
    const detail = await t.query(
      api.functions.admin.members.getCommunityMemberById,
      {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
      },
    );
    expect(detail?.dateOfBirth).toBe(0);

    // And resubmitting the same day is a no-op, not a clear.
    const result = await editProfile(
      t,
      {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        dateOfBirth: "1970-01-01",
      },
    );
    expect(result.changed).toBe(false);
    expect((await readMember(t, s.memberId))?.dateOfBirth).toBe(0);
  });

  test("clears the date of birth when null is submitted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { dateOfBirth: Date.UTC(1990, 3, 12) });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      dateOfBirth: null,
    });

    const user = await readMember(t, s.memberId);
    expect(user?.dateOfBirth).toBeUndefined();
    const audits = await listAudits(t, s);
    expect(audits.page[0].changes).toEqual([
      { field: "dateOfBirth", previousValue: "1990-04-12", newValue: null },
    ]);
  });

  test("rejects an impossible calendar date instead of rolling it forward", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        dateOfBirth: "2026-02-30",
      }),
    ).rejects.toThrow(/valid calendar date/i);
  });
});

// ============================================================================
// The claimed-account rule
// ============================================================================

describe("contact edits — the claimed-account rule", () => {
  test("an unclaimed account allows contact edits", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: "rafael.ortiz@test.com",
    });

    expect((await readMember(t, s.memberId))?.email).toBe(
      "rafael.ortiz@test.com",
    );
  });

  // Each of these four is an independent signal that a human has signed in.
  // `phoneVerified` alone is NOT sufficient: `legacyLogin` issues real JWTs
  // without ever setting it.
  const claimSignals: Array<[string, Record<string, unknown>]> = [
    ["a verified phone", { phoneVerified: true }],
    ["a stored legacy password", { password: "$2b$10$abcdefghijklmnop" }],
    ["a recorded login on the user row", { lastLogin: 1_700_000_000_000 }],
  ];

  for (const [label, patch] of claimSignals) {
    test(`${label} means the account is claimed and locks contact edits`, async () => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      await t.run(async (ctx) => {
        await ctx.db.patch(s.memberId, patch);
      });

      await expect(
        t.mutation(api.functions.admin.members.updateMemberProfile, {
          token: s.adminToken,
          communityId: s.communityId,
          targetUserId: s.memberId,
          email: "attacker@evil.com",
        }),
      ).rejects.toThrow(/cannot be changed here/i);

      expect((await readMember(t, s.memberId))?.email).toBe("rafael@test.com");
    });
  }

  test("a login recorded on a MEMBERSHIP row also means the account is claimed", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // Current sign-in paths stamp lastLogin here, not on the user row, so
    // checking only `users.lastLogin` would miss almost everyone.
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user", (q) => q.eq("userId", s.memberId))
        .first();
      await ctx.db.patch(membership!._id, { lastLogin: 1_700_000_000_000 });
    });

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        phone: "+12025559999",
      }),
    ).rejects.toThrow(/cannot be changed here/i);
  });

  test("names and birthdays stay correctable on a CLAIMED account", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { phoneVerified: true });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
      dateOfBirth: "1990-04-12",
    });

    const user = await readMember(t, s.memberId);
    expect(user?.firstName).toBe("Rafael");
    expect(user?.dateOfBirth).toBe(Date.UTC(1990, 3, 12));
  });
});

// ============================================================================
// The no-authority-anywhere rule — one case per surface
// ============================================================================

describe("contact edits — the authority rule", () => {
  /** Apply an authority-granting row/field, then assert contact edits fail. */
  async function expectLocked(
    t: ReturnType<typeof convexTest>,
    s: TestSetup,
  ): Promise<void> {
    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        email: "attacker@evil.com",
      }),
    ).rejects.toThrow(/cannot be changed here/i);

    // …while a name edit still goes through, since names are not credentials.
    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
    });
    expect((await readMember(t, s.memberId))?.firstName).toBe("Rafael");
  }

  test("a platform superuser flag locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { isSuperuser: true });
    });
    await expectLocked(t, s);
  });

  test("a platform staff flag locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { isStaff: true });
    });
    await expectLocked(t, s);
  });

  test("a platform role such as poster_admin locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { platformRoles: ["poster_admin"] });
    });
    await expectLocked(t, s);
  });

  test("a GLOBAL users.roles admin flag locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // messaging/flagging.ts isUserAdmin reads this field directly, with no
    // membership behind it, and grants cross-community moderation.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { roles: 3 });
    });
    await expectLocked(t, s);
  });

  test("an admin role in ANOTHER community locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const otherId = await ctx.db.insert("communities", {
        name: "Other",
        slug: "other",
        isPublic: true,
        timezone: "America/New_York",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId: s.memberId,
        communityId: otherId,
        roles: COMMUNITY_ROLES.ADMIN,
        status: 1,
        createdAt: Date.now(),
      });
    });
    await expectLocked(t, s);
  });

  test("an admin role in a community the member has LEFT does not lock contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const otherId = await ctx.db.insert("communities", {
        name: "Other",
        slug: "other",
        isPublic: true,
        timezone: "America/New_York",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId: s.memberId,
        communityId: otherId,
        roles: COMMUNITY_ROLES.ADMIN,
        status: 2, // left — confers no authority
        createdAt: Date.now(),
      });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: "rafael.ortiz@test.com",
    });
    expect((await readMember(t, s.memberId))?.email).toBe(
      "rafael.ortiz@test.com",
    );
  });

  test("leading a group locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId: s.groupId,
        userId: s.memberId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });
    await expectLocked(t, s);
  });

  test("an ordinary group membership does NOT lock contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId: s.groupId,
        userId: s.memberId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: "rafael.ortiz@test.com",
    });
    expect((await readMember(t, s.memberId))?.email).toBe(
      "rafael.ortiz@test.com",
    );
  });

  test("leading an ARCHIVED group does not lock contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.groupId, { isArchived: true });
      await ctx.db.insert("groupMembers", {
        groupId: s.groupId,
        userId: s.memberId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: "rafael.ortiz@test.com",
    });
    expect((await readMember(t, s.memberId))?.email).toBe(
      "rafael.ortiz@test.com",
    );
  });

  test("a channel moderator role locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const channelId = await ctx.db.insert("chatChannels", {
        communityId: s.communityId,
        name: "general",
        channelType: "custom",
        createdById: s.adminId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: s.memberId,
        role: "moderator",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });
    await expectLocked(t, s);
  });

  test("a channel OWNER role locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // "owner" is a real fourth role value the schema comment omits; it can
    // delete the channel and remove other admins.
    await t.run(async (ctx) => {
      const channelId = await ctx.db.insert("chatChannels", {
        communityId: s.communityId,
        name: "general",
        channelType: "custom",
        createdById: s.adminId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: s.memberId,
        role: "owner",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });
    await expectLocked(t, s);
  });

  test("ordinary channel membership does NOT lock contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const channelId = await ctx.db.insert("chatChannels", {
        communityId: s.communityId,
        name: "general",
        channelType: "custom",
        createdById: s.adminId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: s.memberId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: "rafael.ortiz@test.com",
    });
    expect((await readMember(t, s.memberId))?.email).toBe(
      "rafael.ortiz@test.com",
    );
  });

  test("an active fund role locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const fundId = await ctx.db.insert("funds", {
        communityId: s.communityId,
        name: "General Fund",
        type: "general",
        status: "active",
        balanceCents: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("fundRoles", {
        fundId,
        userId: s.memberId,
        role: "manager",
        grantedBy: s.adminId,
        grantedAt: Date.now(),
      });
    });
    await expectLocked(t, s);
  });

  test("a REVOKED fund role does not lock contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const fundId = await ctx.db.insert("funds", {
        communityId: s.communityId,
        name: "General Fund",
        type: "general",
        status: "active",
        balanceCents: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("fundRoles", {
        fundId,
        userId: s.memberId,
        role: "manager",
        grantedBy: s.adminId,
        grantedAt: Date.now(),
        revokedAt: Date.now(),
      });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: "rafael.ortiz@test.com",
    });
    expect((await readMember(t, s.memberId))?.email).toBe(
      "rafael.ortiz@test.com",
    );
  });

  test("managing a serving team locks contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const teamId = await ctx.db.insert("teams", {
        groupId: s.groupId,
        communityId: s.communityId,
        name: "Worship",
        createdAt: Date.now(),
        createdById: s.adminId,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("teamManagers", {
        teamId,
        userId: s.memberId,
        communityId: s.communityId,
        addedById: s.adminId,
        addedAt: Date.now(),
      });
      // teamManagers rows are never cleaned up on exit, so the row alone must
      // not count — active group membership is what makes it real.
      await ctx.db.insert("groupMembers", {
        groupId: s.groupId,
        userId: s.memberId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });
    await expectLocked(t, s);
  });

  test("a stale team-manager row for a group the member left does not lock contact details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const teamId = await ctx.db.insert("teams", {
        groupId: s.groupId,
        communityId: s.communityId,
        name: "Worship",
        createdAt: Date.now(),
        createdById: s.adminId,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("teamManagers", {
        teamId,
        userId: s.memberId,
        communityId: s.communityId,
        addedById: s.adminId,
        addedAt: Date.now(),
      });
      // No groupMembers row at all — they left the group.
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      email: "rafael.ortiz@test.com",
    });
    expect((await readMember(t, s.memberId))?.email).toBe(
      "rafael.ortiz@test.com",
    );
  });

  test("an UNCLAIMED placeholder that already carries a role is still locked", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // A placeholder's _id is stable, so roleAssignments / groupMembers /
    // userCommunities rows can already point at it. Unclaimed-ness must never
    // short-circuit the authority check.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, { isPlaceholder: true });
      await ctx.db.insert("groupMembers", {
        groupId: s.groupId,
        userId: s.memberId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });
    await expectLocked(t, s);
  });
});

// ============================================================================
// Membership status
// ============================================================================

describe("membership status", () => {
  for (const [label, status] of [
    ["left", 2],
    ["blocked", 3],
  ] as const) {
    test(`rejects a member who has ${label}, and the detail query agrees`, async () => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("userCommunities")
          .withIndex("by_user", (q) => q.eq("userId", s.memberId))
          .first();
        await ctx.db.patch(membership!._id, { status });
      });

      await expect(
        t.mutation(api.functions.admin.members.updateMemberProfile, {
          token: s.adminToken,
          communityId: s.communityId,
          targetUserId: s.memberId,
          firstName: "Rafael",
        }),
      ).rejects.toThrow(/not an active member/i);

      // The query must report editability the same way the mutation enforces
      // it, or the UI offers a button that always fails.
      const detail = await t.query(
        api.functions.admin.members.getCommunityMemberById,
        {
          token: s.adminToken,
          communityId: s.communityId,
          targetUserId: s.memberId,
        },
      );
      expect(detail?.canEditProfile).toBe(false);
    });
  }
});

// ============================================================================
// Legacy values, validation and uniqueness
// ============================================================================

describe("legacy values, validation and uniqueness", () => {
  test("resubmitting a legacy-formatted phone or email is not a contact change", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.memberId, {
        phone: "(202) 555-9999",
        email: "Rafael@Test.com",
        phoneVerified: true, // claimed, so contact edits are locked
      });
    });

    // Canonically identical values, differently formatted. These must not
    // register as a change, so the name edit alongside them succeeds…
    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
      phone: "+12025559999",
      email: "rafael@test.com",
    });

    const user = await readMember(t, s.memberId);
    expect(user?.firstName).toBe("Rafael");
    // …and the stored values are left exactly as they were.
    expect(user?.phone).toBe("(202) 555-9999");
    expect(user?.email).toBe("Rafael@Test.com");

    const audits = await listAudits(t, s);
    expect(audits.page[0].changes.map((c: any) => c.field)).toEqual([
      "firstName",
    ]);
  });

  test("legacy contact values that fail today's validation still allow other edits", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      // A seven-digit phone and an address with no public TLD: both rejected
      // by today's rules. Comparing before validating is what keeps an
      // unrelated name edit from going down with them.
      await ctx.db.patch(s.memberId, {
        phone: "5550123",
        email: "rafael@localhost",
      });
    });

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
      phone: "5550123",
      email: "rafael@localhost",
    });

    expect((await readMember(t, s.memberId))?.firstName).toBe("Rafael");
  });

  test("rejects an invalid new phone number", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        phone: "12345",
      }),
    ).rejects.toThrow(/valid phone number/i);
  });

  test("rejects an invalid new email address", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        email: "not-an-email",
      }),
    ).rejects.toThrow(/valid email address/i);
  });

  test("refuses a phone already used by another account", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        phone: "+12025551001", // the admin's number
      }),
    ).rejects.toThrow(/already uses this phone/i);
  });

  test("refuses an email already used by another account, ignoring case", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        email: "ADMIN@test.com",
      }),
    ).rejects.toThrow(/already uses this email/i);
  });

  test("rejects a reason longer than 500 characters", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        firstName: "Rafael",
        reason: "x".repeat(501),
      }),
    ).rejects.toThrow(/500 characters/i);
  });
});

// ============================================================================
// Authorization of the ACTOR
// ============================================================================

describe("actor authorization", () => {
  test("a non-admin member cannot edit anyone's profile", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const memberTokens = await generateTokens(s.memberId, s.communityId);

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: memberTokens.accessToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        firstName: "Rafael",
      }),
    ).rejects.toThrow();
  });

  test("a regular admin cannot edit a fellow admin's record", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const regularAdminToken = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Second",
        lastName: "Admin",
        email: "second@test.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId: id,
        communityId: s.communityId,
        roles: COMMUNITY_ROLES.ADMIN,
        status: 1,
        createdAt: Date.now(),
      });
      return id;
    });
    const tokens = await generateTokens(regularAdminToken, s.communityId);

    // Promote the target to admin.
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user", (q) => q.eq("userId", s.memberId))
        .first();
      await ctx.db.patch(membership!._id, { roles: COMMUNITY_ROLES.ADMIN });
    });

    await expect(
      t.mutation(api.functions.admin.members.updateMemberProfile, {
        token: tokens.accessToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        firstName: "Rafael",
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Audit trail
// ============================================================================

describe("listMemberProfileAudits", () => {
  test("returns entries newest first and paginates the whole trail", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const names = ["Rafael", "Raphael", "Rafaél", "Rafa"];
    for (const name of names) {
      await editProfile(t, {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        firstName: name,
      });
    }

    const firstPage = await t.query(
      api.functions.admin.members.listMemberProfileAudits,
      {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        paginationOpts: { numItems: 2, cursor: null },
      },
    );

    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
    // Newest first.
    expect(firstPage.page[0].changes[0].newValue).toBe("Rafa");

    const secondPage = await t.query(
      api.functions.admin.members.listMemberProfileAudits,
      {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
      },
    );

    // Every entry stays reachable — no cap makes older rows disappear.
    expect(secondPage.page).toHaveLength(2);
    expect(secondPage.page[1].changes[0].newValue).toBe("Rafael");
  });

  test("a non-admin cannot read the audit trail", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const memberTokens = await generateTokens(s.memberId, s.communityId);

    await expect(
      t.query(api.functions.admin.members.listMemberProfileAudits, {
        token: memberTokens.accessToken,
        communityId: s.communityId,
        targetUserId: s.memberId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  });

  test("audit rows follow the person through a duplicate-account merge", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await editProfile(t, {
      token: s.adminToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      firstName: "Rafael",
    });

    // Simulate the merge re-keying: rows must end up on the surviving primary,
    // otherwise the history query (which filters on the primary's exact
    // targetUserId) can never reach them again.
    const primaryId = await t.run(async (ctx) => {
      const primaryId = await ctx.db.insert("users", {
        firstName: "Rafael",
        lastName: "Ortiz",
        phone: "+12025550123",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId: primaryId,
        communityId: s.communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: Date.now(),
      });
      const audits = await ctx.db
        .query("memberProfileAudits")
        .withIndex("by_target", (q) => q.eq("targetUserId", s.memberId))
        .collect();
      expect(audits).toHaveLength(1);
      for (const audit of audits) {
        await ctx.db.patch(audit._id, { targetUserId: primaryId });
      }
      return primaryId;
    });

    const merged = await t.query(
      api.functions.admin.members.listMemberProfileAudits,
      {
        token: s.adminToken,
        communityId: s.communityId,
        targetUserId: primaryId,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(merged.page).toHaveLength(1);
  });
});
