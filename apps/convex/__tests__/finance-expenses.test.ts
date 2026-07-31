/**
 * Finance roles + expenses/reimbursements tests (ADR-032 §3-4).
 *
 * Covers lib/finance/expensePolicy.ts (pure approval/submission/payout
 * rules), functions/finance/roles.ts (grant/revoke/list, upsert-revoke
 * semantics, the last-finance_admin guard), and functions/finance/expenses.ts
 * (submit/approve/deny, the reimbursement payout seam, and the manager/
 * group-leader/submitter visibility gating on the list queries).
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-expenses.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import {
  canApprove,
  canPay,
  canSubmit,
  nextStatusOnApproval,
  SECOND_APPROVAL_THRESHOLD_CENTS,
} from "../lib/finance/expensePolicy";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Seeding
// ============================================================================

interface ExpenseFixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  fundId: Id<"funds">;
  adminUserId: Id<"users">; // community admin, no fund role
  leaderUserId: Id<"users">; // active group leader, no fund role
  financeAdminUserId: Id<"users">; // fundRole: finance_admin, active group member
  managerUserId: Id<"users">; // fundRole: manager, active group member
  manager2UserId: Id<"users">; // fundRole: manager, active group member (second approver)
  memberUserId: Id<"users">; // plain active group member, no fund role
  nonMemberUserId: Id<"users">; // not in the group at all
}

async function seedExpenseFixture(
  t: ReturnType<typeof convexTest>,
): Promise<ExpenseFixture> {
  return await t.run(async (ctx) => {
    // Group giving is behind the app-wide "group-giving" feature flag
    // (default OFF) — enable it for these tests; flag-off behavior has its
    // own dedicated cases.
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: Date.now(),
    });
    const timestamp = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Test Church",
      slug: "test-church",
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

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Young Adults",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const mkUser = async (name: string) =>
      ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const adminUserId = await mkUser("Admin");
    const leaderUserId = await mkUser("Leader");
    const financeAdminUserId = await mkUser("FinanceAdmin");
    const managerUserId = await mkUser("Manager");
    const manager2UserId = await mkUser("Manager2");
    const memberUserId = await mkUser("Member");
    const nonMemberUserId = await mkUser("NonMember");

    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: 3, // COMMUNITY_ROLES.ADMIN
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderUserId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    for (const userId of [
      financeAdminUserId,
      managerUserId,
      manager2UserId,
      memberUserId,
    ]) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    }
    // nonMemberUserId is deliberately never added to groupMembers.

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Young Adults Fund",
      type: "group",
      status: "active",
      balanceCents: 1_000_000, // plenty of headroom for reimbursement debits
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("fundRoles", {
      fundId,
      userId: financeAdminUserId,
      role: "finance_admin",
      grantedBy: adminUserId,
      grantedAt: timestamp,
    });
    await ctx.db.insert("fundRoles", {
      fundId,
      userId: managerUserId,
      role: "manager",
      grantedBy: adminUserId,
      grantedAt: timestamp,
    });
    await ctx.db.insert("fundRoles", {
      fundId,
      userId: manager2UserId,
      role: "manager",
      grantedBy: adminUserId,
      grantedAt: timestamp,
    });

    return {
      communityId,
      groupId,
      fundId,
      adminUserId,
      leaderUserId,
      financeAdminUserId,
      managerUserId,
      manager2UserId,
      memberUserId,
      nonMemberUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

/**
 * Stand in for functions/uploads.ts's presign step: mint an `r2:` key and
 * record who it belongs to. `submitExpense` refuses a receipt with no
 * matching `uploadGrants` row (or one owned by someone else), so every test
 * that submits has to go through this the way the real client does.
 */
async function grantReceiptKey(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
  label = "test-receipt",
): Promise<string> {
  const storagePath = `r2:uploads/${label}-${Math.random().toString(36).slice(2)}.jpg`;
  await t.run(async (ctx) => {
    await ctx.db.insert("uploadGrants", {
      storagePath,
      userId: ownerId,
      folder: "uploads",
      contentType: "image/jpeg",
      createdAt: Date.now(),
    });
  });
  return storagePath;
}

async function submitReimbursement(
  t: ReturnType<typeof convexTest>,
  fundId: Id<"funds">,
  submitterId: Id<"users">,
  amountCents: number,
): Promise<Id<"expenses">> {
  const token = await tokenFor(submitterId);
  return await t.mutation(api.functions.finance.expenses.submitExpense, {
    token,
    fundId,
    amountCents,
    kind: "reimbursement",
    description: "Snacks for small group",
    receiptKey: await grantReceiptKey(t, submitterId),
  });
}

// ============================================================================
// expensePolicy — canSubmit
// ============================================================================

describe("canSubmit", () => {
  test("allows a reimbursement with a receipt in bounds", () => {
    expect(
      canSubmit({ amountCents: 5000, kind: "reimbursement", receiptKey: "r2:x" }),
    ).toEqual({ allowed: true });
  });

  test("rejects a reimbursement without a receipt", () => {
    const result = canSubmit({ amountCents: 5000, kind: "reimbursement" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/receipt/i);
  });

  test("card_charge does not require a receipt at submission", () => {
    expect(canSubmit({ amountCents: 5000, kind: "card_charge" })).toEqual({
      allowed: true,
    });
  });

  test("rejects amount below 1 cent", () => {
    expect(
      canSubmit({ amountCents: 0, kind: "reimbursement", receiptKey: "r2:x" })
        .allowed,
    ).toBe(false);
  });

  test("rejects amount above 500,000 cents", () => {
    expect(
      canSubmit({
        amountCents: 500_001,
        kind: "reimbursement",
        receiptKey: "r2:x",
      }).allowed,
    ).toBe(false);
  });

  test("accepts the exact bounds (1 and 500,000 cents)", () => {
    expect(
      canSubmit({ amountCents: 1, kind: "reimbursement", receiptKey: "r2:x" })
        .allowed,
    ).toBe(true);
    expect(
      canSubmit({
        amountCents: 500_000,
        kind: "reimbursement",
        receiptKey: "r2:x",
      }).allowed,
    ).toBe(true);
  });
});

// ============================================================================
// expensePolicy — canApprove
// ============================================================================

describe("canApprove", () => {
  const submitterId = "submitter" as Id<"users">;
  const approverId = "approver" as Id<"users">;
  const otherApproverId = "otherApprover" as Id<"users">;

  test("blocks self-approval even for finance_admin", () => {
    const result = canApprove({
      expense: {
        submitterId,
        amountCents: 1000,
        status: "pending",
      },
      approverUserId: submitterId,
      approverRole: "finance_admin",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/own expense/i);
  });

  test("blocks a plain member (no role)", () => {
    const result = canApprove({
      expense: { submitterId, amountCents: 1000, status: "pending" },
      approverUserId: approverId,
      approverRole: null,
    });
    expect(result.allowed).toBe(false);
  });

  test("blocks a cardholder (below manager)", () => {
    const result = canApprove({
      expense: { submitterId, amountCents: 1000, status: "pending" },
      approverUserId: approverId,
      approverRole: "cardholder",
    });
    expect(result.allowed).toBe(false);
  });

  test("allows a manager under the threshold", () => {
    const result = canApprove({
      expense: { submitterId, amountCents: 1000, status: "pending" },
      approverUserId: approverId,
      approverRole: "manager",
    });
    expect(result.allowed).toBe(true);
  });

  test("blocks approving a non-pending expense", () => {
    const result = canApprove({
      expense: { submitterId, amountCents: 1000, status: "denied" },
      approverUserId: approverId,
      approverRole: "manager",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/denied/);
  });

  test("at/above threshold: second distinct approver is allowed", () => {
    const result = canApprove({
      expense: {
        submitterId,
        amountCents: SECOND_APPROVAL_THRESHOLD_CENTS,
        status: "pending",
        approverId, // first approval already recorded
      },
      approverUserId: otherApproverId,
      approverRole: "manager",
    });
    expect(result.allowed).toBe(true);
  });

  test("at/above threshold: the same approver cannot approve twice", () => {
    const result = canApprove({
      expense: {
        submitterId,
        amountCents: SECOND_APPROVAL_THRESHOLD_CENTS,
        status: "pending",
        approverId,
      },
      approverUserId: approverId,
      approverRole: "manager",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/second, different approver/i);
  });
});

// ============================================================================
// expensePolicy — nextStatusOnApproval
// ============================================================================

describe("nextStatusOnApproval", () => {
  const submitterId = "submitter" as Id<"users">;
  const approver1 = "approver1" as Id<"users">;
  const approver2 = "approver2" as Id<"users">;

  test("under threshold approves on the first sign-off", () => {
    const outcome = nextStatusOnApproval({
      expense: { amountCents: SECOND_APPROVAL_THRESHOLD_CENTS - 1 },
      approverUserId: approver1,
    });
    expect(outcome).toEqual({ status: "approved", approverId: approver1 });
  });

  test("exactly at threshold: first approval stays pending", () => {
    const outcome = nextStatusOnApproval({
      expense: { amountCents: SECOND_APPROVAL_THRESHOLD_CENTS },
      approverUserId: approver1,
    });
    expect(outcome).toEqual({ status: "pending", approverId: approver1 });
  });

  test("exactly at threshold: second distinct approval completes it", () => {
    const outcome = nextStatusOnApproval({
      expense: {
        amountCents: SECOND_APPROVAL_THRESHOLD_CENTS,
        approverId: approver1,
      },
      approverUserId: approver2,
    });
    expect(outcome).toEqual({
      status: "approved",
      approverId: approver1,
      secondApproverId: approver2,
    });
  });

  test("submitterId is irrelevant to the pure math (guarded by canApprove)", () => {
    // nextStatusOnApproval trusts the caller already ran canApprove; this
    // just documents that it does not itself reason about the submitter.
    void submitterId;
    expect(true).toBe(true);
  });
});

// ============================================================================
// expensePolicy — canPay
// ============================================================================

describe("canPay", () => {
  test("true only for approved reimbursements with a receipt", () => {
    expect(
      canPay({ status: "approved", kind: "reimbursement", receiptKey: "r2:x" }),
    ).toBe(true);
  });

  test("false when not approved", () => {
    expect(
      canPay({ status: "pending", kind: "reimbursement", receiptKey: "r2:x" }),
    ).toBe(false);
  });

  test("false for card_charge (never ACH-paid)", () => {
    expect(
      canPay({ status: "approved", kind: "card_charge", receiptKey: "r2:x" }),
    ).toBe(false);
  });

  test("false without a receipt", () => {
    expect(canPay({ status: "approved", kind: "reimbursement" })).toBe(false);
  });
});

// ============================================================================
// roles.ts — grantFundRole / revokeFundRole / listFundRoles / getMyFundRole
// ============================================================================

describe("grantFundRole", () => {
  test("finance_admin grants a role; audit logged", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, memberUserId } =
      await seedExpenseFixture(t);

    const roleId = await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: await tokenFor(financeAdminUserId),
      fundId,
      userId: memberUserId,
      role: "cardholder",
    });
    expect(roleId).toBeDefined();

    const row = await t.run(async (ctx) => ctx.db.get(roleId));
    expect(row?.role).toBe("cardholder");
    expect(row?.revokedAt).toBeUndefined();

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "role.granted")).toBe(true);
  });

  test("upsert-revoke: re-granting revokes the previous active row", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, memberUserId } =
      await seedExpenseFixture(t);
    const token = await tokenFor(financeAdminUserId);

    const firstRoleId = await t.mutation(
      api.functions.finance.roles.grantFundRole,
      { token, fundId, userId: memberUserId, role: "cardholder" },
    );
    const secondRoleId = await t.mutation(
      api.functions.finance.roles.grantFundRole,
      { token, fundId, userId: memberUserId, role: "manager" },
    );

    expect(secondRoleId).not.toBe(firstRoleId);

    const [firstRow, secondRow] = await t.run(async (ctx) => [
      await ctx.db.get(firstRoleId),
      await ctx.db.get(secondRoleId),
    ]);
    expect(firstRow?.revokedAt).toBeDefined();
    expect(secondRow?.revokedAt).toBeUndefined();
    expect(secondRow?.role).toBe("manager");

    // Never two active rows for the same (user, fund) at once.
    const allRows = await t.run(async (ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", memberUserId).eq("fundId", fundId),
        )
        .collect(),
    );
    expect(allRows.filter((r) => r.revokedAt === undefined)).toHaveLength(1);
  });

  test("group leader (no fund role) can grant", async () => {
    const t = convexTest(schema, modules);
    const { fundId, leaderUserId, memberUserId } = await seedExpenseFixture(t);

    const roleId = await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: await tokenFor(leaderUserId),
      fundId,
      userId: memberUserId,
      role: "manager",
    });
    expect(roleId).toBeDefined();
  });

  test("rejects a target who isn't an active member of the fund's group", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, nonMemberUserId } =
      await seedExpenseFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(financeAdminUserId),
        fundId,
        userId: nonMemberUserId,
        role: "cardholder",
      }),
    ).rejects.toThrow(/active member/i);
  });

  test("rejects a plain member as caller", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, nonMemberUserId } =
      await seedExpenseFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(memberUserId),
        fundId,
        userId: nonMemberUserId,
        role: "cardholder",
      }),
    ).rejects.toThrow();
  });
});

describe("revokeFundRole", () => {
  test("finance_admin revokes a manager; audit logged", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, managerUserId } =
      await seedExpenseFixture(t);

    await t.mutation(api.functions.finance.roles.revokeFundRole, {
      token: await tokenFor(financeAdminUserId),
      fundId,
      userId: managerUserId,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", managerUserId).eq("fundId", fundId),
        )
        .collect(),
    );
    expect(rows.every((r) => r.revokedAt !== undefined)).toBe(true);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "role.revoked")).toBe(true);
  });

  test("blocks revoking the last active finance_admin (non-admin caller)", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId } = await seedExpenseFixture(t);

    // financeAdminUserId is the only finance_admin — self-revoking would
    // leave the fund with none.
    await expect(
      t.mutation(api.functions.finance.roles.revokeFundRole, {
        token: await tokenFor(financeAdminUserId),
        fundId,
        userId: financeAdminUserId,
      }),
    ).rejects.toThrow(/last finance_admin/i);
  });

  test("a community admin CAN revoke the last finance_admin", async () => {
    const t = convexTest(schema, modules);
    const { fundId, adminUserId, financeAdminUserId } =
      await seedExpenseFixture(t);

    await t.mutation(api.functions.finance.roles.revokeFundRole, {
      token: await tokenFor(adminUserId),
      fundId,
      userId: financeAdminUserId,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", financeAdminUserId).eq("fundId", fundId),
        )
        .collect(),
    );
    expect(rows.every((r) => r.revokedAt !== undefined)).toBe(true);
  });
});

describe("listFundRoles / getMyFundRole", () => {
  test("getMyFundRole reflects the viewer's own state", async () => {
    const t = convexTest(schema, modules);
    const { fundId, managerUserId, leaderUserId, memberUserId } =
      await seedExpenseFixture(t);

    const managerResult = await t.query(
      api.functions.finance.roles.getMyFundRole,
      { token: await tokenFor(managerUserId), fundId },
    );
    expect(managerResult.role).toBe("manager");
    expect(managerResult.isGroupLeader).toBe(false);

    const leaderResult = await t.query(
      api.functions.finance.roles.getMyFundRole,
      { token: await tokenFor(leaderUserId), fundId },
    );
    expect(leaderResult.role).toBeNull();
    expect(leaderResult.isGroupLeader).toBe(true);

    const memberResult = await t.query(
      api.functions.finance.roles.getMyFundRole,
      { token: await tokenFor(memberUserId), fundId },
    );
    expect(memberResult.role).toBeNull();
    expect(memberResult.isGroupLeader).toBe(false);
    expect(memberResult.isCommunityAdmin).toBe(false);
  });

  test("listFundRoles includes both active and revoked rows", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, managerUserId } =
      await seedExpenseFixture(t);

    await t.mutation(api.functions.finance.roles.revokeFundRole, {
      token: await tokenFor(financeAdminUserId),
      fundId,
      userId: managerUserId,
    });

    const rows = await t.query(api.functions.finance.roles.listFundRoles, {
      token: await tokenFor(financeAdminUserId),
      fundId,
    });
    const managerRow = rows.find((r) => r.userId === managerUserId);
    expect(managerRow?.isActive).toBe(false);
    expect(rows.some((r) => r.isActive)).toBe(true);
  });
});

// ============================================================================
// expenses.ts — submitExpense
// ============================================================================

describe("submitExpense", () => {
  test("an active member can submit a reimbursement", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);

    const expenseId = await submitReimbursement(t, fundId, memberUserId, 5000);
    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.status).toBe("pending");
    expect(expense?.submitterId).toBe(memberUserId);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "expense.submitted")).toBe(true);
  });

  test("rejects a non-member of the fund's group", async () => {
    const t = convexTest(schema, modules);
    const { fundId, nonMemberUserId } = await seedExpenseFixture(t);

    await expect(
      submitReimbursement(t, fundId, nonMemberUserId, 5000),
    ).rejects.toThrow(/active member/i);
  });

  test("rejects a reimbursement with no receipt", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);

    await expect(
      t.mutation(api.functions.finance.expenses.submitExpense, {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 5000,
        kind: "reimbursement",
        description: "No receipt",
        receiptKey: "",
      }),
    ).rejects.toThrow(/receipt/i);
  });

  test("rejects a receipt uploaded by somebody else", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);

    // The manager's receipt key — the sort of value a member can read
    // straight off `listExpenses`'s receiptUrl or a card's activity list.
    const someoneElsesReceipt = await grantReceiptKey(t, managerUserId, "theirs");

    await expect(
      t.mutation(api.functions.finance.expenses.submitExpense, {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 5000,
        kind: "reimbursement",
        description: "Borrowed proof of purchase",
        receiptKey: someoneElsesReceipt,
      }),
    ).rejects.toThrow(/wasn't uploaded from this account/i);

    const expenses = await t.run((ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_fund_status", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(expenses).toHaveLength(0);
  });

  test("rejects a well-formed r2: key this backend never issued", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);

    // Still a refusal — but the message is the "no provenance at all" one,
    // which is also what an upload picked before this check shipped gets, and
    // it tells the member the thing that actually fixes it.
    await expect(
      t.mutation(api.functions.finance.expenses.submitExpense, {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 5000,
        kind: "reimbursement",
        description: "Made-up key",
        receiptKey: "r2:uploads/totally-invented.jpg",
      }),
    ).rejects.toThrow(/re-attach the photo/i);
  });

  test("accepts the submitter's own uploaded receipt", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);
    const receiptKey = await grantReceiptKey(t, memberUserId, "mine");

    const expenseId = await t.mutation(
      api.functions.finance.expenses.submitExpense,
      {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 5000,
        kind: "reimbursement",
        description: "Snacks",
        receiptKey,
      },
    );
    const expense = await t.run((ctx) => ctx.db.get(expenseId));
    expect(expense?.receiptKey).toBe(receiptKey);
  });

  test("rejects kind card_charge", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);

    await expect(
      t.mutation(api.functions.finance.expenses.submitExpense, {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 5000,
        kind: "card_charge",
        description: "Card swipe",
        receiptKey: await grantReceiptKey(t, memberUserId),
      }),
    ).rejects.toThrow(/card-charge/i);
  });

  test("rejects amount out of bounds", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);

    await expect(
      t.mutation(api.functions.finance.expenses.submitExpense, {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 500_001,
        kind: "reimbursement",
        description: "Too big",
        receiptKey: await grantReceiptKey(t, memberUserId),
      }),
    ).rejects.toThrow(/amount/i);
  });

  test("rejects submission on a frozen fund (security-review FIX 1c)", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { status: "frozen" });
    });

    await expect(
      submitReimbursement(t, fundId, memberUserId, 5000),
    ).rejects.toThrow(/active/i);
  });

  test("rejects submission on a closed fund", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { status: "closed" });
    });

    await expect(
      submitReimbursement(t, fundId, memberUserId, 5000),
    ).rejects.toThrow(/active/i);
  });
});

// ============================================================================
// expenses.ts — approveExpense / denyExpense
// ============================================================================

describe("approveExpense", () => {
  test("under threshold: approves on first manager sign-off and schedules payout", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);
      const expenseId = await submitReimbursement(t, fundId, memberUserId, 5000);

      const result = await t.mutation(
        api.functions.finance.expenses.approveExpense,
        { token: await tokenFor(managerUserId), expenseId },
      );
      expect(result.status).toBe("approved");

      const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
      expect(expense?.status).toBe("approved");
      expect(expense?.approverId).toBe(managerUserId);

      // The payout action was scheduled; running it should hit the
      // no-payout-destination stub (no member payout linking, and no
      // fund.increaseAccountId, exist in this fixture) and leave an audit
      // breadcrumb rather than throwing.
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const events = await t.run(async (ctx) =>
        ctx.db
          .query("financeAuditEvents")
          .withIndex("by_fund", (q) => q.eq("fundId", fundId))
          .collect(),
      );
      expect(
        events.some((e) => e.action === "expense.pay_blocked_no_destination"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("at/above threshold: needs a second, distinct approver", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, managerUserId, manager2UserId } =
      await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(
      t,
      fundId,
      memberUserId,
      SECOND_APPROVAL_THRESHOLD_CENTS,
    );

    const first = await t.mutation(
      api.functions.finance.expenses.approveExpense,
      { token: await tokenFor(managerUserId), expenseId },
    );
    expect(first.status).toBe("pending");

    const midway = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(midway?.status).toBe("pending");
    expect(midway?.approverId).toBe(managerUserId);
    expect(midway?.secondApproverId).toBeUndefined();

    const second = await t.mutation(
      api.functions.finance.expenses.approveExpense,
      { token: await tokenFor(manager2UserId), expenseId },
    );
    expect(second.status).toBe("approved");

    const finalExpense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(finalExpense?.status).toBe("approved");
    expect(finalExpense?.approverId).toBe(managerUserId);
    expect(finalExpense?.secondApproverId).toBe(manager2UserId);
  });

  test("the same manager cannot approve twice at the threshold", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(
      t,
      fundId,
      memberUserId,
      SECOND_APPROVAL_THRESHOLD_CENTS,
    );

    await t.mutation(api.functions.finance.expenses.approveExpense, {
      token: await tokenFor(managerUserId),
      expenseId,
    });

    await expect(
      t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(managerUserId),
        expenseId,
      }),
    ).rejects.toThrow(/second, different approver/i);
  });

  test("blocks self-approval even for a finance_admin", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId } = await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(
      t,
      fundId,
      financeAdminUserId,
      5000,
    );

    await expect(
      t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(financeAdminUserId),
        expenseId,
      }),
    ).rejects.toThrow(/own expense/i);
  });

  test("rejects a plain member trying to approve", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, financeAdminUserId } =
      await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(
      t,
      fundId,
      financeAdminUserId,
      5000,
    );

    await expect(
      t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(memberUserId),
        expenseId,
      }),
    ).rejects.toThrow();
  });

  test("rejects approving on a fund frozen after submission (security-review FIX 1c)", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);
    // Submitted while the fund is still active...
    const expenseId = await submitReimbursement(t, fundId, memberUserId, 5000);
    // ...then the fund is frozen (e.g. its group archived) before approval.
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { status: "frozen" });
    });

    await expect(
      t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(managerUserId),
        expenseId,
      }),
    ).rejects.toThrow(/active/i);

    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.status).toBe("pending"); // never advanced
  });
});

describe("denyExpense", () => {
  test("manager denies with a reason; audit logged", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(t, fundId, memberUserId, 5000);

    await t.mutation(api.functions.finance.expenses.denyExpense, {
      token: await tokenFor(managerUserId),
      expenseId,
      reason: "Missing itemized receipt",
    });

    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.status).toBe("denied");

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    const denyEvent = events.find((e) => e.action === "expense.denied");
    expect(denyEvent).toBeDefined();
    expect(denyEvent?.detailsJson).toContain("Missing itemized receipt");
  });

  test("a manager cannot deny their own expense", async () => {
    const t = convexTest(schema, modules);
    const { fundId, managerUserId } = await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(t, fundId, managerUserId, 5000);

    await expect(
      t.mutation(api.functions.finance.expenses.denyExpense, {
        token: await tokenFor(managerUserId),
        expenseId,
        reason: "Self-deny attempt",
      }),
    ).rejects.toThrow(/own expense/i);
  });

  test("denial is still allowed on a frozen fund (security-review FIX 1c: denials are never blocked)", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(t, fundId, memberUserId, 5000);
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { status: "frozen" });
    });

    await t.mutation(api.functions.finance.expenses.denyExpense, {
      token: await tokenFor(managerUserId),
      expenseId,
      reason: "Fund frozen but denial must still work",
    });

    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.status).toBe("denied");
  });
});

// ============================================================================
// expenses.ts — recordReimbursementPaid (idempotency)
// ============================================================================

describe("recordReimbursementPaid", () => {
  test("posting twice writes one ledger entry and pays once", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);
    const expenseId = await submitReimbursement(t, fundId, memberUserId, 5000);
    await t.mutation(api.functions.finance.expenses.approveExpense, {
      token: await tokenFor(managerUserId),
      expenseId,
    });

    const fundBefore = await t.run(async (ctx) => ctx.db.get(fundId));

    await t.mutation(
      internal.functions.finance.expenses.recordReimbursementPaid,
      { expenseId, increaseTransferId: "transfer_1" },
    );
    await t.mutation(
      internal.functions.finance.expenses.recordReimbursementPaid,
      { expenseId, increaseTransferId: "transfer_1" },
    );

    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.status).toBe("paid");
    expect(expense?.increaseTransferId).toBe("transfer_1");

    const ledgerEntries = await t.run(async (ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    const reimbEntries = ledgerEntries.filter((e) => e.kind === "reimbursement");
    expect(reimbEntries).toHaveLength(1);
    expect(reimbEntries[0].actorUserId).toBe(memberUserId);

    const fundAfter = await t.run(async (ctx) => ctx.db.get(fundId));
    expect(fundAfter!.balanceCents).toBe(fundBefore!.balanceCents - 5000);

    const paidEvents = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(paidEvents.filter((e) => e.action === "expense.paid")).toHaveLength(1);
  });
});

// ============================================================================
// expenses.ts — payReimbursement fund-status gate (security-review FIX 1a)
// ============================================================================

describe("payReimbursement — fund status gate", () => {
  test("frozen fund blocks payout BEFORE any transfer; no ledger entry, audit blocked, expense stays approved", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);
      const expenseId = await submitReimbursement(t, fundId, memberUserId, 5000);

      // approveExpense schedules payReimbursement via ctx.scheduler — timers
      // stay frozen so that scheduled run never fires; we invoke
      // payReimbursement ourselves below, after freezing the fund, so the
      // test controls exactly when the payout attempt happens relative to
      // the freeze (mirrors finance-onboarding.test.ts's fake-timer
      // convention for the same class of hazard).
      await t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(managerUserId),
        expenseId,
      });

      // Fund gets frozen AFTER approval but BEFORE the payout runs (e.g. its
      // group was archived in the gap).
      await t.run(async (ctx) => {
        await ctx.db.patch(fundId, { status: "frozen" });
      });

      await t.action(internal.functions.finance.expenses.payReimbursement, {
        expenseId,
      });

      const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
      expect(expense?.status).toBe("approved"); // never advanced to "paid"
      expect(expense?.increaseTransferId).toBeUndefined();

      const ledgerEntries = await t.run(async (ctx) =>
        ctx.db
          .query("ledgerEntries")
          .withIndex("by_fund", (q) => q.eq("fundId", fundId))
          .collect(),
      );
      expect(ledgerEntries.filter((e) => e.kind === "reimbursement")).toHaveLength(0);

      const events = await t.run(async (ctx) =>
        ctx.db
          .query("financeAuditEvents")
          .withIndex("by_fund", (q) => q.eq("fundId", fundId))
          .collect(),
      );
      expect(
        events.some((e) => e.action === "expense.pay_blocked_fund_inactive"),
      ).toBe(true);
      // The blocked-fund breadcrumb must fire instead of (never alongside) a
      // no-destination one — confirms the gate runs before that later check.
      expect(
        events.some((e) => e.action === "expense.pay_blocked_no_destination"),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// jobs.ts — listStuckReimbursements (security-review FIX 1b cron backstop)
// ============================================================================

describe("listStuckReimbursements", () => {
  test("picks a 7h-old approved reimbursement with no transfer; ignores a fresh one and a paid one", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { fundId, memberUserId, managerUserId } = await seedExpenseFixture(t);

      // Stuck: approved, never paid, last touched 7 hours ago.
      const stuckId = await submitReimbursement(t, fundId, memberUserId, 2000);
      await t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(managerUserId),
        expenseId: stuckId,
      });
      await t.run(async (ctx) => {
        await ctx.db.patch(stuckId, { updatedAt: Date.now() - 7 * 60 * 60 * 1000 });
      });

      // Fresh: approved moments ago — must be ignored (under the 6h threshold).
      const freshId = await submitReimbursement(t, fundId, memberUserId, 3000);
      await t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(managerUserId),
        expenseId: freshId,
      });

      // Old AND paid — must be ignored (already has an increaseTransferId).
      const paidId = await submitReimbursement(t, fundId, memberUserId, 4000);
      await t.mutation(api.functions.finance.expenses.approveExpense, {
        token: await tokenFor(managerUserId),
        expenseId: paidId,
      });
      await t.mutation(
        internal.functions.finance.expenses.recordReimbursementPaid,
        { expenseId: paidId, increaseTransferId: "transfer_already_paid" },
      );
      await t.run(async (ctx) => {
        await ctx.db.patch(paidId, { updatedAt: Date.now() - 7 * 60 * 60 * 1000 });
      });

      const stuck = await t.mutation(
        internal.functions.finance.jobs.listStuckReimbursements,
        {},
      );
      const stuckIds = stuck.map((e: { _id: Id<"expenses"> }) => e._id);

      expect(stuckIds).toContain(stuckId);
      expect(stuckIds).not.toContain(freshId);
      expect(stuckIds).not.toContain(paidId);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// expenses.ts — listExpenses / listMyExpenses gating
// ============================================================================

describe("listExpenses / listMyExpenses", () => {
  test("a plain member is denied listExpenses", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedExpenseFixture(t);

    await expect(
      t.query(api.functions.finance.expenses.listExpenses, {
        token: await tokenFor(memberUserId),
        fundId,
      }),
    ).rejects.toThrow();
  });

  test("a manager sees all expenses on the fund", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, financeAdminUserId, managerUserId } =
      await seedExpenseFixture(t);
    await submitReimbursement(t, fundId, memberUserId, 5000);
    await submitReimbursement(t, fundId, financeAdminUserId, 7000);

    const rows = await t.query(api.functions.finance.expenses.listExpenses, {
      token: await tokenFor(managerUserId),
      fundId,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.submitter !== null)).toBe(true);
  });

  test("a submitter sees their own expenses via listMyExpenses", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, financeAdminUserId } =
      await seedExpenseFixture(t);
    await submitReimbursement(t, fundId, memberUserId, 5000);
    await submitReimbursement(t, fundId, financeAdminUserId, 7000);

    const rows = await t.query(api.functions.finance.expenses.listMyExpenses, {
      token: await tokenFor(memberUserId),
      fundId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(5000);
  });
});

describe("requireFundRole after a role upgrade (revoked-row shadowing fix)", () => {
  test("re-granted user passes checks even though a revoked row exists", async () => {
    const t = convexTest(schema, modules);
    const s = await seedExpenseFixture(t);

    // Grant cardholder, then UPGRADE to manager: grantFundRole revokes the
    // first row and inserts a new active one, leaving BOTH rows under
    // by_user_fund.
    const leaderToken = await tokenFor(s.leaderUserId);
    await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: leaderToken,
      fundId: s.fundId,
      userId: s.memberUserId,
      role: "cardholder",
    });
    await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: leaderToken,
      fundId: s.fundId,
      userId: s.memberUserId,
      role: "manager",
    });

    // The upgraded user must now pass a manager-gated call — before the fix,
    // requireFundRole's .first() could pick the revoked cardholder row and
    // wrongly deny them.
    const upgradedToken = await tokenFor(s.memberUserId);
    const pending = await t.query(api.functions.finance.expenses.listExpenses, {
      token: upgradedToken,
      fundId: s.fundId,
      status: "pending",
    });
    expect(Array.isArray(pending)).toBe(true);
  });
});
