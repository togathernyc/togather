import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scheduled event notifications", () => {
  test("uses the event's own group image in push payload", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Event Community",
        slug: "event-community",
        subdomain: "event-community",
        timezone: "America/New_York",
        primaryColor: "#123456",
        createdAt: now,
        updatedAt: now,
      });
    });

    const groupTypeId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupTypes", {
        communityId,
        name: "Small Groups",
        slug: "small-groups",
        isActive: true,
        createdAt: now,
        displayOrder: 1,
      });
    });

    const [eventGroupId, otherGroupId] = await t.run(async (ctx) => {
      const groupA = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Test Group",
        preview: "https://example.com/group-a.jpg",
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
      const groupB = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Other Group",
        preview: "https://example.com/group-b.jpg",
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
      return [groupA, groupB];
    });

    const recipientId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Recipient",
        lastName: "User",
        phone: "+15550001111",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("pushTokens", {
        userId: recipientId,
        token: "ExponentPushToken[event-image-test]",
        platform: "ios",
        isActive: true,
        environment: "staging",
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
      });
    });

    const meetingId = await t.run(async (ctx) => {
      const createdMeetingId = await ctx.db.insert("meetings", {
        groupId: eventGroupId,
        title: "Weekly Event",
        shortId: "evt123",
        scheduledAt: now + 60 * 60 * 1000,
        status: "scheduled",
        meetingType: 1,
        createdAt: now,
      });
      await ctx.db.insert("meetingRsvps", {
        meetingId: createdMeetingId,
        userId: recipientId,
        rsvpOptionId: 1,
        createdAt: now,
        updatedAt: now,
      });
      return createdMeetingId;
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-event-1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.functions.scheduledJobs.sendEventUpdateNotification, {
      meetingId: meetingId as Id<"meetings">,
      changes: ["Start time changed"],
      newTime: "8:00 PM",
    });

    expect(fetchMock).toHaveBeenCalled();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload[0].richContent.image).toBe("https://example.com/group-a.jpg");
    expect(payload[0].data.groupAvatarUrl).toBe("https://example.com/group-a.jpg");
    expect(payload[0].richContent.image).not.toBe("https://example.com/group-b.jpg");

    // Ensure we truly tied image selection to meeting.groupId, not "any group in community".
    expect(payload[0].data.groupId).toBe(eventGroupId);
    expect(payload[0].data.groupId).not.toBe(otherGroupId);
  });
});
