import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

type SeededContext = {
  leaderId: Id<"users">;
  communityId: Id<"communities">;
  groupId: Id<"groups">;
};

async function seedGroupWithLeader(
  t: ReturnType<typeof convexTest>,
  withCustomColumns: boolean = true
): Promise<SeededContext> {
  return t.run(async (ctx) => {
    const timestamp = Date.now();
    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "One",
      phone: "+12025550100",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Import Test Community",
      slug: "import-test-community",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    await ctx.db.insert("userCommunities", {
      userId: leaderId,
      communityId,
      roles: 4,
      status: 1,
      createdAt: timestamp,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "CSV Group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(withCustomColumns
        ? {
            followupColumnConfig: {
              columnOrder: [],
              hiddenColumns: [],
              customFields: [
                { slot: "customText1", name: "Neighborhood", type: "text" },
                { slot: "customNum1", name: "Volunteer Level", type: "number" },
                { slot: "customBool1", name: "Wants Prayer", type: "boolean" },
                {
                  slot: "customText2",
                  name: "Contact Preference",
                  type: "dropdown",
                  options: ["Email", "Text", "Call"],
                },
                {
                  slot: "customText3",
                  name: "Interests",
                  type: "multiselect",
                  options: ["Music", "Sports", "Art", "Tech"],
                },
              ],
            },
          }
        : {}),
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    return { leaderId, communityId, groupId };
  });
}

describe("follow-up CSV import", () => {
  test("preview reports custom field update actions and ignored invalid values", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    const preview = await t.mutation(api.functions.memberFollowups.previewCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "Ada",
          phone: "(202) 555-0111",
          customFieldValues: {
            customText1: "South",
            customNum1: "2",
            customBool1: "yes",
            customText2: "Text",
          },
        },
        {
          rowNumber: 3,
          firstName: "Grace",
          phone: "(202) 555-0112",
          customFieldValues: {
            customNum1: "not-a-number",
            customBool1: "maybe",
            customText2: "Carrier pigeon",
          },
        },
      ],
    });

    expect(preview.summary.readyRows).toBe(2);
    expect(preview.summary.customFieldUpdates).toBe(1);
    expect(preview.rows[0].actions.customFields).toBe("update");
    expect(preview.rows[1].actions.customFields).toBe("none");
    expect(preview.rows[1].reasons).toContain("invalid_custom_number_ignored");
    expect(preview.rows[1].reasons).toContain("invalid_custom_boolean_ignored");
    expect(preview.rows[1].reasons).toContain("invalid_custom_dropdown_option_ignored");
  });

  test("apply writes parsed custom field values to existing score doc", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    const setup = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const existingUserId = await ctx.db.insert("users", {
        firstName: "Existing",
        lastName: "Member",
        phone: "+12025550199",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await ctx.db.insert("userCommunities", {
        userId: existingUserId,
        communityId,
        roles: 1,
        status: 1,
        createdAt: timestamp,
      });

      const groupMemberId = await ctx.db.insert("groupMembers", {
        groupId,
        userId: existingUserId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });

      await ctx.db.insert("memberFollowupScores", {
        groupId,
        groupMemberId,
        userId: existingUserId,
        firstName: "Existing",
        lastName: "Member",
        score1: 50,
        score2: 50,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 50,
        connectionScore: 50,
        followupScore: 50,
        missedMeetings: 0,
        consecutiveMissed: 0,
        scoreIds: ["default_attendance", "default_connection"],
        updatedAt: timestamp,
      });

      return { groupMemberId };
    });

    await t.mutation(api.functions.memberFollowups.applyCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "Existing",
          phone: "(202) 555-0199",
          customFieldValues: {
            customText1: "North",
            customNum1: "7",
            customBool1: "true",
            customText2: "Email",
          },
        },
      ],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const updatedScore = await t.run(async (ctx) =>
      ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) => q.eq("groupMemberId", setup.groupMemberId))
        .first()
    );

    expect(updatedScore?.customText1).toBe("North");
    expect(updatedScore?.customNum1).toBe(7);
    expect(updatedScore?.customBool1).toBe(true);
    expect(updatedScore?.customText2).toBe("Email");
  });

  test("non-fatal warnings still lookup existing user by phone", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    await t.run(async (ctx) => {
      const timestamp = Date.now();
      const existingUserId = await ctx.db.insert("users", {
        firstName: "Jamie",
        lastName: "Original",
        phone: "+12025550222",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await ctx.db.insert("userCommunities", {
        userId: existingUserId,
        communityId,
        roles: 1,
        status: 1,
        createdAt: timestamp,
      });

      await ctx.db.insert("groupMembers", {
        groupId,
        userId: existingUserId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    });

    const preview = await t.mutation(api.functions.memberFollowups.previewCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "Jamie",
          lastName: "Updated",
          phone: "(202) 555-0222",
          customFieldValues: {
            customNum1: "not-a-number",
          },
        },
      ],
    });

    expect(preview.summary.usersToCreate).toBe(0);
    expect(preview.summary.usersToUpdate).toBe(1);
    expect(preview.rows[0].status).toBe("ready");
    expect(preview.rows[0].actions.user).toBe("update");
    expect(preview.rows[0].reasons).toContain("invalid_custom_number_ignored");
  });

  test("preview parses multiselect semicolon-separated values correctly", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    const preview = await t.mutation(api.functions.memberFollowups.previewCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "Multi",
          phone: "(202) 555-0150",
          customFieldValues: {
            customText3: "Music; Sports; Art",
          },
        },
        {
          rowNumber: 3,
          firstName: "Partial",
          phone: "(202) 555-0151",
          customFieldValues: {
            customText3: "Music; Cooking; Tech",
          },
        },
        {
          rowNumber: 4,
          firstName: "AllInvalid",
          phone: "(202) 555-0152",
          customFieldValues: {
            customText3: "Cooking; Dance",
          },
        },
      ],
    });

    expect(preview.summary.readyRows).toBe(3);
    // Row 1: all valid multiselect options
    expect(preview.rows[0].actions.customFields).toBe("update");
    // Row 2: partial valid — "Cooking" is invalid
    expect(preview.rows[1].reasons).toContain("invalid_custom_multiselect_option_ignored");
    // Row 3: all invalid — no custom field update
    expect(preview.rows[2].actions.customFields).toBe("none");
    expect(preview.rows[2].reasons).toContain("invalid_custom_multiselect_option_ignored");
  });

  test("apply writes semicolon-separated multiselect values to score doc", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    const setup = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const userId = await ctx.db.insert("users", {
        firstName: "MultiUser",
        lastName: "Test",
        phone: "+12025550160",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 1,
        status: 1,
        createdAt: timestamp,
      });

      const groupMemberId = await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });

      await ctx.db.insert("memberFollowupScores", {
        groupId,
        groupMemberId,
        userId,
        firstName: "MultiUser",
        lastName: "Test",
        score1: 50,
        score2: 50,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 50,
        connectionScore: 50,
        followupScore: 50,
        missedMeetings: 0,
        consecutiveMissed: 0,
        scoreIds: ["default_attendance", "default_connection"],
        updatedAt: timestamp,
      });

      return { groupMemberId };
    });

    await t.mutation(api.functions.memberFollowups.applyCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "MultiUser",
          phone: "(202) 555-0160",
          customFieldValues: {
            customText3: "music; Sports; art",
          },
        },
      ],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const updatedScore = await t.run(async (ctx) =>
      ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) => q.eq("groupMemberId", setup.groupMemberId))
        .first()
    );

    // Should be case-corrected to match configured options
    expect(updatedScore?.customText3).toBe("Music; Sports; Art");
  });

  test("multiselect deduplicates repeated values in CSV", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    const preview = await t.mutation(api.functions.memberFollowups.previewCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "DupeTest",
          phone: "(202) 555-0170",
          customFieldValues: {
            customText3: "Music; Music; Sports",
          },
        },
      ],
    });

    expect(preview.rows[0].actions.customFields).toBe("update");
  });

  test("preview parses added date, status, assignee, and connection point with row-level warnings", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    await t.run(async (ctx) => {
      const timestamp = Date.now();
      const rachelId = await ctx.db.insert("users", {
        firstName: "Rachel",
        lastName: "Leader",
        phone: "+12025550170",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: rachelId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    });

    const preview = await t.mutation(api.functions.memberFollowups.previewCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "Jordan",
          phone: "(202) 555-0155",
          addedAt: "1/4/2026",
          status: "Orange",
          assignee: "Rachel",
          connectionPoint: "Team, Dinner Party",
        },
        {
          rowNumber: 3,
          firstName: "Bad Data",
          phone: "(202) 555-0156",
          addedAt: "not-a-date",
          status: "Blue",
          assignee: "Unknown Person",
        },
      ],
    });

    expect(preview.summary.readyRows).toBe(2);
    expect(preview.rows[0].status).toBe("ready");
    expect(preview.rows[0].reasons).not.toContain("invalid_added_at_ignored");
    expect(preview.rows[1].reasons).toContain("invalid_added_at_ignored");
    expect(preview.rows[1].reasons).toContain("invalid_status_ignored");
    expect(preview.rows[1].reasons).toContain("unknown_assignee_ignored");
  });

  test("apply imports status, assignee, connection point, and uses added date for new member", async () => {
    const t = convexTest(schema, modules);
    const { leaderId, communityId, groupId } = await seedGroupWithLeader(t);
    const token = (await generateTokens(leaderId, communityId)).accessToken;

    const setup = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const mikeId = await ctx.db.insert("users", {
        firstName: "Mike",
        lastName: "Leader",
        phone: "+12025550180",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: mikeId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });

      return { mikeId };
    });

    await t.mutation(api.functions.memberFollowups.applyCsvImport, {
      token,
      groupId,
      rows: [
        {
          rowNumber: 2,
          firstName: "Casey",
          lastName: "Imported",
          phone: "(202) 555-0188",
          addedAt: "1/4/2026",
          status: "Green",
          assignee: "Mike",
          connectionPoint: "Team, Dinner Party",
          notes: "Reached out and connected",
        },
      ],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const result = await t.run(async (ctx) => {
      const importedUser = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", "+12025550188"))
        .first();
      if (!importedUser) return null;

      const groupMember = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", importedUser._id))
        .first();
      if (!groupMember) return null;

      const scoreDoc = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) => q.eq("groupMemberId", groupMember._id))
        .first();

      return {
        groupMember,
        scoreDoc,
      };
    });

    expect(result).not.toBeNull();
    expect(result?.groupMember.joinedAt).toBe(new Date("1/4/2026").getTime());
    expect(result?.scoreDoc?.status).toBe("green");
    expect(result?.scoreDoc?.assigneeId).toBe(setup.mikeId);
    expect(result?.scoreDoc?.connectionPoint).toBe("Team, Dinner Party");
  });
});
