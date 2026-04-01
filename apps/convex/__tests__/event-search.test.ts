/**
 * Event Search Tests
 *
 * Tests the searchEvents query and meeting searchText population.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

// Set up environment variables
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Test Helpers
// ============================================================================

async function seedCommunityWithGroup(t: ReturnType<typeof convexTest>) {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      displayOrder: 0,
      createdAt: Date.now(),
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Downtown Bible Study",
      isArchived: false,
      city: "New York",
      state: "NY",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { communityId, groupId, groupTypeId };
}

async function createUserWithMembership(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupId: Id<"groups">,
  options?: { communityRoles?: number }
) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      roles: options?.communityRoles ?? 1,
      status: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

async function createMeeting(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  communityId: Id<"communities">,
  overrides: Partial<{
    title: string;
    locationOverride: string;
    status: string;
    scheduledAt: number;
    visibility: string;
    searchText: string;
  }> = {}
) {
  const groupName = await t.run(async (ctx) => {
    const group = await ctx.db.get(groupId);
    return group?.name || "";
  });

  const title = overrides.title ?? "Weekly Gathering";
  const locationOverride = overrides.locationOverride;
  const searchText =
    overrides.searchText ??
    [title, locationOverride, groupName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  return await t.run(async (ctx) => {
    return await ctx.db.insert("meetings", {
      groupId,
      title,
      scheduledAt: overrides.scheduledAt ?? Date.now() + 86400000, // Tomorrow
      status: overrides.status ?? "scheduled",
      meetingType: 1,
      createdAt: Date.now(),
      visibility: overrides.visibility ?? "community",
      communityId,
      searchText,
    });
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("searchEvents", () => {
  test("returns events matching search term", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    await createMeeting(t, groupId, communityId, {
      title: "Prayer Night",
    });
    await createMeeting(t, groupId, communityId, {
      title: "Movie Night",
    });

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "prayer",
      }
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Prayer Night");
  });

  test("returns empty for empty search term", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    await createMeeting(t, groupId, communityId);

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "",
      }
    );

    expect(result.events).toHaveLength(0);
  });

  test("searches across group name", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    // Group is named "Downtown Bible Study", create a meeting
    await createMeeting(t, groupId, communityId, {
      title: "Regular Meeting",
    });

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "downtown",
      }
    );

    expect(result.events).toHaveLength(1);
  });

  test("includes confirmed events", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    await createMeeting(t, groupId, communityId, {
      title: "Confirmed Gathering",
      status: "confirmed",
    });

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "confirmed",
      }
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Confirmed Gathering");
  });

  test("excludes cancelled events", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    await createMeeting(t, groupId, communityId, {
      title: "Cancelled Event",
      status: "cancelled",
    });

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "cancelled",
      }
    );

    expect(result.events).toHaveLength(0);
  });

  test("excludes past events by default", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    await createMeeting(t, groupId, communityId, {
      title: "Past Event",
      scheduledAt: Date.now() - 86400000, // Yesterday
    });

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "past",
      }
    );

    expect(result.events).toHaveLength(0);
  });

  test("includes past events when startAfter is set", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    const pastTime = Date.now() - 86400000;
    await createMeeting(t, groupId, communityId, {
      title: "Recent Past Event",
      scheduledAt: pastTime,
    });

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "recent",
        startAfter: pastTime - 1000, // Before the event
      }
    );

    expect(result.events).toHaveLength(1);
  });

  test("respects visibility filtering for group-only events", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, groupTypeId } =
      await seedCommunityWithGroup(t);

    // Create a second group the user is NOT in
    const otherGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Other Group",
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // User is member of first group only
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    // Create a group-visibility event in the other group
    await createMeeting(t, otherGroupId, communityId, {
      title: "Private Event",
      visibility: "group",
      searchText: "private event other group",
    });

    // Create a community-visibility event in the other group
    await createMeeting(t, otherGroupId, communityId, {
      title: "Community Event",
      visibility: "community",
      searchText: "community event other group",
    });

    // Search for both
    const privateResult = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "private",
      }
    );

    const communityResult = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "community event",
      }
    );

    // Group-only event should be hidden (user is not in that group)
    expect(privateResult.events).toHaveLength(0);
    // Community event should be visible (user is community member)
    expect(communityResult.events).toHaveLength(1);
  });

  test("excludes events from archived groups", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    await t.run(async (ctx) => {
      await ctx.db.patch(groupId, { isArchived: true });
    });

    await createMeeting(t, groupId, communityId, {
      title: "Archived Group Event",
    });

    const result = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "archived",
      }
    );

    expect(result.events).toHaveLength(0);
  });
});

describe("meeting create populates search fields", () => {
  test("create mutation sets communityId and searchText", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { userId, accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId
    );

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: accessToken,
      groupId,
      title: "Test Event at Central Park",
      scheduledAt: Date.now() + 86400000,
      meetingType: 1,
      locationOverride: "Central Park",
    });

    const meeting = await t.run(async (ctx) => ctx.db.get(meetingId));

    expect(meeting!.communityId).toBe(communityId);
    expect(meeting!.searchText).toContain("test event at central park");
    expect(meeting!.searchText).toContain("central park");
    expect(meeting!.searchText).toContain("downtown bible study");
  });

  test("createCommunityWideEvent sets communityId and searchText on spawned meetings", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, groupTypeId } =
      await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId,
      { communityRoles: 3 }
    );

    const result = await t.mutation(
      api.functions.meetings.index.createCommunityWideEvent,
      {
        token: accessToken,
        communityId,
        groupTypeId,
        title: "All Hands Picnic",
        scheduledAt: Date.now() + 86400000,
        meetingType: 1,
      }
    );

    expect(result.meetingIds).toHaveLength(1);

    const meeting = await t.run(async (ctx) =>
      ctx.db.get(result.meetingIds[0])
    );

    expect(meeting!.communityId).toBe(communityId);
    expect(meeting!.searchText).toContain("all hands picnic");
    expect(meeting!.searchText).toContain("downtown bible study");

    const searchResult = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "picnic",
      }
    );

    expect(searchResult.events).toHaveLength(1);
  });

  test("communityWideEvents.update rebuilds child meeting searchText when title changes", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, groupTypeId } =
      await seedCommunityWithGroup(t);
    const { accessToken } = await createUserWithMembership(
      t,
      communityId,
      groupId,
      { communityRoles: 3 }
    );

    const created = await t.mutation(
      api.functions.meetings.index.createCommunityWideEvent,
      {
        token: accessToken,
        communityId,
        groupTypeId,
        title: "Alpha Workshop",
        scheduledAt: Date.now() + 86400000,
        meetingType: 1,
      }
    );

    await t.mutation(api.functions.communityWideEvents.update, {
      token: accessToken,
      communityWideEventId: created.communityWideEventId,
      title: "Beta Workshop",
    });

    const meeting = await t.run(async (ctx) =>
      ctx.db.get(created.meetingIds[0])
    );

    expect(meeting!.title).toBe("Beta Workshop");
    expect(meeting!.searchText).toContain("beta workshop");
    expect(meeting!.searchText).not.toContain("alpha workshop");

    const oldTerm = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "alpha",
      }
    );
    expect(oldTerm.events).toHaveLength(0);

    const newTerm = await t.query(
      api.functions.meetings.explore.searchEvents,
      {
        token: accessToken,
        communityId,
        searchTerm: "beta",
      }
    );
    expect(newTerm.events).toHaveLength(1);
  });
});
