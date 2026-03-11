import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

async function seedAdminAndGroup(t: ReturnType<typeof convexTest>): Promise<{
  adminId: Id<"users">;
  communityId: Id<"communities">;
  groupId: Id<"groups">;
}> {
  return t.run(async (ctx) => {
    const timestamp = Date.now();
    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      phone: "+12025551000",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Validation Community",
      slug: "validation-community",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: 4,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Validation Group Type",
      slug: "validation-group-type",
      isActive: true,
      displayOrder: 1,
      createdAt: timestamp,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Validation Group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: adminId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    return { adminId, communityId, groupId };
  });
}

describe("follow-up multiselect validation", () => {
  test("rejects empty options for follow-up multiselect fields", async () => {
    const t = convexTest(schema, modules);
    const { adminId, communityId, groupId } = await seedAdminAndGroup(t);
    const token = (await generateTokens(adminId, communityId)).accessToken;

    await expect(
      t.mutation(api.functions.groups.mutations.saveFollowupColumnConfig, {
        token,
        groupId,
        followupColumnConfig: {
          columnOrder: [],
          hiddenColumns: [],
          customFields: [
            {
              slot: "customText1",
              name: "Contact Preference",
              type: "multiselect",
              options: [],
            },
          ],
        },
      })
    ).rejects.toThrow(/requires at least one option/i);
  });

  test("rejects empty options for landing page dropdown fields", async () => {
    const t = convexTest(schema, modules);
    const { adminId, communityId } = await seedAdminAndGroup(t);
    const token = (await generateTokens(adminId, communityId)).accessToken;

    await expect(
      t.mutation(api.functions.communityLandingPage.saveConfig, {
        token,
        communityId,
        isEnabled: true,
        title: "Welcome",
        description: "Landing page",
        submitButtonText: "Submit",
        successMessage: "Thanks!",
        generateNoteSummary: true,
        requireZipCode: false,
        requireBirthday: false,
        formFields: [
          {
            slot: "customText1",
            label: "Communication Preference",
            type: "dropdown",
            required: false,
            order: 0,
            options: [],
            includeInNotes: true,
          },
        ],
        automationRules: [],
      })
    ).rejects.toThrow(/requires at least one option/i);
  });

  test("allows saving when legacy invalid select field already exists", async () => {
    const t = convexTest(schema, modules);
    const { adminId, communityId, groupId } = await seedAdminAndGroup(t);
    const token = (await generateTokens(adminId, communityId)).accessToken;

    await t.run(async (ctx) => {
      await ctx.db.patch(groupId, {
        followupColumnConfig: {
          columnOrder: [],
          hiddenColumns: [],
          customFields: [
            {
              slot: "customText1",
              name: "Legacy Dropdown",
              type: "dropdown",
              options: [],
            },
          ],
        },
      });
    });

    await expect(
      t.mutation(api.functions.groups.mutations.saveFollowupColumnConfig, {
        token,
        groupId,
        followupColumnConfig: {
          columnOrder: [],
          hiddenColumns: [],
          customFields: [
            {
              slot: "customText1",
              name: "Legacy Dropdown",
              type: "dropdown",
              options: [],
            },
            {
              slot: "customText2",
              name: "Needs Follow-up Mode",
              type: "multiselect",
              options: ["Call", "Text", "In-Person"],
            },
          ],
        },
      })
    ).resolves.toEqual({ success: true });
  });

  test("supports hidden landing fields and full-width button fields", async () => {
    const t = convexTest(schema, modules);
    const { adminId, communityId } = await seedAdminAndGroup(t);
    const token = (await generateTokens(adminId, communityId)).accessToken;

    await t.run(async (ctx) => {
      const groupType = await ctx.db
        .query("groupTypes")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first();

      if (!groupType) throw new Error("Missing group type");

      await ctx.db.insert("groups", {
        communityId,
        groupTypeId: groupType._id,
        name: "Announcements",
        isAnnouncementGroup: true,
        isArchived: false,
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        followupColumnConfig: {
          columnOrder: [],
          hiddenColumns: [],
          customFields: [],
        },
      });
    });

    await expect(
      t.mutation(api.functions.communityLandingPage.saveConfig, {
        token,
        communityId,
        isEnabled: true,
        title: "Welcome",
        description: "Landing page",
        submitButtonText: "Submit",
        successMessage: "Thanks!",
        generateNoteSummary: true,
        requireZipCode: false,
        requireBirthday: false,
        formFields: [
          {
            slot: "customText1",
            label: "Internal Follow-up Label",
            type: "text",
            required: false,
            order: 0,
            includeInNotes: true,
            showOnLanding: false,
          },
          {
            label: "Visit our website",
            type: "button",
            buttonUrl: "https://example.com",
            required: false,
            order: 1,
            showOnLanding: true,
          },
        ],
        automationRules: [],
      })
    ).resolves.toEqual({ success: true });

    const result = await t.query(api.functions.communityLandingPage.getBySlug, {
      slug: "validation-community",
    });
    expect(result?.formFields[0].showOnLanding).toBe(false);
    expect(result?.formFields[1].type).toBe("button");

    const syncedCustomFields = await t.run(async (ctx) => {
      const announcementGroup = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
        .first();
      return announcementGroup?.followupColumnConfig?.customFields ?? [];
    });

    expect(syncedCustomFields).toEqual([
      {
        slot: "customText1",
        name: "Internal Follow-up Label",
        type: "text",
      },
    ]);
  });
});

