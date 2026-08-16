/**
 * End-to-end coverage for the `isBirthdayToday` flag as it is actually served.
 *
 * The unit tests in `birthdays.test.ts` prove the date logic. These prove the
 * flag survives the trip through the queries the UI calls — `users.getProfile`
 * and `messaging.directMessages.getDirectInbox`. Without these, the helper
 * could be correct while the queries hand the client a hardcoded `false` and
 * every other test in the suite would still pass.
 *
 * They also pin the privacy boundary: the flag falls back to `dateOfBirth`,
 * which is collected for the 13+ age check and is not something a member chose
 * to share, so only a seated member of the community may see it — and the date
 * itself must never appear in a response.
 *
 * Run with: cd apps/convex && pnpm test __tests__/birthdayToday.plumbing.test.ts
 */

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const MEMBERSHIP_ACTIVE = 1;

/** Noon Eastern on 14 March 2026 — unambiguously the 14th in the test zone. */
const TODAY = new Date("2026-03-14T16:00:00Z");
/** A birthday on 14 March, stored the way `updateProfile` stores it. */
const DOB_MAR_14 = Date.UTC(1994, 2, 14);

async function seedCommunity(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Birthday Plumbing",
      slug: "bday-plumbing",
      timezone: "America/New_York",
      isPublic: true,
    });
    return communityId;
  });
}

async function seedMember(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  fields: {
    firstName: string;
    dateOfBirth?: number;
    birthdayMonth?: number;
    birthdayDay?: number;
  },
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      firstName: fields.firstName,
      lastName: "Tester",
      phone: `+1555${Math.floor(Math.random() * 10_000_000)
        .toString()
        .padStart(7, "0")}`,
      phoneVerified: true,
      dateOfBirth: fields.dateOfBirth,
      birthdayMonth: fields.birthdayMonth,
      birthdayDay: fields.birthdayDay,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      status: MEMBERSHIP_ACTIVE,
      createdAt: Date.now(),
    });
    return userId;
  });
}

describe("users.getProfile", () => {
  test("serves isBirthdayToday=true from the private dateOfBirth", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    const t = convexTest(schema, modules);
    const communityId = await seedCommunity(t);
    const birthdayUser = await seedMember(t, communityId, {
      firstName: "Tadala",
      dateOfBirth: DOB_MAR_14,
    });
    const viewer = await seedMember(t, communityId, { firstName: "Viewer" });
    const { accessToken } = await generateTokens(viewer);

    const profile = await t.query(api.functions.users.getProfile, {
      token: accessToken,
      userId: birthdayUser,
      communityId,
    });

    expect(profile?.isBirthdayToday).toBe(true);
    vi.useRealTimers();
  });

  test("serves isBirthdayToday=true from the public month/day pair", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    const t = convexTest(schema, modules);
    const communityId = await seedCommunity(t);
    const birthdayUser = await seedMember(t, communityId, {
      firstName: "Tadala",
      birthdayMonth: 3,
      birthdayDay: 14,
    });
    const viewer = await seedMember(t, communityId, { firstName: "Viewer" });
    const { accessToken } = await generateTokens(viewer);

    const profile = await t.query(api.functions.users.getProfile, {
      token: accessToken,
      userId: birthdayUser,
      communityId,
    });

    expect(profile?.isBirthdayToday).toBe(true);
    vi.useRealTimers();
  });

  test("is false on a day that is not their birthday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T16:00:00Z"));
    const t = convexTest(schema, modules);
    const communityId = await seedCommunity(t);
    const birthdayUser = await seedMember(t, communityId, {
      firstName: "Tadala",
      dateOfBirth: DOB_MAR_14,
    });
    const viewer = await seedMember(t, communityId, { firstName: "Viewer" });
    const { accessToken } = await generateTokens(viewer);

    const profile = await t.query(api.functions.users.getProfile, {
      token: accessToken,
      userId: birthdayUser,
      communityId,
    });

    expect(profile?.isBirthdayToday).toBe(false);
    vi.useRealTimers();
  });

  test("never returns the birth date itself, only the boolean", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    const t = convexTest(schema, modules);
    const communityId = await seedCommunity(t);
    const birthdayUser = await seedMember(t, communityId, {
      firstName: "Tadala",
      dateOfBirth: DOB_MAR_14,
    });
    const viewer = await seedMember(t, communityId, { firstName: "Viewer" });
    const { accessToken } = await generateTokens(viewer);

    const profile = await t.query(api.functions.users.getProfile, {
      token: accessToken,
      userId: birthdayUser,
      communityId,
    });

    expect(profile).not.toHaveProperty("dateOfBirth");
    expect(JSON.stringify(profile)).not.toContain(String(DOB_MAR_14));
    // The user never filled in the shareable pair, so it stays empty — the
    // badge must not be a back door that populates it.
    expect(profile?.birthdayMonth).toBeNull();
    expect(profile?.birthdayDay).toBeNull();
    vi.useRealTimers();
  });

  test("hides it from an anonymous viewer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    const t = convexTest(schema, modules);
    const communityId = await seedCommunity(t);
    const birthdayUser = await seedMember(t, communityId, {
      firstName: "Tadala",
      dateOfBirth: DOB_MAR_14,
    });

    const profile = await t.query(api.functions.users.getProfile, {
      userId: birthdayUser,
      communityId,
    });

    // The profile still renders for anonymous viewers (it is public by
    // design) — but a caller with no token cannot poll this flag daily to
    // recover a member's birth month and day.
    expect(profile).not.toBeNull();
    expect(profile?.isBirthdayToday).toBe(false);
    vi.useRealTimers();
  });

  test("hides it from a viewer outside the community", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    const t = convexTest(schema, modules);
    const communityId = await seedCommunity(t);
    const otherCommunityId = await t.run(async (ctx) =>
      ctx.db.insert("communities", {
        name: "Elsewhere",
        slug: "elsewhere",
        timezone: "America/New_York",
        isPublic: true,
      }),
    );
    const birthdayUser = await seedMember(t, communityId, {
      firstName: "Tadala",
      dateOfBirth: DOB_MAR_14,
    });
    const outsider = await seedMember(t, otherCommunityId, {
      firstName: "Outsider",
    });
    const { accessToken } = await generateTokens(outsider);

    const profile = await t.query(api.functions.users.getProfile, {
      token: accessToken,
      userId: birthdayUser,
      communityId,
    });

    expect(profile?.isBirthdayToday).toBe(false);
    vi.useRealTimers();
  });
});

describe("messaging.directMessages.getDirectInbox", () => {
  test("flags the birthday of the person on the other side of a DM", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    const t = convexTest(schema, modules);
    const communityId = await seedCommunity(t);
    const me = await seedMember(t, communityId, { firstName: "Me" });
    const them = await seedMember(t, communityId, {
      firstName: "Tadala",
      dateOfBirth: DOB_MAR_14,
    });

    await t.run(async (ctx) => {
      const channelId = await ctx.db.insert("chatChannels", {
        communityId,
        channelType: "dm",
        name: "DM",
        slug: "dm-1",
        isAdHoc: true,
        isArchived: false,
        createdById: me,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
        memberCount: 2,
      });
      for (const [userId, displayName] of [
        [me, "Me Tester"],
        [them, "Tadala Tester"],
      ] as const) {
        await ctx.db.insert("chatChannelMembers", {
          channelId,
          userId,
          displayName,
          role: "member",
          isMuted: false,
          requestState: "accepted",
          joinedAt: Date.now(),
        });
      }
    });

    const { accessToken } = await generateTokens(me);
    const inbox = await t.query(
      api.functions.messaging.directMessages.getDirectInbox,
      { token: accessToken, communityId },
    );

    const row = inbox.find((r) => r.otherMembers.length === 1);
    expect(row).toBeDefined();
    expect(row?.otherMembers[0]?.isBirthdayToday).toBe(true);
    vi.useRealTimers();
  });
});
