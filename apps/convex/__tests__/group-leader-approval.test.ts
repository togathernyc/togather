/**
 * Tests for the group-leader join-request approval mode.
 *
 * A group's `joinApprovalMode` controls who reviews its join requests:
 *   - "admins" (default): community admins, via the admin dashboard.
 *   - "leaders": the group's leaders, via the group-page Requests screen.
 *
 * These tests lock down the authorization boundary (leaders can only review
 * when the group opts in) and the "full handoff" behavior (leaders-mode
 * requests leave the admin dashboard).
 */
import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

// Mock the jose library to bypass JWT verification in tests.
// vi.mock is hoisted to the top of the file by Vitest.
vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) {
      throw new Error("Invalid token");
    }
    return { payload: { userId: match[1], type: "access" } };
  }),
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-signed-token"),
  })),
  decodeJwt: vi.fn((token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) return null;
    return { userId: match[1], type: "access" };
  }),
}));

import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

interface Setup {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  requesterId: Id<"users">;
  adminId: Id<"users">;
  leaderToken: string;
  memberToken: string;
  adminToken: string;
}

async function setupData(t: ReturnType<typeof convexTest>): Promise<Setup> {
  return await t.run(async (ctx) => {
    const ts = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
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

    const mkUser = async (first: string, phone: string) =>
      ctx.db.insert("users", {
        firstName: first,
        lastName: "User",
        email: `${first.toLowerCase()}@test.com`,
        phone,
        phoneVerified: true,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      });

    const leaderId = await mkUser("Leader", "+12025551001");
    const memberId = await mkUser("Member", "+12025551002");
    const requesterId = await mkUser("Requester", "+12025551003");
    const adminId = await mkUser("Admin", "+12025551004");

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      isArchived: false,
      isPublic: false,
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: ts,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberId,
      role: "member",
      joinedAt: ts,
      notificationsEnabled: true,
    });

    // Community admin (roles >= 3).
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: 3,
      status: 1,
      createdAt: ts,
      updatedAt: ts,
    });

    return {
      communityId,
      groupTypeId,
      groupId,
      leaderId,
      memberId,
      requesterId,
      adminId,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
      adminToken: `test-token-${adminId}`,
    };
  });
}

async function createPendingRequest(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  userId: Id<"users">,
): Promise<Id<"groupMembers">> {
  return await t.run(async (ctx) => {
    const ts = Date.now();
    return ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role: "member",
      joinedAt: ts,
      leftAt: ts,
      notificationsEnabled: true,
      requestStatus: "pending",
      requestedAt: ts,
    });
  });
}

async function setMode(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  mode: "admins" | "leaders",
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(groupId, { joinApprovalMode: mode });
  });
}

describe("Group leader approval — authorization", () => {
  test("leader CANNOT review when mode is admins (default)", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);
    const membershipId = await createPendingRequest(t, setup.groupId, setup.requesterId);

    await expect(
      t.mutation(api.functions.groupMembers.reviewGroupJoinRequest, {
        token: setup.leaderToken,
        groupId: setup.groupId,
        membershipId,
        action: "accept",
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  test("leader CAN approve when mode is leaders", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);
    await setMode(t, setup.groupId, "leaders");
    const membershipId = await createPendingRequest(t, setup.groupId, setup.requesterId);

    const result = await t.mutation(
      api.functions.groupMembers.reviewGroupJoinRequest,
      {
        token: setup.leaderToken,
        groupId: setup.groupId,
        membershipId,
        action: "accept",
      },
    );

    expect(result.status).toBe("accepted");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("regular member CANNOT review even when mode is leaders", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);
    await setMode(t, setup.groupId, "leaders");
    const membershipId = await createPendingRequest(t, setup.groupId, setup.requesterId);

    await expect(
      t.mutation(api.functions.groupMembers.reviewGroupJoinRequest, {
        token: setup.memberToken,
        groupId: setup.groupId,
        membershipId,
        action: "accept",
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  test("community admin CAN review via group page regardless of mode", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);
    // default "admins" mode
    const membershipId = await createPendingRequest(t, setup.groupId, setup.requesterId);

    const result = await t.mutation(
      api.functions.groupMembers.reviewGroupJoinRequest,
      {
        token: setup.adminToken,
        groupId: setup.groupId,
        membershipId,
        action: "decline",
      },
    );

    expect(result.status).toBe("declined");
  });
});

describe("Group leader approval — listing visibility", () => {
  test("leader sees pending requests only in leaders mode", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);
    await createPendingRequest(t, setup.groupId, setup.requesterId);

    // admins mode -> leader query returns empty
    const beforeOptIn = await t.query(
      api.functions.groupMembers.listGroupJoinRequests,
      { token: setup.leaderToken, groupId: setup.groupId },
    );
    expect(beforeOptIn).toHaveLength(0);

    await setMode(t, setup.groupId, "leaders");
    const afterOptIn = await t.query(
      api.functions.groupMembers.listGroupJoinRequests,
      { token: setup.leaderToken, groupId: setup.groupId },
    );
    expect(afterOptIn).toHaveLength(1);
    expect(afterOptIn[0].user?.id).toBe(setup.requesterId);
  });

  test("admin dashboard excludes leaders-mode requests (full handoff)", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);
    await createPendingRequest(t, setup.groupId, setup.requesterId);

    // admins mode -> appears in admin dashboard
    const beforeHandoff = await t.query(
      api.functions.admin.index.listPendingRequests,
      { token: setup.adminToken, communityId: setup.communityId },
    );
    expect(beforeHandoff.length).toBe(1);

    // leaders mode -> handed off, drops out of admin dashboard
    await setMode(t, setup.groupId, "leaders");
    const afterHandoff = await t.query(
      api.functions.admin.index.listPendingRequests,
      { token: setup.adminToken, communityId: setup.communityId },
    );
    expect(afterHandoff.length).toBe(0);
  });
});

describe("Group leader approval — setting the mode", () => {
  test("leader CANNOT change the approval mode", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);

    await expect(
      t.mutation(api.functions.groups.index.setJoinApprovalMode, {
        token: setup.leaderToken,
        groupId: setup.groupId,
        mode: "leaders",
      }),
    ).rejects.toThrow(/admin/i);
  });

  test("community admin CAN change the approval mode", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupData(t);

    const result = await t.mutation(
      api.functions.groups.index.setJoinApprovalMode,
      {
        token: setup.adminToken,
        groupId: setup.groupId,
        mode: "leaders",
      },
    );
    expect(result.joinApprovalMode).toBe("leaders");
  });
});
