/**
 * Group-fund virtual card tests (ADR-032 §3 Phase 3).
 *
 * Covers functions/finance/cards.ts (createFundCard, listFundCards,
 * getCardDetail, setCardFrozen, cancelCard, and the internal
 * provision/status-recording mutations) and functions/finance/webhooks.ts's
 * recordCardSettlement (card-transaction sync into a card_charge expense +
 * ledger debit).
 *
 * createFundCard/setCardFrozen/cancelCard schedule an internalAction
 * (provisionCard / applyCardStatus) via ctx.scheduler.runAfter(0, ...) that
 * would otherwise call the real Increase API — convex-test runs scheduled
 * functions on a REAL setTimeout, so without fake timers they'd actually
 * fire in the background (mirrors finance-onboarding.test.ts's identical
 * hazard for provisionProviders). Freezing timers for the whole suite means
 * those scheduled actions never run here; the actions' own logic (calling
 * Increase, then recording the result) is exercised indirectly by calling
 * the internal mutations they'd otherwise call directly.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-cards.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

// ============================================================================
// Seeding
// ============================================================================

interface CardFixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  fundId: Id<"funds">;
  adminUserId: Id<"users">; // community admin, no fund role
  leaderUserId: Id<"users">; // active group leader, no fund role
  financeAdminUserId: Id<"users">; // fundRole: finance_admin
  cardholderUserId: Id<"users">; // fundRole: cardholder — a valid card holder
  memberUserId: Id<"users">; // plain active group member, no fund role
  nonMemberUserId: Id<"users">; // not in the group at all
}

async function seedCardFixture(
  t: ReturnType<typeof convexTest>,
): Promise<CardFixture> {
  return await t.run(async (ctx) => {
    // Group giving is behind the app-wide "group-giving" feature flag
    // (default OFF) — enable it for these tests.
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: Date.now(),
    });
    const timestamp = Date.now();
    const suffix = Math.floor(Math.random() * 1_000_000);

    const communityId = await ctx.db.insert("communities", {
      name: "Test Church",
      slug: `test-church-${suffix}`,
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
    const cardholderUserId = await mkUser("Cardholder");
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
    for (const userId of [financeAdminUserId, cardholderUserId, memberUserId]) {
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
      balanceCents: 0,
      increaseAccountId: "increase_account_test",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_test",
      increaseEntityId: "entity_test",
      increaseReceivingAccountId: "increase_account_receiving_test",
      onboardingStatus: "live",
      legalName: "Test Church",
      ein: "12-3456789",
      address: ADDRESS,
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
      userId: cardholderUserId,
      role: "cardholder",
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
      cardholderUserId,
      memberUserId,
      nonMemberUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

async function createCard(
  t: ReturnType<typeof convexTest>,
  fundId: Id<"funds">,
  callerId: Id<"users">,
  holderUserId: Id<"users">,
  extra?: { spendLimitCents?: number; limitPeriod?: "week" | "month" | "charge" },
): Promise<Id<"cards">> {
  return await t.mutation(api.functions.finance.cards.createFundCard, {
    token: await tokenFor(callerId),
    fundId,
    holderUserId,
    name: "Groceries & supplies",
    ...extra,
  });
}

// ============================================================================
// createFundCard
// ============================================================================

describe("createFundCard", () => {
  test("finance_admin issues a card to a cardholder; pending row + audit", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);

    const cardId = await createCard(t, fundId, financeAdminUserId, cardholderUserId, {
      spendLimitCents: 20000,
      limitPeriod: "month",
    });

    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("pending");
    expect(card?.holderUserId).toBe(cardholderUserId);
    expect(card?.name).toBe("Groceries & supplies");
    expect(card?.spendLimitCents).toBe(20000);
    expect(card?.limitPeriod).toBe("month");
    expect(card?.increaseCardId).toBeUndefined();

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "card.created")).toBe(true);
  });

  test("a community admin (no explicit fund role) can also issue a card", async () => {
    const t = convexTest(schema, modules);
    const { fundId, adminUserId, cardholderUserId } = await seedCardFixture(t);

    const cardId = await createCard(t, fundId, adminUserId, cardholderUserId);
    expect(cardId).toBeDefined();
  });

  test("rejects a non-finance_admin caller", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId, cardholderUserId } = await seedCardFixture(t);

    await expect(
      createCard(t, fundId, memberUserId, cardholderUserId),
    ).rejects.toThrow();
  });

  test("rejects a holder who doesn't hold cardholder+ on the fund", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, memberUserId } = await seedCardFixture(t);

    await expect(
      createCard(t, fundId, financeAdminUserId, memberUserId),
    ).rejects.toThrow(/cardholder access/i);
  });

  test("rejects a holder who is a community admin but has no explicit fund role", async () => {
    // The admin caller-side override must NOT leak into the holder check —
    // a holder must have an actual fundRoles grant.
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, adminUserId } = await seedCardFixture(t);

    await expect(
      createCard(t, fundId, financeAdminUserId, adminUserId),
    ).rejects.toThrow(/cardholder access/i);
  });

  test("rejects when the fund has no increaseAccountId yet", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { increaseAccountId: undefined });
    });

    await expect(
      createCard(t, fundId, financeAdminUserId, cardholderUserId),
    ).rejects.toThrow(/bank account isn't ready/i);
  });

  test("rejects when the fund isn't active", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { status: "frozen" });
    });

    await expect(
      createCard(t, fundId, financeAdminUserId, cardholderUserId),
    ).rejects.toThrow(/active/i);
  });

  test("rejects when the community's onboarding isn't live", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    await t.run(async (ctx) => {
      const finance = await ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first();
      await ctx.db.patch(finance!._id, { onboardingStatus: "verifying" });
    });

    await expect(
      createCard(t, fundId, financeAdminUserId, cardholderUserId),
    ).rejects.toThrow(/onboarding isn't live/i);
  });
});

// ============================================================================
// provisionCard's internal mutations (success + failure paths)
// ============================================================================

describe("recordCardProvisioned / recordCardProvisionFailed", () => {
  test("recordCardProvisioned patches increaseCardId/last4/status", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    const cardId = await createCard(t, fundId, financeAdminUserId, cardholderUserId);

    await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
      cardId,
      increaseCardId: "increase_card_1",
      last4: "4242",
      status: "active",
    });

    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.increaseCardId).toBe("increase_card_1");
    expect(card?.last4).toBe("4242");
    expect(card?.status).toBe("active");
  });

  test("recordCardProvisionFailed marks the card failed and audits", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    const cardId = await createCard(t, fundId, financeAdminUserId, cardholderUserId);

    await t.mutation(internal.functions.finance.cards.recordCardProvisionFailed, {
      cardId,
      message: "Increase API 500",
    });

    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("failed");

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "card.provision_failed")).toBe(true);
  });
});

// ============================================================================
// listFundCards
// ============================================================================

describe("listFundCards", () => {
  test("a plain member with no fund role and not a leader is rejected", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedCardFixture(t);

    await expect(
      t.query(api.functions.finance.cards.listFundCards, {
        token: await tokenFor(memberUserId),
        fundId,
      }),
    ).rejects.toThrow();
  });

  test("a cardholder sees the fund's card list with holder display info", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    await createCard(t, fundId, financeAdminUserId, cardholderUserId);

    const rows = await t.query(api.functions.finance.cards.listFundCards, {
      token: await tokenFor(cardholderUserId),
      fundId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].holderUserId).toBe(cardholderUserId);
    expect(rows[0].holderName).toContain("Cardholder");
    expect(rows[0].status).toBe("pending");
  });

  test("an active group leader (no fund role) can list", async () => {
    const t = convexTest(schema, modules);
    const { fundId, leaderUserId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    await createCard(t, fundId, financeAdminUserId, cardholderUserId);

    const rows = await t.query(api.functions.finance.cards.listFundCards, {
      token: await tokenFor(leaderUserId),
      fundId,
    });
    expect(rows).toHaveLength(1);
  });
});

// ============================================================================
// setCardFrozen
// ============================================================================

describe("setCardFrozen", () => {
  async function seedProvisionedCard(
    t: ReturnType<typeof convexTest>,
    fixture: CardFixture,
  ): Promise<Id<"cards">> {
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
      cardId,
      increaseCardId: "increase_card_1",
      last4: "4242",
      status: "active",
    });
    return cardId;
  }

  test("the holder can freeze their own card", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await seedProvisionedCard(t, fixture);

    const result = await t.mutation(api.functions.finance.cards.setCardFrozen, {
      token: await tokenFor(fixture.cardholderUserId),
      cardId,
      frozen: true,
    });
    expect(result.status).toBe("disabled");

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "card.frozen")).toBe(true);
  });

  test("the holder cannot unfreeze their own card without finance_admin", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await seedProvisionedCard(t, fixture);

    await t.mutation(api.functions.finance.cards.setCardFrozen, {
      token: await tokenFor(fixture.cardholderUserId),
      cardId,
      frozen: true,
    });

    await expect(
      t.mutation(api.functions.finance.cards.setCardFrozen, {
        token: await tokenFor(fixture.cardholderUserId),
        cardId,
        frozen: false,
      }),
    ).rejects.toThrow(/can't self-unfreeze/i);
  });

  test("finance_admin can both freeze and unfreeze", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await seedProvisionedCard(t, fixture);

    const frozen = await t.mutation(api.functions.finance.cards.setCardFrozen, {
      token: await tokenFor(fixture.financeAdminUserId),
      cardId,
      frozen: true,
    });
    expect(frozen.status).toBe("disabled");

    const unfrozen = await t.mutation(api.functions.finance.cards.setCardFrozen, {
      token: await tokenFor(fixture.financeAdminUserId),
      cardId,
      frozen: false,
    });
    expect(unfrozen.status).toBe("active");

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "card.unfrozen")).toBe(true);
  });

  test("a plain member (not the holder, not finance_admin) is rejected", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await seedProvisionedCard(t, fixture);

    await expect(
      t.mutation(api.functions.finance.cards.setCardFrozen, {
        token: await tokenFor(fixture.memberUserId),
        cardId,
        frozen: true,
      }),
    ).rejects.toThrow();
  });

  test("rejects a card that hasn't finished provisioning (no increaseCardId)", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );

    await expect(
      t.mutation(api.functions.finance.cards.setCardFrozen, {
        token: await tokenFor(fixture.financeAdminUserId),
        cardId,
        frozen: true,
      }),
    ).rejects.toThrow(/provisioning/i);
  });
});

// ============================================================================
// cancelCard
// ============================================================================

describe("cancelCard", () => {
  test("finance_admin can cancel; irreversible status change scheduled + audited", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
      cardId,
      increaseCardId: "increase_card_1",
      last4: "4242",
      status: "active",
    });

    const result = await t.mutation(api.functions.finance.cards.cancelCard, {
      token: await tokenFor(fixture.financeAdminUserId),
      cardId,
    });
    expect(result.status).toBe("canceled");

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "card.canceled")).toBe(true);
  });

  test("the card's own holder (not finance_admin) cannot cancel", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
      cardId,
      increaseCardId: "increase_card_1",
      last4: "4242",
      status: "active",
    });

    await expect(
      t.mutation(api.functions.finance.cards.cancelCard, {
        token: await tokenFor(fixture.cardholderUserId),
        cardId,
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// getCardDetail
// ============================================================================

describe("getCardDetail", () => {
  test("returns activity with receiptAttached flags, newest first", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
      cardId,
      increaseCardId: "increase_card_1",
      last4: "4242",
      status: "active",
    });

    await t.run(async (ctx) => {
      const base = Date.now();
      await ctx.db.insert("expenses", {
        fundId: fixture.fundId,
        submitterId: fixture.cardholderUserId,
        amountCents: 1500,
        kind: "card_charge",
        description: "Coffee shop",
        status: "pending",
        cardId,
        increaseTransactionId: "txn_1",
        createdAt: base,
        updatedAt: base,
      });
      await ctx.db.insert("expenses", {
        fundId: fixture.fundId,
        submitterId: fixture.cardholderUserId,
        amountCents: 4200,
        kind: "card_charge",
        description: "Grocery store",
        receiptKey: "r2:receipts/grocery.jpg",
        status: "pending",
        cardId,
        increaseTransactionId: "txn_2",
        createdAt: base + 1000,
        updatedAt: base + 1000,
      });
    });

    const detail = await t.query(api.functions.finance.cards.getCardDetail, {
      token: await tokenFor(fixture.financeAdminUserId),
      cardId,
    });

    expect(detail.activity).toHaveLength(2);
    // Newest first.
    expect(detail.activity[0].description).toBe("Grocery store");
    expect(detail.activity[0].receiptAttached).toBe(true);
    expect(detail.activity[1].description).toBe("Coffee shop");
    expect(detail.activity[1].receiptAttached).toBe(false);
  });

  test("a plain member with no access is rejected", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );

    await expect(
      t.query(api.functions.finance.cards.getCardDetail, {
        token: await tokenFor(fixture.memberUserId),
        cardId,
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// webhooks.ts — recordCardSettlement
// ============================================================================

describe("recordCardSettlement", () => {
  async function seedSettledCard(
    t: ReturnType<typeof convexTest>,
  ): Promise<{ fixture: CardFixture; cardId: Id<"cards"> }> {
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
      cardId,
      increaseCardId: "increase_card_settlement_test",
      last4: "4242",
      status: "active",
    });
    return { fixture, cardId };
  }

  test("creates one expense + one ledger debit; a redelivered event is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { fixture, cardId } = await seedSettledCard(t);

    const args = {
      increaseCardId: "increase_card_settlement_test",
      increaseTransactionId: "txn_settlement_1",
      accountId: "increase_account_test",
      amountCents: 3500,
      merchantDescription: "Local Grocery Co",
    };

    await t.mutation(internal.functions.finance.webhooks.recordCardSettlement, args);
    await t.mutation(internal.functions.finance.webhooks.recordCardSettlement, args);

    const expenses = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect(),
    );
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountCents).toBe(3500);
    expect(expenses[0].kind).toBe("card_charge");
    expect(expenses[0].description).toBe("Local Grocery Co");
    expect(expenses[0].status).toBe("pending");

    const ledgerEntries = await t.run(async (ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    const captureEntries = ledgerEntries.filter((e) => e.kind === "card_capture");
    expect(captureEntries).toHaveLength(1);
    expect(captureEntries[0].direction).toBe("debit");
    expect(captureEntries[0].amountCents).toBe(3500);

    const fund = await t.run(async (ctx) => ctx.db.get(fixture.fundId));
    expect(fund!.balanceCents).toBe(-3500);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    expect(
      events.filter((e) => e.action === "expense.card_charge_recorded"),
    ).toHaveLength(1);
  });

  test("rejects on an account_id mismatch; audits webhook.rejected_account_mismatch; no expense/ledger write", async () => {
    const t = convexTest(schema, modules);
    const { fixture, cardId } = await seedSettledCard(t);

    await t.mutation(internal.functions.finance.webhooks.recordCardSettlement, {
      increaseCardId: "increase_card_settlement_test",
      increaseTransactionId: "txn_mismatch",
      accountId: "some_other_increase_account",
      amountCents: 1000,
      merchantDescription: "Suspicious Merchant",
    });

    const expenses = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect(),
    );
    expect(expenses).toHaveLength(0);

    const ledgerEntries = await t.run(async (ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    expect(ledgerEntries).toHaveLength(0);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    expect(
      events.some((e) => e.action === "webhook.rejected_account_mismatch"),
    ).toBe(true);
  });

  test("a missing card is logged, not thrown", async () => {
    const t = convexTest(schema, modules);
    await seedCardFixture(t); // ensure schema/tables exist; unrelated fund

    await expect(
      t.mutation(internal.functions.finance.webhooks.recordCardSettlement, {
        increaseCardId: "increase_card_that_does_not_exist",
        increaseTransactionId: "txn_orphan",
        accountId: "whatever",
        amountCents: 500,
        merchantDescription: "Orphan Merchant",
      }),
    ).resolves.toBeNull();
  });
});
