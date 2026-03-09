import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

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
});
