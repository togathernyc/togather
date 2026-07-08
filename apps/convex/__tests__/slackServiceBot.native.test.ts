/**
 * Slack Service Planning Bot — Native-first rostering tests.
 *
 * Proves the native-first path added in the PCO → native migration:
 *   • the native context reader returns roster + run-sheet items sourced from
 *     the native tables (`roleAssignments`, `teams`, `teamRoles`, `eventItems`),
 *     shaped like the PCO context the prompt logic consumes;
 *   • native writes land real rows — an assignment writes `roleAssignments`, a
 *     setlist sync writes `eventItems` song rows, an item update patches an
 *     `eventItem`;
 *   • when there is NO upcoming native plan the reader returns null and the
 *     write mutations return `handled: false` — the signal for the bot to fall
 *     back to the PCO path;
 *   • the `assignPersonToRoleCore` router takes the native branch (no PCO HTTP)
 *     when an upcoming native plan exists.
 *
 * These exercise the internal Convex functions directly (no external HTTP), so
 * the PCO fallback is never actually hit — we only assert the "no native plan"
 * signal that triggers it.
 *
 * Run with: cd apps/convex && pnpm test __tests__/slackServiceBot.native.test.ts
 */

import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assignPersonToRoleCore } from "../functions/slackServiceBot/pcoSync";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const DAY = 24 * 60 * 60 * 1000;

let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

interface NativeWorld {
  communityId: Id<"communities">;
  mhGroupId: Id<"groups">;
  bkGroupId: Id<"groups">;
  leaderId: Id<"users">;
  preacherUserId: Id<"users">;
  mlUserId: Id<"users">;
  teamId: Id<"teams">;
  preacherRoleId: Id<"teamRoles">;
  mlRoleId: Id<"teamRoles">;
  planId: Id<"eventPlans">;
  messageItemId: Id<"eventItems">;
}

/**
 * Seed a native world: a community with a Manhattan campus group that has an
 * upcoming plan, a channel-less "Platform" team with "Preacher" / "Meeting
 * Leader" roles, a couple of members, one existing assignment, and two run-sheet
 * items. Also a Brooklyn campus group with NO plan (the fallback case).
 */
async function buildNativeWorld(
  t: ReturnType<typeof convexTest>,
): Promise<NativeWorld> {
  return t.run(async (ctx): Promise<NativeWorld> => {
    const communityId = await ctx.db.insert("communities", {
      name: "FOUNT Test",
      slug: "fount-test",
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
    const mhGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Manhattan Campus",
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const bkGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Brooklyn Campus",
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const mkUser = async (firstName: string, lastName: string) =>
      ctx.db.insert("users", {
        firstName,
        lastName,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    const leaderId = await mkUser("Leona", "Lead");
    const preacherUserId = await mkUser("Kevin", "Myers");
    const mlUserId = await mkUser("Tameeka", "Walker");

    // Active group memberships — assignees must be active campus-group members.
    for (const userId of [leaderId, preacherUserId, mlUserId]) {
      await ctx.db.insert("groupMembers", {
        groupId: mhGroupId,
        userId,
        role: userId === leaderId ? "leader" : "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    }

    // Channel-less "Platform" serving team (reconcile is a safe no-op).
    const teamId = await ctx.db.insert("teams", {
      groupId: mhGroupId,
      communityId,
      name: "Platform",
      isArchived: false,
      createdAt: Date.now(),
      createdById: leaderId,
      updatedAt: Date.now(),
    });
    const preacherRoleId = await ctx.db.insert("teamRoles", {
      teamId,
      communityId,
      name: "Preacher",
      sortOrder: 0,
      createdAt: Date.now(),
      createdById: leaderId,
    });
    const mlRoleId = await ctx.db.insert("teamRoles", {
      teamId,
      communityId,
      name: "Meeting Leader",
      sortOrder: 1,
      createdAt: Date.now(),
      createdById: leaderId,
    });

    // Upcoming plan (tomorrow), draft.
    const eventDate = Date.now() + DAY;
    const planId = await ctx.db.insert("eventPlans", {
      groupId: mhGroupId,
      communityId,
      title: "Sunday Service",
      eventDate,
      times: [{ label: "10 AM", startsAt: eventDate }],
      status: "draft",
      createdAt: Date.now(),
      createdById: leaderId,
      updatedAt: Date.now(),
    });

    // Existing confirmed assignment: Kevin as Preacher.
    await ctx.db.insert("roleAssignments", {
      planId,
      teamId,
      roleId: preacherRoleId,
      userId: preacherUserId,
      eventDate,
      status: "confirmed",
      assignedById: leaderId,
      assignedAt: Date.now(),
    });

    // Run-sheet items: a Message item and an Announcements item.
    const messageItemId = await ctx.db.insert("eventItems", {
      planId,
      communityId,
      segment: "during",
      sequence: 0,
      type: "item",
      title: "Message",
      durationSec: 1800,
      createdAt: Date.now(),
      createdById: leaderId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("eventItems", {
      planId,
      communityId,
      segment: "during",
      sequence: 1,
      type: "item",
      title: "Announcements",
      description: "GIVING\nText to give to 555-1234",
      durationSec: 120,
      createdAt: Date.now(),
      createdById: leaderId,
      updatedAt: Date.now(),
    });

    return {
      communityId,
      mhGroupId,
      bkGroupId,
      leaderId,
      preacherUserId,
      mlUserId,
      teamId,
      preacherRoleId,
      mlRoleId,
      planId,
      messageItemId,
    };
  });
}

function setup() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  return t;
}

describe("native context reader (getNativeContext)", () => {
  it("returns roster + items from the native tables", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);

    const ctx = await t.query(
      internal.functions.slackServiceBot.nativeSync.getNativeContext,
      { communityId: world.communityId, campusGroupName: "Manhattan" },
    );

    expect(ctx).not.toBeNull();
    // Confirmed preacher surfaces in platformRolesAll keyed by role name.
    expect(ctx!.platformRolesAll["Preacher"]).toEqual({
      name: "Kevin Myers",
      status: "C",
    });
    expect(ctx!.platformRoles["Preacher"]).toBe("Kevin Myers");
    // teamMembers carries the native assignment.
    const kevin = ctx!.teamMembers.find((m) => m.name === "Kevin Myers");
    expect(kevin?.position).toBe("Preacher");
    expect(kevin?.teamName).toBe("Platform");
    expect(kevin?.status).toBe("C");
    // Run-sheet items are present.
    expect(ctx!.items.map((i) => i.title)).toContain("Message");
    expect(ctx!.items.map((i) => i.title)).toContain("Announcements");
  });

  it("returns null when the campus group has no upcoming plan (PCO fallback)", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);

    // Brooklyn campus exists but has no plan → no native plan → fall back.
    const ctx = await t.query(
      internal.functions.slackServiceBot.nativeSync.getNativeContext,
      { communityId: world.communityId, campusGroupName: "Brooklyn" },
    );
    expect(ctx).toBeNull();
  });
});

describe("native assign (nativeAssignRole)", () => {
  it("writes a roleAssignment row", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);

    const result = await t.mutation(
      internal.functions.slackServiceBot.nativeSync.nativeAssignRole,
      {
        communityId: world.communityId,
        campusGroupName: "Manhattan",
        teamName: "Platform",
        roleName: "Meeting Leader",
        personName: "Tameeka Walker",
      },
    );
    expect(result).toMatchObject({ handled: true, success: true });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan_role", (q) =>
          q.eq("planId", world.planId).eq("roleId", world.mlRoleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(world.mlUserId);
    expect(rows[0].status).toBe("unconfirmed");
  });

  it("is idempotent for an already-assigned person", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);
    // Kevin is already the Preacher (seeded).
    const result = await t.mutation(
      internal.functions.slackServiceBot.nativeSync.nativeAssignRole,
      {
        communityId: world.communityId,
        campusGroupName: "Manhattan",
        teamName: "Platform",
        roleName: "Preacher",
        personName: "Kevin Myers",
      },
    );
    expect(result).toMatchObject({ handled: true, success: true });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan_role", (q) =>
          q.eq("planId", world.planId).eq("roleId", world.preacherRoleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1); // no duplicate
  });

  it("returns handled:false when there is no upcoming native plan", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);
    // Brooklyn campus has no plan → not handled → PCO fallback.
    const result = await t.mutation(
      internal.functions.slackServiceBot.nativeSync.nativeAssignRole,
      {
        communityId: world.communityId,
        campusGroupName: "Brooklyn",
        teamName: "Platform",
        roleName: "Preacher",
        personName: "Kevin Myers",
      },
    );
    expect(result.handled).toBe(false);
  });
});

describe("native setlist + item writes", () => {
  it("nativeSyncSetlist writes song eventItems (dedup on re-sync)", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);

    const first = await t.mutation(
      internal.functions.slackServiceBot.nativeSync.nativeSyncSetlist,
      {
        communityId: world.communityId,
        campusGroupName: "Manhattan",
        songs: ["Great Are You Lord", "Build My Life"],
      },
    );
    expect(first).toMatchObject({ handled: true, success: true, songsAdded: 2 });

    const songs = await t.run((ctx) =>
      ctx.db
        .query("eventItems")
        .withIndex("by_plan", (q) => q.eq("planId", world.planId))
        .collect(),
    ).then((items) => items.filter((i) => i.type === "song"));
    expect(songs.map((s) => s.title).sort()).toEqual([
      "Build My Life",
      "Great Are You Lord",
    ]);

    // Re-sync with an overlapping title → only the new one is added.
    const second = await t.mutation(
      internal.functions.slackServiceBot.nativeSync.nativeSyncSetlist,
      {
        communityId: world.communityId,
        campusGroupName: "Manhattan",
        songs: ["Build My Life", "Goodness of God"],
      },
    );
    expect(second).toMatchObject({ handled: true, songsAdded: 1 });
  });

  it("nativeUpdateItem patches an item description", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);

    const result = await t.mutation(
      internal.functions.slackServiceBot.nativeSync.nativeUpdateItem,
      {
        communityId: world.communityId,
        campusGroupName: "Manhattan",
        titlePattern: "message|preach|sermon",
        field: "description",
        content: "Hope For The Battle — Matthew 1:18-25",
      },
    );
    expect(result).toMatchObject({ handled: true, success: true });

    const item = await t.run((ctx) => ctx.db.get(world.messageItemId));
    expect(item?.description).toBe("Hope For The Battle — Matthew 1:18-25");
  });

  it("nativeUpdateItem preserves a named section (GIVING) on announcements", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);

    await t.mutation(
      internal.functions.slackServiceBot.nativeSync.nativeUpdateItem,
      {
        communityId: world.communityId,
        campusGroupName: "Manhattan",
        titlePattern: "announcement",
        field: "description",
        content: "Baptism class Sunday",
        preserveSections: ["GIVING"],
      },
    );

    const items = await t.run((ctx) =>
      ctx.db
        .query("eventItems")
        .withIndex("by_plan", (q) => q.eq("planId", world.planId))
        .collect(),
    );
    const announcements = items.find((i) => i.title === "Announcements");
    expect(announcements?.description).toContain("Baptism class Sunday");
    expect(announcements?.description).toContain("GIVING");
  });
});

describe("assignPersonToRoleCore router (native-first)", () => {
  it("takes the native branch when an upcoming native plan exists", async () => {
    const t = setup();
    const world = await buildNativeWorld(t);

    // A fake ActionCtx that forwards to the convex-test handle. The native
    // branch never touches PCO HTTP, so no stubbing is required.
    const fakeCtx = {
      runQuery: (ref: any, args: any) => t.query(ref, args),
      runMutation: (ref: any, args: any) => t.mutation(ref, args),
    } as unknown as ActionCtx;

    const result = await assignPersonToRoleCore(
      fakeCtx,
      "Manhattan",
      "meetingLead",
      "Tameeka Walker",
      // pcoConfig is unused on the native branch.
      {} as any,
      world.communityId,
    );

    expect(result.success).toBe(true);
    expect(result.detail.toLowerCase()).toContain("native");

    // The assignment landed natively.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan_role", (q) =>
          q.eq("planId", world.planId).eq("roleId", world.mlRoleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });
});
