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
      secondaryColor: "#112233",
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

    // 2 small groups + 2 teams + 1 class + 3 campuses + 1 announcement group.
    const typeById = new Map(groupTypes.map((gt) => [gt._id, gt.slug]));
    const bySlug = (slug: string) =>
      groups.filter((g) => typeById.get(g.groupTypeId!) === slug);
    expect(bySlug("small-groups")).toHaveLength(2);
    expect(bySlug("campuses")).toHaveLength(3);
    expect(bySlug("teams")).toHaveLength(2);
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

    // The creator is enrolled in every group so their inbox is full.
    const creatorMemberships = await t.run(async (ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user")
        .collect()
        .then((rows) => rows.filter((r) => r.userId === userId)),
    );
    expect(creatorMemberships).toHaveLength(groups.length);
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
    ).toHaveLength(6);
    expect(
      groups.filter((g) => typeById.get(g.groupTypeId!) === "campuses"),
    ).toHaveLength(4);
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

describe("joinDemoCommunity", () => {
  test("a teammate joining by demo code becomes an admin enrolled everywhere", async () => {
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
    const joinerGroupMemberships = await t.run(async (ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user")
        .collect()
        .then((rows) => rows.filter((r) => r.userId === joinerId)),
    );
    expect(joinerGroupMemberships).toHaveLength(groups.length);
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
    // Channel denormalization was recomputed (creator remains in channels).
    for (const channel of after.channels) {
      expect(channel.memberCount).toBe(1);
      expect(channel.lastMessagePreview).toBeUndefined();
    }
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
