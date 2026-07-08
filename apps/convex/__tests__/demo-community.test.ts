/**
 * Demo Community Tests
 *
 * Covers the self-serve demo flow (functions/demo.ts): questionnaire-driven
 * provisioning, seeded content scaling, admin roles, multi-person join by
 * demo code, and exclusion of demos from community search.
 *
 * Run with: cd apps/convex && pnpm test __tests__/demo-community.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

async function createUser(
  t: ReturnType<typeof convexTest>,
  firstName: string,
  phone: string,
): Promise<{ userId: Id<"users">; token: string }> {
  const timestamp = Date.now();
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName,
      lastName: "Tester",
      phone,
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  const { accessToken } = await generateTokens(userId);
  return { userId, token: accessToken };
}

describe("createDemoCommunity", () => {
  test("provisions a branded demo community with the caller as primary admin", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "Pat", "+15555550100");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Grace Fellowship",
      totalSize: 300,
      campusCount: 1,
      smallGroupCount: 3,
      zipCode: "11201",
      primaryColor: "#AA3366",
    });

    expect(result.name).toBe("Grace Fellowship");
    expect(result.demoCode).toBe("demo-grace-fellowship");
    expect(result.primaryColor).toBe("#AA3366");

    const community = await t.run(async (ctx) => ctx.db.get(result.communityId));
    expect(community?.isDemo).toBe(true);
    expect(community?.isPublic).toBe(false);
    expect(community?.zipCode).toBe("11201");
    expect(community?.primaryColor).toBe("#AA3366");
    // All features on so the whole product is explorable.
    expect(community?.churchFeatures).toEqual({
      prayerEnabled: true,
      eventTasksEnabled: true,
    });

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", result.communityId),
        )
        .first(),
    );
    expect(membership?.roles).toBe(COMMUNITY_ROLES.PRIMARY_ADMIN);
    expect(membership?.status).toBe(1);

    const caller = await t.run(async (ctx) => ctx.db.get(userId));
    expect(caller?.activeCommunityId).toBe(result.communityId);
  });

  test("seeds exactly 100 placeholder demo members", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Seed", "+15555550111");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Century Chapel",
    });

    const { placeholders, real } = await t.run(async (ctx) => {
      const memberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      let placeholders = 0;
      let real = 0;
      for (const m of memberships) {
        const user = await ctx.db.get(m.userId);
        if (user?.isPlaceholder) placeholders++;
        else real++;
      }
      return { placeholders, real };
    });
    expect(placeholders).toBe(100);
    expect(real).toBe(1); // just the creator
  });

  test("seeds groups scaled to the questionnaire, with conversations, events, RSVPs, and prayers", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "Sam", "+15555550101");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Hope Chapel",
      totalSize: 800,
      campusCount: 3,
      smallGroupCount: 2,
    });

    const { groups, groupTypes, meetings, rsvps, prayers, messages } = await t.run(
      async (ctx) => {
        const groups = await ctx.db
          .query("groups")
          .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
          .collect();
        const groupTypes = await ctx.db
          .query("groupTypes")
          .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
          .collect();
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
          .collect();
        const allRsvps = [];
        for (const meeting of meetings) {
          const rows = await ctx.db
            .query("meetingRsvps")
            .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
            .collect();
          allRsvps.push(...rows);
        }
        const prayers = await ctx.db
          .query("prayers")
          .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
          .collect();
        const channels = [];
        for (const group of groups) {
          const rows = await ctx.db
            .query("chatChannels")
            .withIndex("by_group", (q) => q.eq("groupId", group._id))
            .collect();
          channels.push(...rows);
        }
        const messages = [];
        for (const channel of channels) {
          const rows = await ctx.db
            .query("chatMessages")
            .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
            .collect();
          messages.push(...rows);
        }
        return { groups, groupTypes, meetings, rsvps: allRsvps, prayers, messages };
      },
    );

    // Multi-campus (3 campuses): 2 small groups + 3 centralized teams + 1 class
    // + 3 campuses + 1 announcement group.
    const typeById = new Map(groupTypes.map((gt) => [gt._id, gt.slug]));
    const bySlug = (slug: string) =>
      groups.filter((g) => typeById.get(g.groupTypeId!) === slug);
    expect(bySlug("small-groups")).toHaveLength(2);
    expect(bySlug("campuses")).toHaveLength(3);
    expect(bySlug("teams")).toHaveLength(3);
    expect(bySlug("classes")).toHaveLength(1);
    expect(groups.filter((g) => g.isAnnouncementGroup)).toHaveLength(1);

    // Every non-announcement group has a scheduled meeting; small groups also
    // get the community-wide "Serve Day" child event.
    expect(meetings.length).toBeGreaterThanOrEqual(groups.length - 1);
    const serveDayChildren = meetings.filter((m) => m.communityWideEventId);
    expect(serveDayChildren).toHaveLength(2);
    expect(rsvps.length).toBeGreaterThan(0);

    // Prayer feed is populated with approved prayers.
    expect(prayers.length).toBeGreaterThanOrEqual(3);
    expect(prayers.every((p) => p.moderationStatus === "approved")).toBe(true);

    // Channels carry seeded conversations attributed to placeholder members.
    expect(messages.length).toBeGreaterThan(0);
    const senderIds = new Set(messages.map((m) => m.senderId));
    expect(senderIds.size).toBeGreaterThan(1);

    // The creator is enrolled in a REALISTIC curated subset (never every
    // group): the announcement group as leader + ≤2 campuses + ≤2 small groups
    // + ≤2 teams. Classes and extra groups are not joined.
    const creatorMemberships = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const out: Array<{ role: string; slug?: string; isAnnouncement: boolean }> = [];
      for (const row of rows) {
        const group = await ctx.db.get(row.groupId);
        if (group?.communityId !== result.communityId) continue;
        const type = group.groupTypeId ? await ctx.db.get(group.groupTypeId) : null;
        out.push({
          role: row.role,
          slug: type?.slug,
          isAnnouncement: !!group.isAnnouncementGroup,
        });
      }
      return out;
    });
    // Multi-campus (3 campuses, 2 small groups, 2 teams available): capped at 7.
    expect(creatorMemberships.length).toBeLessThan(groups.length);
    expect(creatorMemberships).toHaveLength(7);
    expect(
      creatorMemberships.filter((m) => m.isAnnouncement && m.role === "leader"),
    ).toHaveLength(1);
    expect(
      creatorMemberships.filter((m) => m.slug === "campuses").length,
    ).toBeLessThanOrEqual(2);
    expect(
      creatorMemberships.filter((m) => m.slug === "small-groups").length,
    ).toBeLessThanOrEqual(2);
    expect(
      creatorMemberships.filter((m) => m.slug === "teams").length,
    ).toBeLessThanOrEqual(2);
    // No class/extra groups pulled in.
    expect(creatorMemberships.some((m) => m.slug === "classes")).toBe(false);
  });

  test("caps seeded volume for oversized questionnaire answers", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Max", "+15555550102");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Mega Church",
      totalSize: 20000,
      campusCount: 40,
      smallGroupCount: 500,
    });

    const { groups, groupTypes } = await t.run(async (ctx) => ({
      groups: await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect(),
      groupTypes: await ctx.db
        .query("groupTypes")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect(),
    }));
    const typeById = new Map(groupTypes.map((gt) => [gt._id, gt.slug]));
    expect(
      groups.filter((g) => typeById.get(g.groupTypeId!) === "small-groups"),
    ).toHaveLength(12);
    expect(
      groups.filter((g) => typeById.get(g.groupTypeId!) === "campuses"),
    ).toHaveLength(12);
  });

  test("generates unique demo codes for same-named churches", async () => {
    const t = convexTest(schema, modules);
    const { token: tokenA } = await createUser(t, "Ann", "+15555550103");
    const { token: tokenB } = await createUser(t, "Ben", "+15555550104");

    const first = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: tokenA,
      name: "First Baptist",
    });
    const second = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: tokenB,
      name: "First Baptist",
    });

    expect(first.demoCode).toBe("demo-first-baptist");
    expect(second.demoCode).not.toBe(first.demoCode);
    expect(second.demoCode.startsWith("demo-first-baptist-")).toBe(true);
  });

  test("rejects blank names and invalid colors", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Val", "+15555550105");

    await expect(
      t.mutation(api.functions.demo.createDemoCommunity, { token, name: "   " }),
    ).rejects.toThrow("Church name is required");

    await expect(
      t.mutation(api.functions.demo.createDemoCommunity, {
        token,
        name: "Color Church",
        primaryColor: "blue",
      }),
    ).rejects.toThrow("hex color");
  });
});

describe("demo v3: feedback fixes", () => {
  test("creates one group per campus and honors custom names", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Campy", "+15555550170");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Eight Campus Church",
      campusCount: 8,
      smallGroupCount: 2,
      campusNames: ["Harlem", "Bed-Stuy"],
      groupNames: ["Tuesday Crew"],
    });

    const { groups, groupTypes } = await t.run(async (ctx) => ({
      groups: await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect(),
      groupTypes: await ctx.db
        .query("groupTypes")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect(),
    }));
    const typeById = new Map(groupTypes.map((gt) => [gt._id, gt.slug]));
    const campuses = groups.filter((g) => typeById.get(g.groupTypeId!) === "campuses");
    expect(campuses).toHaveLength(8);
    // Custom names first, placeholders fill the rest.
    const campusNames = campuses.map((g) => g.name);
    expect(campusNames).toContain("Harlem");
    expect(campusNames).toContain("Bed-Stuy");
    const smallGroupsNames = groups
      .filter((g) => typeById.get(g.groupTypeId!) === "small-groups")
      .map((g) => g.name);
    expect(smallGroupsNames).toContain("Tuesday Crew");

    // Group type names are singular.
    const typeNames = new Map(groupTypes.map((gt) => [gt.slug, gt.name]));
    expect(typeNames.get("small-groups")).toBe("Small Group");
    expect(typeNames.get("campuses")).toBe("Campus");
    expect(typeNames.get("teams")).toBe("Team");
  });

  test("seeded members, groups, and events all have imagery; locations spread from base coords", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Pic", "+15555550171");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Photo Church",
      smallGroupCount: 2,
      zipCode: "11201",
      logo: "r2:uploads/logo.png",
      baseCoordinates: { latitude: 40.69, longitude: -73.99 },
    });

    const { seededUsers, groups, meetings } = await t.run(async (ctx) => {
      const memberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const seededUsers = [];
      for (const m of memberships) {
        const user = await ctx.db.get(m.userId);
        if (user?.isDemoSeed) seededUsers.push(user);
      }
      return {
        seededUsers,
        groups: await ctx.db
          .query("groups")
          .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
          .collect(),
        meetings: await ctx.db
          .query("meetings")
          .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
          .collect(),
      };
    });

    // Every seeded member has a portrait.
    expect(seededUsers.every((u) => !!u.profilePhoto)).toBe(true);
    // Every group has an avatar; the announcement group wears the logo.
    expect(groups.every((g) => !!g.preview)).toBe(true);
    const announcementGroup = groups.find((g) => g.isAnnouncementGroup);
    expect(announcementGroup?.preview).toBe("r2:uploads/logo.png");
    // Groups carry coordinates near the base, and not all identical.
    expect(groups.every((g) => g.coordinates !== undefined)).toBe(true);
    const distinctLats = new Set(groups.map((g) => g.coordinates!.latitude));
    expect(distinctLats.size).toBeGreaterThan(1);
    // Every event has a cover image and a zip-bearing location.
    expect(meetings.every((m) => !!m.coverImage)).toBe(true);
    expect(meetings.every((m) => m.locationOverride?.includes("11201"))).toBe(true);
  });

  test("the creator leads the announcement group plus two groups, member elsewhere", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "Lead", "+15555550172");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Role Church",
      smallGroupCount: 4,
    });

    const roles = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const out = [];
      for (const row of rows) {
        const group = await ctx.db.get(row.groupId);
        if (group?.communityId !== result.communityId) continue;
        out.push({ role: row.role, isAnnouncement: !!group.isAnnouncementGroup });
      }
      return out;
    });

    const leaderRoles = roles.filter((r) => r.role === "leader");
    expect(leaderRoles.filter((r) => r.isAnnouncement)).toHaveLength(1);
    expect(leaderRoles.filter((r) => !r.isAnnouncement)).toHaveLength(2);
    expect(roles.filter((r) => r.role === "member").length).toBeGreaterThan(0);
  });

  test("the creator is rostered, so their My Schedule isn't empty", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Rota", "+15555550180");

    await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Roster Church",
    });

    // The real My Schedule query: the creator must have upcoming assignments,
    // otherwise the demo's schedule screen shows the empty state.
    const schedule = await t.query(
      api.functions.scheduling.mySchedule.myAssignments,
      { token },
    );
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule.every((a) => a.eventTitle === "Sunday Service")).toBe(true);
  });

  test("campuses and groups spread across the provided real ZIPs", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Geo", "+15555550181");

    const campusPlacements = [
      { zipCode: "10001", latitude: 40.75, longitude: -73.99 },
      { zipCode: "11201", latitude: 40.69, longitude: -73.99 },
    ];
    const areaPlacements = [
      { zipCode: "10002", latitude: 40.71, longitude: -73.98 },
      { zipCode: "10003", latitude: 40.73, longitude: -73.98 },
      { zipCode: "10009", latitude: 40.72, longitude: -73.97 },
    ];

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Geo Church",
      zipCode: "10001",
      baseCoordinates: { latitude: 40.75, longitude: -73.99 },
      campuses: [{ name: "Downtown" }, { name: "Uptown" }],
      smallGroupCount: 4,
      campusPlacements,
      areaPlacements,
    });

    const { campusZips, smallGroupZips } = await t.run(async (ctx) => {
      const groupTypes = await ctx.db
        .query("groupTypes")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const slugById = new Map(groupTypes.map((gt) => [String(gt._id), gt.slug]));
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const campusZips: string[] = [];
      const smallGroupZips: string[] = [];
      for (const g of groups) {
        const slug = slugById.get(String(g.groupTypeId));
        if (slug === "campuses" && g.zipCode) campusZips.push(g.zipCode);
        if (slug === "small-groups" && g.zipCode) smallGroupZips.push(g.zipCode);
      }
      return { campusZips, smallGroupZips };
    });

    // Each campus took a distinct provided campus ZIP.
    expect(new Set(campusZips)).toEqual(new Set(["10001", "11201"]));
    // Small groups scattered across the pool — more than one distinct ZIP, all
    // drawn from the provided area placements (no stacking on the home ZIP).
    expect(new Set(smallGroupZips).size).toBeGreaterThan(1);
    expect(
      smallGroupZips.every((z) => areaPlacements.some((p) => p.zipCode === z)),
    ).toBe(true);
  });

  test("seeds DMs, a group DM, and the Getting Started channel", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Inbox", "+15555550173");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Inbox Church",
    });

    const { adHoc, gettingStarted, botMessages } = await t.run(async (ctx) => {
      const adHoc = await ctx.db
        .query("chatChannels")
        .withIndex("by_community_isAdHoc", (q) =>
          q.eq("communityId", result.communityId).eq("isAdHoc", true),
        )
        .collect();
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      let gettingStarted = null;
      for (const group of groups) {
        const channel = await ctx.db
          .query("chatChannels")
          .withIndex("by_group_slug", (q) =>
            q.eq("groupId", group._id).eq("slug", "getting-started"),
          )
          .first();
        if (channel) gettingStarted = channel;
      }
      const botMessages = gettingStarted
        ? await ctx.db
            .query("chatMessages")
            .withIndex("by_channel", (q) => q.eq("channelId", gettingStarted!._id))
            .collect()
        : [];
      return { adHoc, gettingStarted, botMessages };
    });

    expect(adHoc.filter((c) => c.channelType === "dm")).toHaveLength(2);
    expect(adHoc.filter((c) => c.channelType === "group_dm")).toHaveLength(1);
    // Seeded chats are accepted conversations, and DMs have a dedup key.
    expect(adHoc.find((c) => c.channelType === "dm")?.dmPairKey).toContain(
      String(result.communityId),
    );

    expect(gettingStarted).not.toBeNull();
    // 1 intro + 10 numbered missions + 2 closing lines = 13 bot messages.
    expect(botMessages.length).toBeGreaterThanOrEqual(13);
    // Bot-authored: no senderId, bot content type, named sender.
    expect(botMessages.every((m) => m.senderId === undefined)).toBe(true);
    expect(botMessages.every((m) => m.contentType === "bot")).toBe(true);
  });

  test("seeded events use the canonical RSVP labels", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Rsvp", "+15555550177");
    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Rsvp Church",
      smallGroupCount: 1,
    });
    const meeting = await t.run(async (ctx) =>
      ctx.db
        .query("meetings")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .first(),
    );
    // Matches lib/meetingConfig.ts DEFAULT_RSVP_OPTIONS, not "Attending".
    expect(meeting?.rsvpOptions?.map((o) => o.label)).toEqual([
      "Going",
      "Maybe",
      "Can't Go",
    ]);
  });

  test("a message sent immediately counts, and seeded messages don't", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "Fast", "+15555550178");
    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Fast Church",
    });

    // Seeded DM lines "from the creator" exist but are isDemoSeed -> no credit.
    let progress = await t.query(api.functions.demo.getDemoProgress, {
      token,
      communityId: demo.communityId,
    });
    expect(progress?.missions.find((m) => m.key === "send_message")?.done).toBe(
      false,
    );

    // A real message right now (same wall-clock as seed) still counts — no
    // 5-minute dead zone.
    await t.run(async (ctx) => {
      const channel = await ctx.db
        .query("chatChannels")
        .withIndex("by_community_isAdHoc", (q) =>
          q.eq("communityId", demo.communityId).eq("isAdHoc", true),
        )
        .first();
      await ctx.db.insert("chatMessages", {
        channelId: channel!._id,
        communityId: demo.communityId,
        senderId: userId,
        content: "hello from the admin",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });
    progress = await t.query(api.functions.demo.getDemoProgress, {
      token,
      communityId: demo.communityId,
    });
    expect(progress?.missions.find((m) => m.key === "send_message")?.done).toBe(
      true,
    );
  });

  test("go-live strips placeholder stock covers from surviving groups and events", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Strip", "+15555550179");
    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Strip Church",
      smallGroupCount: 2,
      logo: "r2:uploads/logo.png",
    });

    await t.mutation(internal.functions.demo.purgeDemoSeedUsers, {
      communityId: demo.communityId,
    });

    const { groups, meetings } = await t.run(async (ctx) => ({
      groups: await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect(),
      meetings: await ctx.db
        .query("meetings")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect(),
    }));
    // No surviving row points at picsum.
    expect(groups.every((g) => !g.preview?.includes("picsum.photos"))).toBe(true);
    expect(meetings.every((m) => !m.coverImage?.includes("picsum.photos"))).toBe(true);
    // The church's real logo (r2:) is kept on the announcement group.
    const announcement = groups.find((g) => g.isAnnouncementGroup);
    expect(announcement?.preview).toBe("r2:uploads/logo.png");
  });

  test("getDemoProgress tracks guided missions from real activity", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Prog", "+15555550174");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Progress Church",
    });

    let progress = await t.query(api.functions.demo.getDemoProgress, {
      token,
      communityId: demo.communityId,
    });
    expect(progress?.total).toBe(10);
    expect(progress?.completed).toBe(0);

    // A teammate joins -> invite mission completes.
    const { token: mateToken } = await createUser(t, "Mate", "+15555550175");
    await t.mutation(api.functions.demo.joinDemoCommunity, {
      token: mateToken,
      code: demo.demoCode,
    });
    progress = await t.query(api.functions.demo.getDemoProgress, {
      token,
      communityId: demo.communityId,
    });
    expect(
      progress?.missions.find((m) => m.key === "invite_teammate")?.done,
    ).toBe(true);
    expect(progress?.completed).toBe(1);
  });

  test("go-live purge removes seeded DMs but keeps everything real", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "DmPurge", "+15555550176");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "DM Purge Church",
    });

    await t.mutation(internal.functions.demo.purgeDemoSeedUsers, {
      communityId: demo.communityId,
    });

    const adHoc = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannels")
        .withIndex("by_community_isAdHoc", (q) =>
          q.eq("communityId", demo.communityId).eq("isAdHoc", true),
        )
        .collect(),
    );
    expect(adHoc).toHaveLength(0);
  });
});

describe("joinDemoCommunity", () => {
  test("a teammate joining by demo code becomes an admin enrolled in a curated subset", async () => {
    const t = convexTest(schema, modules);
    const { token: creatorToken } = await createUser(t, "Casey", "+15555550106");
    const { userId: joinerId, token: joinerToken } = await createUser(
      t,
      "Jordan",
      "+15555550107",
    );

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: creatorToken,
      name: "River Church",
    });

    const joined = await t.mutation(api.functions.demo.joinDemoCommunity, {
      token: joinerToken,
      code: demo.demoCode,
    });
    expect(joined.communityId).toBe(demo.communityId);

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", joinerId).eq("communityId", demo.communityId),
        )
        .first(),
    );
    expect(membership?.roles).toBe(COMMUNITY_ROLES.ADMIN);

    const groups = await t.run(async (ctx) =>
      ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect(),
    );
    // The joiner, like a real staff teammate, lands in a curated subset — the
    // announcement group as leader + ≤2 small groups + ≤2 teams (single-campus
    // demo, so no campus groups) — not every group.
    const joinerMemberships = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", joinerId))
        .collect();
      const out: Array<{ role: string; slug?: string; isAnnouncement: boolean }> = [];
      for (const row of rows) {
        const group = await ctx.db.get(row.groupId);
        if (group?.communityId !== demo.communityId) continue;
        const type = group.groupTypeId ? await ctx.db.get(group.groupTypeId) : null;
        out.push({
          role: row.role,
          slug: type?.slug,
          isAnnouncement: !!group.isAnnouncementGroup,
        });
      }
      return out;
    });
    expect(joinerMemberships.length).toBeLessThan(groups.length);
    expect(joinerMemberships.length).toBeLessThanOrEqual(7);
    expect(
      joinerMemberships.filter((m) => m.isAnnouncement && m.role === "leader"),
    ).toHaveLength(1);
    expect(
      joinerMemberships.filter((m) => m.slug === "campuses"),
    ).toHaveLength(0);
    expect(
      joinerMemberships.filter((m) => m.slug === "small-groups").length,
    ).toBeLessThanOrEqual(2);
    expect(
      joinerMemberships.filter((m) => m.slug === "teams").length,
    ).toBeLessThanOrEqual(2);
  });

  test("the creator re-entering their own code keeps primary admin", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "Casey", "+15555550108");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Anchor Church",
    });
    await t.mutation(api.functions.demo.joinDemoCommunity, {
      token,
      code: demo.demoCode,
    });

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", demo.communityId),
        )
        .first(),
    );
    expect(membership?.roles).toBe(COMMUNITY_ROLES.PRIMARY_ADMIN);
  });

  test("caps a demo at 10 real users", async () => {
    const t = convexTest(schema, modules);
    const { token: creatorToken } = await createUser(t, "Cap", "+15555550120");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: creatorToken,
      name: "Full House Church",
    });

    // Fill the demo to the cap: creator + 9 directly-inserted real members.
    await t.run(async (ctx) => {
      const timestamp = Date.now();
      for (let i = 0; i < 9; i++) {
        const uid = await ctx.db.insert("users", {
          firstName: `Staff${i}`,
          lastName: "Member",
          phone: `+1555555013${i}`,
          phoneVerified: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await ctx.db.insert("userCommunities", {
          userId: uid,
          communityId: demo.communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    });

    const { token: eleventhToken } = await createUser(t, "Eleven", "+15555550129");
    await expect(
      t.mutation(api.functions.demo.joinDemoCommunity, {
        token: eleventhToken,
        code: demo.demoCode,
      }),
    ).rejects.toThrow("already has 10 people");

    // Existing members can still re-enter at the cap.
    await expect(
      t.mutation(api.functions.demo.joinDemoCommunity, {
        token: creatorToken,
        code: demo.demoCode,
      }),
    ).resolves.toMatchObject({ communityId: demo.communityId });
  });

  test("cannot join a non-demo community by slug", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Sly", "+15555550109");

    await t.run(async (ctx) => {
      await ctx.db.insert("communities", {
        name: "Real Church",
        slug: "real-church",
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.demo.joinDemoCommunity, {
        token,
        code: "real-church",
      }),
    ).rejects.toThrow("No demo found");
  });
});

describe("getDemoStatus", () => {
  test("reports demo state, code, and real-user headroom to members", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Stat", "+15555550140");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Status Church",
    });

    const status = await t.query(api.functions.demo.getDemoStatus, {
      token,
      communityId: demo.communityId,
    });
    expect(status).toMatchObject({
      isDemo: true,
      demoCode: demo.demoCode,
      realUserCount: 1,
      maxRealUsers: 10,
      isAdmin: true,
    });
  });

  test("returns isDemo false for live communities and non-members", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Live", "+15555550141");

    const communityId = await t.run(async (ctx) =>
      ctx.db.insert("communities", {
        name: "Live Church",
        slug: "live-church",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const status = await t.query(api.functions.demo.getDemoStatus, {
      token,
      communityId,
    });
    expect(status).toEqual({ isDemo: false });
  });
});

describe("demo conversion (go live)", () => {
  test("checkout completion leaves demo mode and purges placeholder members", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "Conv", "+15555550150");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Convert Chapel",
    });

    await t.mutation(internal.functions.ee.billing.handleCheckoutCompleted, {
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      communityId: demo.communityId,
      demoConversion: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const community = await t.run(async (ctx) => ctx.db.get(demo.communityId));
    expect(community?.isDemo).toBe(false);
    expect(community?.billingModel).toBe("per_active_user");
    expect(community?.subscriptionStatus).toBe("active");
    expect(community?.stripeSubscriptionId).toBe("sub_test");
    expect(community?.isPublic).toBe(true);
    // 1 real active member -> $1/month
    expect(community?.subscriptionPriceMonthly).toBe(1);

    const after = await t.run(async (ctx) => {
      const memberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect();
      let placeholders = 0;
      for (const m of memberships) {
        const user = await ctx.db.get(m.userId);
        if (user?.isPlaceholder) placeholders++;
      }
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect();
      const prayers = await ctx.db
        .query("prayers")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect();
      const channels = [];
      for (const group of groups) {
        const rows = await ctx.db
          .query("chatChannels")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .collect();
        channels.push(...rows);
      }
      const messages = [];
      for (const channel of channels) {
        const rows = await ctx.db
          .query("chatMessages")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .collect();
        messages.push(...rows);
      }
      return { placeholders, groups, prayers, channels, messages, memberships };
    });

    // Fake people and everything they authored are gone…
    expect(after.placeholders).toBe(0);
    expect(after.messages).toHaveLength(0);
    expect(after.prayers).toHaveLength(0);
    // …but the structure and the real account survive.
    expect(after.groups.length).toBeGreaterThan(0);
    expect(after.memberships.some((m) => m.userId === userId)).toBe(true);
    // The now-public community gets the default landing page, so /c/[slug]
    // and its join form work immediately after go-live.
    const landingPage = await t.run(async (ctx) =>
      ctx.db
        .query("communityLandingPages")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .first(),
    );
    expect(landingPage?.isEnabled).toBe(true);
    expect(landingPage?.title).toBe("Welcome to Convert Chapel");
    // Channel denormalization was recomputed. Only the real creator survives,
    // and they belong to a curated subset of groups — so every channel has at
    // most 1 member, and channels of groups the creator never joined (or
    // leaders channels of groups they don't lead) legitimately drop to zero.
    for (const channel of after.channels) {
      expect(channel.memberCount).toBeLessThanOrEqual(1);
      expect(channel.lastMessagePreview).toBeUndefined();
    }
    // The creator always leads the announcement group, so its main channel
    // still has exactly one member after the purge.
    const announcementGroup = after.groups.find((g) => g.isAnnouncementGroup);
    const announcementMain = after.channels.find(
      (c) =>
        c.groupId === announcementGroup?._id && c.channelType === "main",
    );
    expect(announcementMain?.memberCount).toBe(1);
  });
});

describe("demo conversion race + purge safety (codex review)", () => {
  test("a second completed checkout for a different subscription never overwrites the first", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Race", "+15555550160");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Race Church",
    });

    await t.mutation(internal.functions.ee.billing.handleCheckoutCompleted, {
      stripeCustomerId: "cus_a",
      stripeSubscriptionId: "sub_first",
      communityId: demo.communityId,
      demoConversion: true,
    });
    // A racing co-admin's checkout completes after the first one.
    await t.mutation(internal.functions.ee.billing.handleCheckoutCompleted, {
      stripeCustomerId: "cus_b",
      stripeSubscriptionId: "sub_duplicate",
      communityId: demo.communityId,
      demoConversion: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const community = await t.run(async (ctx) => ctx.db.get(demo.communityId));
    // First checkout stays the tracked subscription; the duplicate is routed
    // to cancelDuplicateSubscription instead of overwriting it.
    expect(community?.stripeSubscriptionId).toBe("sub_first");
    expect(community?.isDemo).toBe(false);
    expect(community?.billingModel).toBe("per_active_user");
  });

  test("purge deletes only seeded demo members, never other placeholder users", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Purge", "+15555550161");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Purge Church",
    });

    // A real pending invitee: placeholder user created by another flow (e.g.
    // scheduling's invite-new-person), NOT part of the demo seed.
    const inviteeId = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const inviteeId = await ctx.db.insert("users", {
        firstName: "Pending",
        lastName: "Invitee",
        phone: "+15555550162",
        isPlaceholder: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("userCommunities", {
        userId: inviteeId,
        communityId: demo.communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return inviteeId;
    });

    await t.mutation(internal.functions.demo.purgeDemoSeedUsers, {
      communityId: demo.communityId,
    });

    const { invitee, seededLeft } = await t.run(async (ctx) => {
      const invitee = await ctx.db.get(inviteeId);
      const memberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect();
      let seededLeft = 0;
      for (const m of memberships) {
        const user = await ctx.db.get(m.userId);
        if (user?.isDemoSeed) seededLeft++;
      }
      return { invitee, seededLeft };
    });
    expect(seededLeft).toBe(0);
    expect(invitee).not.toBeNull();
    expect(invitee?.isPlaceholder).toBe(true);
  });
});

describe("demo isolation", () => {
  test("demo communities are excluded from community search", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "Iso", "+15555550110");

    await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Searchable Chapel",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("communities", {
        name: "Searchable Real Church",
        slug: "searchable-real",
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const results = await t.query(api.functions.resources.communitySearch, {
      query: "searchable",
    });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].name).toBe("Searchable Real Church");
  });
});

// ---------------------------------------------------------------------------
// Coverage for the rewritten seeder's new features: size-aware team taxonomy,
// the native Serve Day event card, the giving link, the six-week roster,
// member-health rows, unread suppression, and go-live purge of the new tables.
// ---------------------------------------------------------------------------

/** Helper: load a community's groups + a slug→type map. */
async function loadGroups(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
) {
  return await t.run(async (ctx) => {
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    return { groups, groupTypes };
  });
}

describe("demo v4: team taxonomy by campus size", () => {
  test("single-campus seeds five default team groups and no campus groups", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "SingleT", "+15555550200");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Single Campus Church",
      smallGroupCount: 2,
    });

    const { groups, groupTypes } = await loadGroups(t, result.communityId);
    const typeById = new Map(groupTypes.map((gt) => [gt._id, gt.slug]));
    const bySlug = (slug: string) =>
      groups.filter((g) => typeById.get(g.groupTypeId!) === slug);

    // Default single-campus team set: 5 Team groups.
    const teamGroups = bySlug("teams");
    expect(teamGroups).toHaveLength(5);
    expect(teamGroups.map((g) => g.name).sort()).toEqual(
      [
        "Kids Team",
        "Prayer Team",
        "Production Team",
        "Welcome Team",
        "Worship Team",
      ].sort(),
    );
    // No campus groups and no Campus group TYPE for a single-campus church.
    expect(bySlug("campuses")).toHaveLength(0);
    expect(groupTypes.some((gt) => gt.slug === "campuses")).toBe(false);
  });

  test("multi-campus seeds centralized team groups plus campus groups with per-campus team channels", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "MultiT", "+15555550201");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Multi Campus Church",
      campusCount: 3,
      smallGroupCount: 1,
    });

    const { groups, groupTypes } = await loadGroups(t, result.communityId);
    const typeById = new Map(groupTypes.map((gt) => [gt._id, gt.slug]));
    const bySlug = (slug: string) =>
      groups.filter((g) => typeById.get(g.groupTypeId!) === slug);

    // 3 default centralized team groups, and a Campus type with 3 campus groups.
    const teamGroups = bySlug("teams");
    expect(teamGroups.map((g) => g.name).sort()).toEqual(
      ["Kids Team", "Production Team", "Worship Team"].sort(),
    );
    const campusGroups = bySlug("campuses");
    expect(campusGroups).toHaveLength(3);
    expect(groupTypes.some((gt) => gt.slug === "campuses")).toBe(true);

    // Every campus group carries a custom channel per default per-campus team.
    const campusChannelNames = await t.run(async (ctx) => {
      const out: string[][] = [];
      for (const campus of campusGroups) {
        const channels = await ctx.db
          .query("chatChannels")
          .withIndex("by_group", (q) => q.eq("groupId", campus._id))
          .collect();
        out.push(
          channels.filter((c) => c.channelType === "custom").map((c) => c.name),
        );
      }
      return out;
    });
    for (const names of campusChannelNames) {
      expect(names).toEqual(
        expect.arrayContaining(["Welcome Team", "Prayer Team"]),
      );
    }
  });

  test("custom team names are honored for single- and multi-campus demos", async () => {
    const t = convexTest(schema, modules);
    const { token: tokenA } = await createUser(t, "CustomA", "+15555550202");
    const { token: tokenB } = await createUser(t, "CustomB", "+15555550203");

    const single = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: tokenA,
      name: "Custom Single Church",
      teams: ["Hospitality", "Media"],
    });
    const multi = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: tokenB,
      name: "Custom Multi Church",
      campusCount: 2,
      centralizedTeams: ["Band", "AV"],
      perCampusTeams: ["Greeters"],
    });

    const singleGroups = await loadGroups(t, single.communityId);
    const singleTypeById = new Map(
      singleGroups.groupTypes.map((gt) => [gt._id, gt.slug]),
    );
    const singleTeamNames = singleGroups.groups
      .filter((g) => singleTypeById.get(g.groupTypeId!) === "teams")
      .map((g) => g.name)
      .sort();
    expect(singleTeamNames).toEqual(["Hospitality", "Media"]);

    const multiGroups = await loadGroups(t, multi.communityId);
    const multiTypeById = new Map(
      multiGroups.groupTypes.map((gt) => [gt._id, gt.slug]),
    );
    const multiTeamNames = multiGroups.groups
      .filter((g) => multiTypeById.get(g.groupTypeId!) === "teams")
      .map((g) => g.name)
      .sort();
    expect(multiTeamNames).toEqual(["AV", "Band"]);
    const multiCampuses = multiGroups.groups.filter(
      (g) => multiTypeById.get(g.groupTypeId!) === "campuses",
    );
    const customChannelNames = await t.run(async (ctx) => {
      const channels = await ctx.db
        .query("chatChannels")
        .withIndex("by_group", (q) => q.eq("groupId", multiCampuses[0]._id))
        .collect();
      return channels.filter((c) => c.channelType === "custom").map((c) => c.name);
    });
    expect(customChannelNames).toEqual(["Greeters"]);
  });
});

describe("demo v4: native Serve Day card, giving link, roster, member health", () => {
  test("seeds a native Serve Day event card in the announcement chat", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "CardT", "+15555550210");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Card Church",
      smallGroupCount: 2,
    });

    const data = await t.run(async (ctx) => {
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const ann = groups.find((g) => g.isAnnouncementGroup)!;
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", ann._id))
        .collect();
      const card = meetings.find((m) => m.visibility === "community");
      const rsvps = card
        ? await ctx.db
            .query("meetingRsvps")
            .withIndex("by_meeting", (q) => q.eq("meetingId", card._id))
            .collect()
        : [];
      const mainChannel = await ctx.db
        .query("chatChannels")
        .withIndex("by_group_slug", (q) =>
          q.eq("groupId", ann._id).eq("slug", "general"),
        )
        .first();
      const messages = mainChannel
        ? await ctx.db
            .query("chatMessages")
            .withIndex("by_channel", (q) => q.eq("channelId", mainChannel._id))
            .collect()
        : [];
      return { card, rsvps, messages };
    });

    // A community-visibility meeting with a shortId and 60+ RSVPs (mostly Going).
    expect(data.card).toBeTruthy();
    expect(data.card?.shortId).toBeTruthy();
    expect(data.rsvps.length).toBeGreaterThanOrEqual(60);
    const going = data.rsvps.filter((r) => r.rsvpOptionId === 1).length;
    expect(going).toBeGreaterThan(data.rsvps.length / 2);
    // A native card message links to /e/<shortId> and stays plain text.
    const cardMsg = data.messages.find((m) =>
      m.content.includes(`/e/${data.card!.shortId}`),
    );
    expect(cardMsg).toBeTruthy();
    expect(cardMsg?.contentType).toBe("text");
  });

  test("seeds a 'Partner with us' giving link on the announcement group", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "GiveT", "+15555550211");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Giving Church",
    });

    const resource = await t.run(async (ctx) => {
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const ann = groups.find((g) => g.isAnnouncementGroup)!;
      return await ctx.db
        .query("groupResources")
        .withIndex("by_group", (q) => q.eq("groupId", ann._id))
        .first();
    });

    expect(resource?.title).toBe("Partner with us");
    expect(resource?.showInInbox).toBe(true);
    expect(resource?.linkUrl).toContain("pushpay.com");
    expect(resource?.isDemoSeed).toBe(true);
  });

  test("seeds a six-week Sunday service roster on the host group", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "RosterT", "+15555550212");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Roster Church",
      smallGroupCount: 1,
    });

    const data = await t.run(async (ctx) => {
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const ann = groups.find((g) => g.isAnnouncementGroup)!;
      const plans = (
        await ctx.db
          .query("eventPlans")
          .withIndex("by_community_date", (q) =>
            q.eq("communityId", result.communityId),
          )
          .collect()
      ).filter((p) => p.isDemoSeed);
      const teams = (
        await ctx.db
          .query("teams")
          .withIndex("by_community", (q) =>
            q.eq("communityId", result.communityId),
          )
          .collect()
      ).filter((tm) => tm.isDemoSeed);
      const roles: any[] = [];
      for (const team of teams) {
        roles.push(
          ...(await ctx.db
            .query("teamRoles")
            .withIndex("by_team", (q) => q.eq("teamId", team._id))
            .collect()),
        );
      }
      const assignments: any[] = [];
      const items: any[] = [];
      const needed: any[] = [];
      const availability: any[] = [];
      for (const plan of plans) {
        assignments.push(
          ...(await ctx.db
            .query("roleAssignments")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect()),
        );
        items.push(
          ...(await ctx.db
            .query("eventItems")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect()),
        );
        needed.push(
          ...(await ctx.db
            .query("neededRoles")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect()),
        );
        availability.push(
          ...(await ctx.db
            .query("eventAvailability")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect()),
        );
      }
      return {
        annId: ann._id,
        plans,
        teams,
        roles,
        assignments,
        items,
        needed,
        availability,
      };
    });

    expect(data.plans.length).toBeGreaterThanOrEqual(6);
    expect(data.plans.every((p) => p.status === "published")).toBe(true);
    // Single-campus host group is the announcement group.
    expect(data.plans.every((p) => p.groupId === data.annId)).toBe(true);
    // Worship + Production + Kids serving teams with their roles.
    expect(data.teams).toHaveLength(3);
    expect(data.roles.length).toBeGreaterThan(0);
    expect(data.needed.length).toBeGreaterThan(0);
    expect(data.assignments.length).toBeGreaterThan(0);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.availability.length).toBeGreaterThan(0);
    // Availability is recorded only for people who were actually rostered.
    const rostered = new Set(data.assignments.map((a) => String(a.userId)));
    expect(
      data.availability.every((av) => rostered.has(String(av.userId))),
    ).toBe(true);
  });

  test("seeds a realistic member-health spread for the whole roster", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "HealthT", "+15555550213");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Health Church",
      smallGroupCount: 2,
    });

    // Member-health activity is seeded off-thread — run the scheduled work.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const data = await t.run(async (ctx) => {
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const ann = groups.find((g) => g.isAnnouncementGroup)!;
      const people = await ctx.db
        .query("communityPeople")
        .withIndex("by_group", (q) => q.eq("groupId", ann._id))
        .collect();
      const gms = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", ann._id))
        .collect();
      const followups: any[] = [];
      for (const gm of gms) {
        followups.push(
          ...(await ctx.db
            .query("memberFollowups")
            .withIndex("by_groupMember", (q) => q.eq("groupMemberId", gm._id))
            .collect()),
        );
      }
      const attendances = await ctx.db.query("meetingAttendances").collect();
      const activityMeetings = (
        await ctx.db
          .query("meetings")
          .withIndex("by_community", (q) =>
            q.eq("communityId", result.communityId),
          )
          .collect()
      ).filter((m) => m.isDemoActivitySeed);
      return {
        people,
        followups,
        attendances,
        activityMeetings,
        serving: ann.pcoServingCounts,
      };
    });

    // Every placeholder member gets a health row — the whole roster, not a slice.
    expect(data.people.length).toBe(100);
    // Connection scores span all three bands (needs < 40 <= watch < 70 <= healthy).
    const s3 = data.people.map((p) => p.score3 ?? 0);
    expect(s3.some((v) => v < 40)).toBe(true);
    expect(s3.some((v) => v >= 40 && v < 70)).toBe(true);
    expect(s3.some((v) => v >= 70)).toBe(true);
    // Nobody is stuck at zero across all three scores.
    expect(
      data.people.every(
        (p) => (p.score1 ?? 0) + (p.score2 ?? 0) + (p.score3 ?? 0) > 0,
      ),
    ).toBe(true);
    // Scores are backed by real seeded activity (past gatherings + attendance +
    // serving counts), so the daily cron recomputes the same bands.
    expect(data.activityMeetings.length).toBe(9);
    expect(data.attendances.length).toBeGreaterThan(0);
    expect((data.serving?.counts.length ?? 0)).toBeGreaterThan(0);
    // Some members have a seeded follow-up in their history.
    expect(data.followups.length).toBeGreaterThan(0);
  });
});

describe("demo v4: unread suppression + go-live purge of new tables", () => {
  test("marks joined channels read except the Getting Started tour", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "UnreadT", "+15555550214");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Unread Church",
      smallGroupCount: 2,
    });

    const data = await t.run(async (ctx) => {
      const readStates = await ctx.db
        .query("chatReadState")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const withSlug: Array<{ slug?: string; unreadCount: number }> = [];
      for (const rs of readStates) {
        const channel = await ctx.db.get(rs.channelId);
        withSlug.push({ slug: channel?.slug, unreadCount: rs.unreadCount });
      }
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", result.communityId))
        .collect();
      const ann = groups.find((g) => g.isAnnouncementGroup)!;
      const gs = await ctx.db
        .query("chatChannels")
        .withIndex("by_group_slug", (q) =>
          q.eq("groupId", ann._id).eq("slug", "getting-started"),
        )
        .first();
      const gsMembership = gs
        ? await ctx.db
            .query("chatChannelMembers")
            .withIndex("by_channel_user", (q) =>
              q.eq("channelId", gs._id).eq("userId", userId),
            )
            .first()
        : null;
      const gsReadState = gs
        ? await ctx.db
            .query("chatReadState")
            .withIndex("by_channel_user", (q) =>
              q.eq("channelId", gs._id).eq("userId", userId),
            )
            .first()
        : null;
      return { withSlug, gsMembership, gsReadState };
    });

    // Every read-state the creator has is fully read…
    expect(data.withSlug.length).toBeGreaterThan(0);
    expect(data.withSlug.every((rs) => rs.unreadCount === 0)).toBe(true);
    // …and none of them is the Getting Started tour.
    expect(data.withSlug.some((rs) => rs.slug === "getting-started")).toBe(false);
    // The creator IS a member of the tour channel, but has no read-state there,
    // so its bot messages stay unread and pull them into the tour.
    expect(data.gsMembership).not.toBeNull();
    expect(data.gsReadState).toBeNull();
  });

  test("go-live purges seeded rostering, giving link, and member-health rows while the landing page and creator survive", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "PurgeExtra", "+15555550215");

    const result = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Purge Extras Church",
      smallGroupCount: 2,
    });

    // Run the scheduled member-health seeding so go-live has to clean it up.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(internal.functions.demo.purgeDemoSeedUsers, {
      communityId: result.communityId,
    });

    const data = await t.run(async (ctx) => ({
      plans: (await ctx.db.query("eventPlans").collect()).filter(
        (p) => p.isDemoSeed,
      ),
      teams: (await ctx.db.query("teams").collect()).filter((tm) => tm.isDemoSeed),
      teamRoles: await ctx.db.query("teamRoles").collect(),
      roleAssignments: await ctx.db.query("roleAssignments").collect(),
      neededRoles: await ctx.db.query("neededRoles").collect(),
      eventItems: await ctx.db.query("eventItems").collect(),
      eventAvailability: await ctx.db.query("eventAvailability").collect(),
      givingLinks: (await ctx.db.query("groupResources").collect()).filter(
        (r) => r.isDemoSeed,
      ),
      people: await ctx.db.query("communityPeople").collect(),
      assignees: await ctx.db.query("communityPeopleAssignees").collect(),
      followups: await ctx.db.query("memberFollowups").collect(),
      attendances: await ctx.db.query("meetingAttendances").collect(),
      activityMeetings: (
        await ctx.db
          .query("meetings")
          .withIndex("by_community", (q) =>
            q.eq("communityId", result.communityId),
          )
          .collect()
      ).filter((m) => m.isDemoActivitySeed),
      groupsWithServing: (
        await ctx.db
          .query("groups")
          .withIndex("by_community", (q) =>
            q.eq("communityId", result.communityId),
          )
          .collect()
      ).filter((g) => g.pcoServingCounts),
      landingPage: await ctx.db
        .query("communityLandingPages")
        .withIndex("by_community", (q) =>
          q.eq("communityId", result.communityId),
        )
        .first(),
      creator: await ctx.db.get(userId),
      creatorMembership: await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", result.communityId),
        )
        .first(),
    }));

    // Rostering scaffolding and its children are gone.
    expect(data.plans).toHaveLength(0);
    expect(data.teams).toHaveLength(0);
    expect(data.teamRoles).toHaveLength(0);
    expect(data.roleAssignments).toHaveLength(0);
    expect(data.neededRoles).toHaveLength(0);
    expect(data.eventItems).toHaveLength(0);
    expect(data.eventAvailability).toHaveLength(0);
    // The demo-only giving link is gone.
    expect(data.givingLinks).toHaveLength(0);
    // Seeded member-health rows and their junctions/follow-ups are gone.
    expect(data.people).toHaveLength(0);
    expect(data.assignees).toHaveLength(0);
    expect(data.followups).toHaveLength(0);
    // The past attendance-history gatherings + their attendance rows and the
    // seeded serving counts are gone (they'd otherwise skew real scores).
    expect(data.activityMeetings).toHaveLength(0);
    expect(data.attendances).toHaveLength(0);
    expect(data.groupsWithServing).toHaveLength(0);
    // …but the landing page and the real creator survive.
    expect(data.landingPage?.isEnabled).toBe(true);
    expect(data.landingPage?.title).toBe("Welcome to Purge Extras Church");
    expect(data.creator).not.toBeNull();
    expect(data.creatorMembership).not.toBeNull();
  });
});

describe("demo v5: review-fix follow-ups", () => {
  test("multi-campus seeded per-campus channels don't pre-complete the create_channel mission", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await createUser(t, "ChanT", "+15555550220");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Channel Church",
      campusCount: 2,
      smallGroupCount: 1,
    });

    // Sanity: per-campus custom channels WERE seeded, authored by the creator
    // (channelType "custom", not the Getting Started tour).
    const seededCustom = await t.run(async (ctx) => {
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .collect();
      let count = 0;
      for (const g of groups) {
        const channels = await ctx.db
          .query("chatChannels")
          .withIndex("by_group", (q) => q.eq("groupId", g._id))
          .collect();
        count += channels.filter(
          (c) => c.channelType === "custom" && c.slug !== "getting-started",
        ).length;
      }
      return count;
    });
    expect(seededCustom).toBeGreaterThan(0);

    // No real activity yet: the mission is NOT pre-completed even though seeded
    // custom channels exist, because they share the community's createdAt.
    let progress = await t.query(api.functions.demo.getDemoProgress, {
      token,
      communityId: demo.communityId,
    });
    expect(
      progress?.missions.find((m) => m.key === "create_channel")?.done,
    ).toBe(false);

    // The creator genuinely creates a new custom channel later (strictly newer
    // than the community) -> the mission flips to done.
    await t.run(async (ctx) => {
      const community = await ctx.db.get(demo.communityId);
      const base = community!.createdAt ?? community!._creationTime;
      const group = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", demo.communityId))
        .first();
      await ctx.db.insert("chatChannels", {
        groupId: group!._id,
        slug: "prayer",
        channelType: "custom",
        name: "Prayer",
        createdById: userId,
        createdAt: base + 1000,
        updatedAt: base + 1000,
        isArchived: false,
        isEnabled: true,
        memberCount: 0,
      });
    });
    progress = await t.query(api.functions.demo.getDemoProgress, {
      token,
      communityId: demo.communityId,
    });
    expect(
      progress?.missions.find((m) => m.key === "create_channel")?.done,
    ).toBe(true);
  });

  test("an edited giving link survives go-live; an untouched one is purged", async () => {
    const t = convexTest(schema, modules);
    const { token: tokenA } = await createUser(t, "GiveKeep", "+15555550221");
    const { token: tokenB } = await createUser(t, "GiveDrop", "+15555550222");

    const edited = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: tokenA,
      name: "Edited Giving Church",
    });
    const untouched = await t.mutation(api.functions.demo.createDemoCommunity, {
      token: tokenB,
      name: "Untouched Giving Church",
    });

    // Helper: fetch the announcement group's giving resource for a community.
    const givingResource = async (communityId: Id<"communities">) =>
      await t.run(async (ctx) => {
        const groups = await ctx.db
          .query("groups")
          .withIndex("by_community", (q) => q.eq("communityId", communityId))
          .collect();
        const ann = groups.find((g) => g.isAnnouncementGroup)!;
        return await ctx.db
          .query("groupResources")
          .withIndex("by_group", (q) => q.eq("groupId", ann._id))
          .first();
      });

    // The church points "Partner with us" at its real giving page before going
    // live (linkUrl no longer the seeded placeholder).
    const EDITED_URL = "https://givelify.com/mychurch";
    const seededEdited = await givingResource(edited.communityId);
    await t.run(async (ctx) => {
      await ctx.db.patch(seededEdited!._id, { linkUrl: EDITED_URL });
    });

    await t.mutation(internal.functions.demo.purgeDemoSeedUsers, {
      communityId: edited.communityId,
    });
    await t.mutation(internal.functions.demo.purgeDemoSeedUsers, {
      communityId: untouched.communityId,
    });

    // Edited link survives with the church's URL…
    const survivedResource = await givingResource(edited.communityId);
    expect(survivedResource).not.toBeNull();
    expect(survivedResource?.linkUrl).toBe(EDITED_URL);

    // …but the untouched placeholder link is deleted.
    const purgedResource = await givingResource(untouched.communityId);
    expect(purgedResource).toBeNull();
  });

  test("roster service times are stored in the community's local timezone", async () => {
    const t = convexTest(schema, modules);
    const { token } = await createUser(t, "TzT", "+15555550223");

    const demo = await t.mutation(api.functions.demo.createDemoCommunity, {
      token,
      name: "Timezone Church",
      smallGroupCount: 1,
    });

    const plans = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("eventPlans")
          .withIndex("by_community_date", (q) =>
            q.eq("communityId", demo.communityId),
          )
          .collect()
      ).filter((p) => p.isDemoSeed),
    );
    expect(plans.length).toBeGreaterThan(0);

    // The first service ("9:00 AM") should land at 9 AM ET, not 9:00 UTC.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    for (const plan of plans) {
      const first = plan.times?.[0];
      expect(first?.label).toBe("9:00 AM");
      const hour = parseInt(fmt.format(new Date(first!.startsAt)), 10) % 24;
      expect(hour).toBe(9);
    }
  });
});
