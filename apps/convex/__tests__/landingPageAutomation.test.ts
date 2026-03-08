/**
 * Integration tests for landing page automation rules.
 *
 * Tests the full setCustomFieldsAndNotes mutation flow including:
 * - Condition evaluation against submitted custom fields
 * - Assignee lookup by phone number
 * - Score doc creation and patching
 * - Silent failure modes (with logging)
 *
 * Run with: npx vitest run apps/convex/__tests__/landingPageAutomation.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";

vi.useFakeTimers();

// ============================================================================
// Constants & Types
// ============================================================================

const ROLES = {
  MEMBER: 1,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

const MEMBERSHIP_STATUS = {
  ACTIVE: 1,
} as const;

type AutomationRule = {
  id: string;
  name: string;
  isEnabled: boolean;
  condition: {
    field: string;
    operator: string;
    value?: string;
  };
  action: {
    type: string;
    assigneePhone?: string;
    assigneeUserId?: Id<"users">;
  };
};

type CustomField = {
  slot?: string;
  label: string;
  value: any;
  includeInNotes?: boolean;
};

// ============================================================================
// Seed helper
// ============================================================================

async function seedAutomationTestData(t: ReturnType<typeof convexTest>) {
  const timestamp = Date.now();

  // Create community
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Automation Test Community",
      slug: "AUTOTEST",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Create group type
  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Announcements",
      slug: "announcements",
      description: "Announcements",
      createdAt: timestamp,
      isActive: true,
      displayOrder: 0,
    });
  });

  // Create announcement group
  const announcementGroupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Announcements",
      isAnnouncementGroup: true,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Create submitting user (the person who fills out the form)
  const submittingUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "New",
      lastName: "Visitor",
      phone: "+19175550000",
      phoneVerified: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Create group membership for submitting user
  const groupMemberId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupMembers", {
      groupId: announcementGroupId,
      userId: submittingUserId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
  });

  // Create assignee user (the leader who gets assigned)
  const assigneeUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Seyi",
      lastName: "Leader",
      phone: "+12026150407",
      phoneVerified: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Create second assignee for multi-rule tests
  const assignee2UserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Kids",
      lastName: "Leader",
      phone: "+12487620459",
      phoneVerified: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  return {
    communityId,
    announcementGroupId,
    groupTypeId,
    submittingUserId,
    groupMemberId,
    assigneeUserId,
    assignee2UserId,
  };
}

// ============================================================================
// Helper: read scoreDoc for the group member
// ============================================================================

async function getScoreDoc(
  t: ReturnType<typeof convexTest>,
  groupMemberId: Id<"groupMembers">
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q) => q.eq("groupMemberId", groupMemberId))
      .first();
  });
}

// ============================================================================
// Tests: Happy path
// ============================================================================

describe("Landing page automation – happy path", () => {
  test("text field 'contains' triggers assignment", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Long Island City",
        includeInNotes: true,
      },
    ];

    const automationRules: AutomationRule[] = [
      {
        id: "rule_1",
        name: "Assign to Seyi",
        isEnabled: true,
        condition: {
          field: "customText2",
          operator: "contains",
          value: "long island city",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "2026150407",
        },
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: true,
        automationRules,
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    expect(scoreDoc!.assigneeId).toBe(data.assigneeUserId);
  });

  test("boolean 'is_true' triggers assignment", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      { label: "Fount Kids/Youth", value: true, includeInNotes: true },
    ];

    const automationRules: AutomationRule[] = [
      {
        id: "rule_2",
        name: "Interested in Kids Team",
        isEnabled: true,
        condition: {
          field: "Fount Kids/Youth",
          operator: "is_true",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "2487620459",
        },
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: false,
        automationRules,
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    expect(scoreDoc!.assigneeId).toBe(data.assignee2UserId);
  });
});

// ============================================================================
// Tests: Condition not met
// ============================================================================

describe("Landing page automation – condition not met", () => {
  test("no assignment when text value does not match", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Brooklyn",
        includeInNotes: true,
      },
    ];

    const automationRules: AutomationRule[] = [
      {
        id: "rule_1",
        name: "Assign to Seyi",
        isEnabled: true,
        condition: {
          field: "customText2",
          operator: "contains",
          value: "long island city",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "2026150407",
        },
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: false,
        automationRules,
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    expect(scoreDoc!.assigneeId).toBeUndefined();
  });

  test("no assignment when boolean field is absent (unchecked optional)", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    // Only text field submitted, no boolean
    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Manhattan",
        includeInNotes: true,
      },
    ];

    const automationRules: AutomationRule[] = [
      {
        id: "rule_2",
        name: "Interested in Kids Team",
        isEnabled: true,
        condition: {
          field: "Fount Kids/Youth",
          operator: "is_true",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "2487620459",
        },
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: false,
        automationRules,
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    expect(scoreDoc!.assigneeId).toBeUndefined();
  });
});

// ============================================================================
// Tests: Failure modes
// ============================================================================

describe("Landing page automation – failure modes", () => {
  test("assignee phone not found does not set assignee", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Long Island City",
        includeInNotes: true,
      },
    ];

    // Phone number that doesn't match any user
    const automationRules: AutomationRule[] = [
      {
        id: "rule_1",
        name: "Assign to Unknown",
        isEnabled: true,
        condition: {
          field: "customText2",
          operator: "contains",
          value: "long island city",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "9999999999", // No user with this phone
        },
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: false,
        automationRules,
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    // Condition matched but assignee not found → no assignment
    expect(scoreDoc!.assigneeId).toBeUndefined();
  });

  test("disabled rule is skipped even if condition matches", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Long Island City",
        includeInNotes: true,
      },
    ];

    const automationRules: AutomationRule[] = [
      {
        id: "rule_1",
        name: "Assign to Seyi (disabled)",
        isEnabled: false, // Disabled
        condition: {
          field: "customText2",
          operator: "contains",
          value: "long island city",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "2026150407",
        },
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: false,
        automationRules,
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    expect(scoreDoc!.assigneeId).toBeUndefined();
  });

  test("first matching rule wins when multiple rules match", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Long Island City",
        includeInNotes: true,
      },
      { label: "Fount Kids/Youth", value: true, includeInNotes: true },
    ];

    // Both rules match, but first one should win
    const automationRules: AutomationRule[] = [
      {
        id: "rule_1",
        name: "Assign to Seyi",
        isEnabled: true,
        condition: {
          field: "customText2",
          operator: "contains",
          value: "long island city",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "2026150407",
        },
      },
      {
        id: "rule_2",
        name: "Interested in Kids Team",
        isEnabled: true,
        condition: {
          field: "Fount Kids/Youth",
          operator: "is_true",
        },
        action: {
          type: "set_assignee",
          assigneePhone: "2487620459",
        },
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: false,
        automationRules,
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    // First rule's assignee wins
    expect(scoreDoc!.assigneeId).toBe(data.assigneeUserId);
  });

  test("no announcement group does not throw", async () => {
    const t = convexTest(schema, modules);
    const timestamp = Date.now();

    // Create community WITHOUT announcement group
    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "No Announcement Community",
        slug: "NOANN",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Test",
        lastName: "User",
        phone: "+19175550099",
        phoneVerified: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    // Should complete without throwing
    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId,
        userId,
        customFields: [],
        generateNoteSummary: false,
        automationRules: [
          {
            id: "rule_1",
            name: "Test Rule",
            isEnabled: true,
            condition: {
              field: "customText1",
              operator: "equals",
              value: "test",
            },
            action: { type: "set_assignee", assigneePhone: "5555550000" },
          },
        ],
      }
    );

    // No assertion needed — just verifying it doesn't throw
  });
});

// ============================================================================
// Tests: Custom fields and notes
// ============================================================================

describe("Landing page automation – custom fields stored correctly", () => {
  test("custom field values are written to scoreDoc", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Long Island City",
        includeInNotes: true,
      },
      {
        slot: "customBool1",
        label: "Volunteer?",
        value: true,
        includeInNotes: true,
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: false,
        automationRules: [],
      }
    );

    const scoreDoc = await getScoreDoc(t, data.groupMemberId);
    expect(scoreDoc).not.toBeNull();
    expect((scoreDoc as any).customText2).toBe("Long Island City");
    expect((scoreDoc as any).customBool1).toBe(true);
  });

  test("notes summary is generated when enabled", async () => {
    const t = convexTest(schema, modules);
    const data = await seedAutomationTestData(t);

    const customFields: CustomField[] = [
      {
        slot: "customText2",
        label: "Where do you live?",
        value: "Long Island City",
        includeInNotes: true,
      },
    ];

    await t.mutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: data.communityId,
        userId: data.submittingUserId,
        customFields,
        generateNoteSummary: true,
        automationRules: [],
      }
    );

    // Check that a note was created
    const note = await t.run(async (ctx) => {
      return await ctx.db
        .query("memberFollowups")
        .filter((q) =>
          q.eq(q.field("groupMemberId"), data.groupMemberId)
        )
        .first();
    });

    expect(note).not.toBeNull();
    expect(note!.content).toContain("Landing Page Submission");
    expect(note!.content).toContain("Where do you live?: Long Island City");
  });
});
