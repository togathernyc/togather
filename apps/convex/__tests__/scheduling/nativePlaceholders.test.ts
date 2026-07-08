/**
 * Tests for native-first communication-bot placeholder resolution.
 *
 * Communication bots expand `{{Team > Role}}` placeholders into the first names
 * of whoever is scheduled. Resolution is native-first: it reads the app's own
 * rostering (`teams` → `teamRoles` → upcoming `eventPlans` → `roleAssignments`)
 * and only falls back to Planning Center (PCO) when there's no native match.
 *
 * PCO API calls are mocked (as in `pco/filterActions.test.ts`) so the fallback
 * path can be exercised without real credentials.
 */

import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { generateTokens } from "../../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Mock the PCO API so the fallback path is deterministic.
vi.mock("../../lib/pcoServicesApi", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  fetchServiceTypes: vi
    .fn()
    .mockResolvedValue([{ id: "st-1", attributes: { name: "Sunday Service" } }]),
  fetchTeamsForServiceType: vi.fn(),
  fetchUpcomingPlans: vi.fn().mockResolvedValue([]),
  fetchPlanTeamMembers: vi.fn().mockResolvedValue([]),
  getPersonContactInfo: vi.fn(),
}));

import {
  fetchServiceTypes,
  fetchUpcomingPlans,
  fetchPlanTeamMembers,
} from "../../lib/pcoServicesApi";

function ts(offsetDays = 0): number {
  return Date.now() + offsetDays * 24 * 60 * 60 * 1000;
}

interface World {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  teamId: Id<"teams">;
  vocalsRoleId: Id<"teamRoles">;
  planId: Id<"eventPlans">;
  aliceId: Id<"users">;
  bobId: Id<"users">;
  charlieId: Id<"users">;
  adminId: Id<"users">;
}

describe("native-first placeholder resolution", () => {
  let t: ReturnType<typeof convexTest>;
  let world: World;
  let adminToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    (fetchServiceTypes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "st-1", attributes: { name: "Sunday Service" } },
    ]);
    (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    t = convexTest(schema, modules);

    world = await t.run(async (ctx): Promise<World> => {
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
        createdAt: ts(),
        displayOrder: 1,
      });
      const groupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Brooklyn Campus",
        isArchived: false,
        createdAt: ts(),
        updatedAt: ts(),
      });

      const mkUser = async (firstName: string) =>
        ctx.db.insert("users", {
          firstName,
          lastName: "Test",
          email: `${firstName.toLowerCase()}@example.com`,
          isActive: true,
          roles: 1,
          createdAt: ts(),
          updatedAt: ts(),
        });
      const aliceId = await mkUser("Alice");
      const bobId = await mkUser("Bob");
      const charlieId = await mkUser("Charlie");
      const adminId = await mkUser("Adminda");

      await ctx.db.insert("userCommunities", {
        communityId,
        userId: adminId,
        roles: 3,
        status: 1,
        createdAt: ts(),
        updatedAt: ts(),
      });

      const teamId = await ctx.db.insert("teams", {
        groupId,
        communityId,
        name: "Worship",
        isArchived: false,
        createdAt: ts(),
        createdById: adminId,
        updatedAt: ts(),
      });
      const vocalsRoleId = await ctx.db.insert("teamRoles", {
        teamId,
        communityId,
        name: "Vocals",
        sortOrder: 0,
        isArchived: false,
        createdAt: ts(),
        createdById: adminId,
      });

      // A past plan (should be ignored) and an upcoming published plan.
      await ctx.db.insert("eventPlans", {
        groupId,
        communityId,
        title: "Last Sunday",
        eventDate: ts(-7),
        times: [],
        status: "published",
        createdAt: ts(),
        createdById: adminId,
        updatedAt: ts(),
      });
      const planId = await ctx.db.insert("eventPlans", {
        groupId,
        communityId,
        title: "This Sunday",
        eventDate: ts(3),
        times: [],
        status: "published",
        createdAt: ts(),
        createdById: adminId,
        updatedAt: ts(),
      });

      // Assign: Alice confirmed, Bob unconfirmed, Charlie declined.
      for (const [userId, status] of [
        [aliceId, "confirmed"],
        [bobId, "unconfirmed"],
        [charlieId, "declined"],
      ] as const) {
        await ctx.db.insert("roleAssignments", {
          planId,
          teamId,
          roleId: vocalsRoleId,
          userId,
          eventDate: ts(3),
          status,
          assignedById: adminId,
          assignedAt: ts(),
        });
      }

      return {
        communityId,
        groupId,
        teamId,
        vocalsRoleId,
        planId,
        aliceId,
        bobId,
        charlieId,
        adminId,
      };
    });

    const tokens = await generateTokens(world.adminId as string);
    adminToken = tokens.accessToken;
  });

  it("resolves a native placeholder to scheduled users' first names (confirmed + unconfirmed, declined excluded)", async () => {
    const result = await t.action(
      internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        message: "Hey {{Worship > Vocals}}, you're on this Sunday!",
      },
    );
    // Alice (confirmed) + Bob (unconfirmed); Charlie (declined) excluded.
    expect(result).toBe("Hey Alice and Bob, you're on this Sunday!");
    // Native match — PCO must NOT be consulted.
    expect(fetchServiceTypes).not.toHaveBeenCalled();
  });

  it("is case-insensitive on team and role names", async () => {
    const result = await t.action(
      internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        message: "{{worship > VOCALS}}",
      },
    );
    expect(result).toBe("Alice and Bob");
  });

  it("renders [TBD] when the team/role match but nobody is scheduled", async () => {
    // A native role with no assignments still counts as a native match, so it
    // renders like the PCO 'no data' case and never falls back to PCO.
    await t.run(async (ctx) => {
      await ctx.db.insert("teamRoles", {
        teamId: world.teamId,
        communityId: world.communityId,
        name: "Drums",
        sortOrder: 1,
        isArchived: false,
        createdAt: ts(),
        createdById: world.adminId,
      });
    });
    const result = await t.action(
      internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        message: "Drummer: {{Worship > Drums}}",
      },
    );
    expect(result).toBe("Drummer: [TBD]");
    expect(fetchServiceTypes).not.toHaveBeenCalled();
  });

  it("also accepts the legacy 3-part placeholder using its last two segments", async () => {
    const result = await t.action(
      internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        message: "{{Sunday Service > Worship > Vocals}}",
      },
    );
    expect(result).toBe("Alice and Bob");
    expect(fetchServiceTypes).not.toHaveBeenCalled();
  });

  it("native resolver returns matched:false when no team/role matches (so PCO fallback triggers)", async () => {
    const results = await t.query(
      internal.functions.scheduling.nativePlaceholders.resolveNativePlaceholders,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        placeholders: [
          { fullMatch: "{{Band > Drums}}", teamName: "Band", roleName: "Drums" },
          {
            fullMatch: "{{Worship > Vocals}}",
            teamName: "Worship",
            roleName: "Vocals",
          },
        ],
      },
    );
    const byMatch = new Map(results.map((r) => [r.fullMatch, r]));
    expect(byMatch.get("{{Band > Drums}}")?.matched).toBe(false);
    expect(byMatch.get("{{Worship > Vocals}}")?.matched).toBe(true);
    expect(byMatch.get("{{Worship > Vocals}}")?.names).toEqual([
      "Alice",
      "Bob",
    ]);
  });

  it("falls back to PCO for a 3-part placeholder with no native match", async () => {
    (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "plan-1", attributes: { sort_date: "2026-02-01" } },
    ]);
    (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        name: "Dave Grohl",
        status: "C",
        position: "Drums",
        pcoPersonId: "p1",
        teamId: "t1",
        teamName: "Band",
      },
    ]);

    const result = await t.action(
      internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        // "Band" is not a native team → native misses → PCO resolves it.
        message: "{{Sunday Service > Band > Drums}}",
      },
    );
    expect(result).toBe("Dave");
    expect(fetchServiceTypes).toHaveBeenCalled();
  });

  it("resolves native and PCO placeholders together in one message", async () => {
    (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "plan-1", attributes: { sort_date: "2026-02-01" } },
    ]);
    (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        name: "Dave Grohl",
        status: "C",
        position: "Drums",
        pcoPersonId: "p1",
        teamId: "t1",
        teamName: "Band",
      },
    ]);

    const result = await t.action(
      internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        message:
          "Vocals: {{Worship > Vocals}} / Drums: {{Sunday Service > Band > Drums}}",
      },
    );
    expect(result).toBe("Vocals: Alice and Bob / Drums: Dave");
  });

  it("leaves a 2-part placeholder untouched when it matches neither native nor PCO", async () => {
    const result = await t.action(
      internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
      {
        communityId: world.communityId,
        groupId: world.groupId,
        // 2-part, no native match, and no serviceType so PCO can't help.
        message: "{{Nonexistent > Role}}",
      },
    );
    expect(result).toBe("{{Nonexistent > Role}}");
    expect(fetchServiceTypes).not.toHaveBeenCalled();
  });

  it("getNativePositions lists community teams x roles as Team > Role suggestions", async () => {
    const positions = await t.query(
      api.functions.scheduling.nativePlaceholders.getNativePositions,
      { token: adminToken, communityId: world.communityId },
    );
    expect(positions).toEqual([
      { teamName: "Worship", roleName: "Vocals", displayName: "Worship > Vocals" },
    ]);
  });
});
