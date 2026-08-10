/**
 * Slack Service Planning Bot — Native config promotion tests.
 *
 * Proves the native campus-group-name and role→{teamName,roleName} mappings are
 * driven by the `slackBotConfig.nativeConfig` DB section, with the hardcoded
 * `config.ts` constants kept only as the seed defaults + fallback:
 *
 *   • unit: the `configDb` accessors return the DB-configured value when
 *     `nativeConfig` has the mapping, and fall back to the `config.ts`
 *     constants when it is absent / empty / missing the key;
 *   • integration (convex-test): with a `slackBotConfig` row whose
 *     `nativeConfig` maps a location/role to a NON-default campus group / team /
 *     role, the native-first router (`assignPersonToRoleCore`) resolves via the
 *     DB config and lands a native assignment; with NO config row it falls back
 *     to the constants and still lands.
 *
 * Run with: cd apps/convex && pnpm test __tests__/slackServiceBot.nativeConfig.test.ts
 */

import { convexTest } from "convex-test";
import { describe, it, test, expect, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assignPersonToRoleCore } from "../functions/slackServiceBot/pcoSync";
import {
  getNativeCampusGroupNameFromConfig,
  getNativeRoleMappingFromConfig,
} from "../functions/slackServiceBot/configDb";
import {
  NATIVE_CAMPUS_GROUP_NAMES,
  NATIVE_ROLE_MAPPINGS,
} from "../functions/slackServiceBot/config";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const DAY = 24 * 60 * 60 * 1000;

let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

// ============================================================================
// Unit: configDb native accessors (DB-first, constants as fallback)
// ============================================================================

describe("native config accessors", () => {
  const dbNativeConfig = {
    campusGroupNames: { Manhattan: "Downtown Hub", Brooklyn: "Kings Hub" },
    roleMappings: {
      preacher: { teamName: "MainStage", roleName: "Speaker" },
      meetingLead: { teamName: "MainStage", roleName: "Host" },
    },
  };

  test("campus group name: DB config wins when present", () => {
    expect(getNativeCampusGroupNameFromConfig(dbNativeConfig, "Manhattan")).toBe(
      "Downtown Hub",
    );
  });

  test("campus group name: falls back to constant when nativeConfig absent", () => {
    expect(getNativeCampusGroupNameFromConfig(undefined, "Manhattan")).toBe(
      NATIVE_CAMPUS_GROUP_NAMES.Manhattan,
    );
  });

  test("campus group name: falls back to constant when maps empty", () => {
    const empty = { campusGroupNames: {}, roleMappings: {} };
    expect(getNativeCampusGroupNameFromConfig(empty, "Brooklyn")).toBe(
      NATIVE_CAMPUS_GROUP_NAMES.Brooklyn,
    );
  });

  test("campus group name: unknown location returns null", () => {
    expect(getNativeCampusGroupNameFromConfig(dbNativeConfig, "Nowhere")).toBeNull();
  });

  test("role mapping: DB config wins when present", () => {
    expect(getNativeRoleMappingFromConfig(dbNativeConfig, "preacher")).toEqual({
      teamName: "MainStage",
      roleName: "Speaker",
    });
  });

  test("role mapping: falls back to constant when nativeConfig absent", () => {
    expect(getNativeRoleMappingFromConfig(undefined, "preacher")).toEqual(
      NATIVE_ROLE_MAPPINGS.preacher,
    );
  });

  test("role mapping: falls back to constant when key missing from DB config", () => {
    const partial = {
      campusGroupNames: { Manhattan: "Downtown Hub" },
      roleMappings: { preacher: { teamName: "MainStage", roleName: "Speaker" } },
    };
    // "meetingLead" isn't in the DB config → constant.
    expect(getNativeRoleMappingFromConfig(partial, "meetingLead")).toEqual(
      NATIVE_ROLE_MAPPINGS.meetingLead,
    );
  });

  test("role mapping: unknown role returns null", () => {
    expect(getNativeRoleMappingFromConfig(dbNativeConfig, "bogus")).toBeNull();
  });
});

// ============================================================================
// Integration: the native-first router resolves via DB config (convex-test)
// ============================================================================

interface RouterWorld {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  planId: Id<"eventPlans">;
  teamId: Id<"teams">;
  roleId: Id<"teamRoles">;
  tameekaId: Id<"users">;
}

/**
 * Seed a native world with configurable group/team/role names so a test can
 * make the DB `nativeConfig` point at names that DON'T match the hardcoded
 * constants — proving resolution came from the DB config.
 */
async function buildRouterWorld(
  t: ReturnType<typeof convexTest>,
  opts: { groupName: string; teamName: string; roleName: string },
): Promise<RouterWorld> {
  return t.run(async (ctx): Promise<RouterWorld> => {
    const communityId = await ctx.db.insert("communities", {
      name: "FOUNT Test",
      slug: "fount-native-config-test",
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
      name: opts.groupName,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Leona",
      lastName: "Lead",
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const tameekaId = await ctx.db.insert("users", {
      firstName: "Tameeka",
      lastName: "Walker",
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const userId of [leaderId, tameekaId]) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: userId === leaderId ? "leader" : "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    }

    const teamId = await ctx.db.insert("teams", {
      groupId,
      communityId,
      name: opts.teamName,
      isArchived: false,
      createdAt: Date.now(),
      createdById: leaderId,
      updatedAt: Date.now(),
    });
    const roleId = await ctx.db.insert("teamRoles", {
      teamId,
      communityId,
      name: opts.roleName,
      sortOrder: 0,
      createdAt: Date.now(),
      createdById: leaderId,
    });

    const eventDate = Date.now() + DAY;
    const planId = await ctx.db.insert("eventPlans", {
      groupId,
      communityId,
      title: "Sunday Service",
      eventDate,
      times: [{ label: "10 AM", startsAt: eventDate }],
      status: "draft",
      createdAt: Date.now(),
      createdById: leaderId,
      updatedAt: Date.now(),
    });

    return { communityId, groupId, planId, teamId, roleId, tameekaId };
  });
}

/** Insert a slackBotConfig row for a community with the given nativeConfig. */
async function seedBotConfig(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  nativeConfig: {
    campusGroupNames: Record<string, string>;
    roleMappings: Record<string, { teamName: string; roleName: string }>;
  },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("slackBotConfig", {
      communityId,
      enabled: true,
      slackChannelId: "C_TEST",
      botSlackUserId: "U_BOT",
      devMode: true,
      teamMembers: [],
      threadMentions: {},
      nagSchedule: [],
      threadCreation: { dayOfWeek: 2, hourET: 10 },
      servicePlanItems: [],
      servicePlanLabels: {},
      itemResponsibleRoles: {},
      pcoConfig: {
        communityId: communityId as string,
        serviceTypeIds: {},
        roleMappings: {},
      },
      nativeConfig,
      aiConfig: {
        model: "gpt-4o-mini",
        botPersonality: "test",
        responseRules: "test",
        nagToneByLevel: {},
        teamContext: "test",
      },
      processedMessageTs: [],
      nagsSent: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

/** An ActionCtx that forwards runQuery/runMutation to the convex-test handle. */
function fakeActionCtx(t: ReturnType<typeof convexTest>): ActionCtx {
  return {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
  } as unknown as ActionCtx;
}

function setup() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  return t;
}

describe("assignPersonToRoleCore resolves native mappings via DB config", () => {
  it("uses the DB nativeConfig campus group + role mapping (non-default names)", async () => {
    const t = setup();
    // Names deliberately do NOT match the config.ts constants; only the DB
    // config knows how to reach them.
    const world = await buildRouterWorld(t, {
      groupName: "Downtown Hub",
      teamName: "MainStage",
      roleName: "Host",
    });
    await seedBotConfig(t, world.communityId, {
      campusGroupNames: { Manhattan: "Downtown Hub" },
      roleMappings: { meetingLead: { teamName: "MainStage", roleName: "Host" } },
    });

    const result = await assignPersonToRoleCore(
      fakeActionCtx(t),
      "Manhattan",
      "meetingLead",
      "Tameeka Walker",
      {} as any, // pcoConfig unused on the native branch
      world.communityId,
    );

    expect(result.success).toBe(true);
    expect(result.detail.toLowerCase()).toContain("native");

    // The assignment landed on the DB-configured team/role.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan_role", (q) =>
          q.eq("planId", world.planId).eq("roleId", world.roleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(world.tameekaId);
  });

  it("falls back to config.ts constants when no slackBotConfig row exists", async () => {
    const t = setup();
    // Names match the hardcoded constants (Manhattan → group containing
    // "Manhattan", meetingLead → Platform / Meeting Leader). No config row.
    const world = await buildRouterWorld(t, {
      groupName: "Manhattan Campus",
      teamName: "Platform",
      roleName: "Meeting Leader",
    });

    const result = await assignPersonToRoleCore(
      fakeActionCtx(t),
      "Manhattan",
      "meetingLead",
      "Tameeka Walker",
      {} as any,
      world.communityId,
    );

    expect(result.success).toBe(true);
    expect(result.detail.toLowerCase()).toContain("native");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan_role", (q) =>
          q.eq("planId", world.planId).eq("roleId", world.roleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(world.tameekaId);
  });
});
