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
 * those scheduled actions never run here.
 *
 * The actions themselves are NOT skipped, though: `provisionCard`,
 * `applyCardStatus` and `applyCardLimit` are invoked directly with
 * `t.action` against a mocked lib/finance/increase, so what we actually send
 * the provider — in particular the spending limit, which the bank is the
 * only thing enforcing — is asserted rather than assumed.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-cards.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

/**
 * The Increase client, stubbed. Only the card endpoints are replaced — the
 * rest of the module (webhook signature verification et al) stays real so
 * nothing else in the suite silently changes shape.
 */
const increase = vi.hoisted(() => ({
  createCard: vi.fn(async () => ({
    id: "increase_card_provisioned",
    status: "active",
    last4: "4242",
  })),
  updateCardStatus: vi.fn(async (_cardId: string, status: string) => ({
    id: "increase_card_provisioned",
    status,
  })),
  updateCardSpendingLimit: vi.fn(async () => ({
    id: "increase_card_provisioned",
    status: "active",
  })),
}));

vi.mock("../lib/finance/increase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/finance/increase")>()),
  ...increase,
}));

beforeEach(() => {
  increase.createCard.mockClear();
  increase.updateCardStatus.mockClear();
  increase.updateCardSpendingLimit.mockClear();
});

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

/** Flip the app-wide "group-giving" flag off, the way a superuser would. */
async function disableGroupGiving(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", "group-giving"))
      .first();
    await ctx.db.patch(flag!._id, { enabled: false });
  });
}

/** A card that has been through provisioning and has an Increase card id. */
async function provisionedCard(
  t: ReturnType<typeof convexTest>,
  fixture: CardFixture,
  extra?: { spendLimitCents?: number; limitPeriod?: "week" | "month" | "charge" },
): Promise<Id<"cards">> {
  const cardId = await createCard(
    t,
    fixture.fundId,
    fixture.financeAdminUserId,
    fixture.cardholderUserId,
    extra,
  );
  await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
    cardId,
    increaseCardId: "increase_card_1",
    last4: "4242",
    status: "active",
  });
  return cardId;
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
// Spend-limit validation — the limit is a bank-enforced control, so garbage
// must never reach the row (let alone Increase).
// ============================================================================

describe("spend-limit validation", () => {
  const BAD_LIMITS: {
    label: string;
    limit: { spendLimitCents?: number; limitPeriod?: "week" | "month" | "charge" };
    message: RegExp;
  }[] = [
    {
      label: "an amount with no period",
      limit: { spendLimitCents: 20000 },
      message: /both an amount and a period/i,
    },
    {
      label: "a period with no amount",
      limit: { limitPeriod: "week" },
      message: /both an amount and a period/i,
    },
    {
      label: "a negative amount",
      limit: { spendLimitCents: -5000, limitPeriod: "week" },
      message: /more than \$0/i,
    },
    {
      label: "a zero amount",
      limit: { spendLimitCents: 0, limitPeriod: "month" },
      message: /more than \$0/i,
    },
    {
      label: "fractional cents",
      limit: { spendLimitCents: 1999.5, limitPeriod: "charge" },
      message: /whole number of cents/i,
    },
    {
      label: "an absurd amount",
      limit: { spendLimitCents: 99_999_999_99, limitPeriod: "month" },
      message: /can't be more than/i,
    },
  ];

  for (const { label, limit, message } of BAD_LIMITS) {
    test(`createFundCard rejects ${label}`, async () => {
      const t = convexTest(schema, modules);
      const { fundId, financeAdminUserId, cardholderUserId } =
        await seedCardFixture(t);

      await expect(
        createCard(t, fundId, financeAdminUserId, cardholderUserId, limit),
      ).rejects.toThrow(message);

      const cards = await t.run(async (ctx) =>
        ctx.db
          .query("cards")
          .withIndex("by_fund", (q) => q.eq("fundId", fundId))
          .collect(),
      );
      expect(cards).toHaveLength(0);
    });

    test(`setCardLimit rejects ${label}`, async () => {
      const t = convexTest(schema, modules);
      const fixture = await seedCardFixture(t);
      const cardId = await provisionedCard(t, fixture);

      await expect(
        t.mutation(api.functions.finance.cards.setCardLimit, {
          token: await tokenFor(fixture.financeAdminUserId),
          cardId,
          ...limit,
        }),
      ).rejects.toThrow(message);
    });
  }

  test("no limit at all is valid — a card may be uncapped below the fund balance", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);

    const cardId = await createCard(t, fundId, financeAdminUserId, cardholderUserId);
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.spendLimitCents).toBeUndefined();
    expect(card?.limitPeriod).toBeUndefined();
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
// provisionCard — the action itself, against a mocked Increase. This is the
// only place the spend limit becomes real, so it is asserted at the provider
// boundary, not at the row.
// ============================================================================

describe("provisionCard", () => {
  test("sends the spend limit to Increase, mapped to Increase's own interval", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    const cardId = await createCard(t, fundId, financeAdminUserId, cardholderUserId, {
      spendLimitCents: 25_000,
      limitPeriod: "week",
    });

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    expect(increase.createCard).toHaveBeenCalledTimes(1);
    const [accountId, description, idempotencyKey, spendingLimit] =
      increase.createCard.mock.calls[0] as unknown as [
        string,
        string,
        string,
        { interval: string; settlementAmountCents: number } | null,
      ];
    expect(accountId).toBe("increase_account_test");
    expect(description).toContain("Groceries & supplies");
    expect(idempotencyKey).toBe(`finance:card:${cardId}`);
    expect(spendingLimit).toEqual({
      interval: "per_week",
      settlementAmountCents: 25_000,
    });

    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("active");
    expect(card?.increaseCardId).toBe("increase_card_provisioned");
  });

  test.each([
    ["month", "per_month"],
    ["charge", "per_transaction"],
  ] as const)("maps limitPeriod %s -> Increase interval %s", async (period, interval) => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    const cardId = await createCard(t, fundId, financeAdminUserId, cardholderUserId, {
      spendLimitCents: 4_000,
      limitPeriod: period,
    });

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    expect(increase.createCard.mock.calls[0][3]).toEqual({
      interval,
      settlementAmountCents: 4_000,
    });
  });

  test("sends null when the card has no limit", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    const cardId = await createCard(t, fundId, financeAdminUserId, cardholderUserId);

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    expect(increase.createCard.mock.calls[0][3]).toBeNull();
  });

  test("refuses to issue on a fund frozen AFTER the card was created", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    // The gap createFundCard can't see: the group gets archived (which
    // freezes its fund) between the mutation and the scheduled action.
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.fundId, { status: "frozen" });
    });

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    expect(increase.createCard).not.toHaveBeenCalled();
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("failed");
    expect(card?.increaseCardId).toBeUndefined();

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    const refusal = events.find((e) => e.action === "card.provision_refused");
    expect(refusal).toBeDefined();
    expect(refusal!.detailsJson).toContain("frozen");
  });

  test("refuses to issue when the community drops out of \"live\" onboarding", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    await t.run(async (ctx) => {
      const finance = await ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", fixture.communityId))
        .first();
      await ctx.db.patch(finance!._id, { onboardingStatus: "increase_blocked" });
    });

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    expect(increase.createCard).not.toHaveBeenCalled();
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("failed");
  });

  test("refuses to issue when the fund lost its Increase Account", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.fundId, { increaseAccountId: undefined });
    });

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    expect(increase.createCard).not.toHaveBeenCalled();
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("failed");
  });

  test("marks the card failed when Increase itself errors", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );
    increase.createCard.mockRejectedValueOnce(new Error("Increase API 500"));

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("failed");
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
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

    const result = await t.query(api.functions.finance.cards.listFundCards, {
      token: await tokenFor(cardholderUserId),
      fundId,
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].holderUserId).toBe(cardholderUserId);
    expect(result.cards[0].holderName).toContain("Cardholder");
    expect(result.cards[0].status).toBe("pending");
  });

  test("an active group leader (no fund role) can list", async () => {
    const t = convexTest(schema, modules);
    const { fundId, leaderUserId, financeAdminUserId, cardholderUserId } =
      await seedCardFixture(t);
    await createCard(t, fundId, financeAdminUserId, cardholderUserId);

    const result = await t.query(api.functions.finance.cards.listFundCards, {
      token: await tokenFor(leaderUserId),
      fundId,
    });
    expect(result.cards).toHaveLength(1);
  });

  test("viewerCanManageCards mirrors createFundCard's own gate", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId, cardholderUserId, leaderUserId } =
      await seedCardFixture(t);

    const asFinanceAdmin = await t.query(api.functions.finance.cards.listFundCards, {
      token: await tokenFor(financeAdminUserId),
      fundId,
    });
    expect(asFinanceAdmin.viewerCanManageCards).toBe(true);

    const asCardholder = await t.query(api.functions.finance.cards.listFundCards, {
      token: await tokenFor(cardholderUserId),
      fundId,
    });
    expect(asCardholder.viewerCanManageCards).toBe(false);

    // The leader passes the viewer gate (can list) but has no fund role, so
    // must not see the "New card" affordance — createFundCard would reject
    // them since they aren't finance_admin.
    const asLeader = await t.query(api.functions.finance.cards.listFundCards, {
      token: await tokenFor(leaderUserId),
      fundId,
    });
    expect(asLeader.cards).toBeDefined();
    expect(asLeader.viewerCanManageCards).toBe(false);
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
// applyCardStatus — the shared action behind setCardFrozen/cancelCard.
// ============================================================================

describe("applyCardStatus", () => {
  test.each(["disabled", "active", "canceled"] as const)(
    "pushes %s to Increase and stores what Increase confirmed",
    async (status) => {
      const t = convexTest(schema, modules);
      const fixture = await seedCardFixture(t);
      const cardId = await provisionedCard(t, fixture);

      await t.action(internal.functions.finance.cards.applyCardStatus, {
        cardId,
        status,
      });

      expect(increase.updateCardStatus).toHaveBeenCalledWith("increase_card_1", status);
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.status).toBe(status);
    },
  );

  test("a card with no increaseCardId is logged, not pushed", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );

    await t.action(internal.functions.finance.cards.applyCardStatus, {
      cardId,
      status: "disabled",
    });

    expect(increase.updateCardStatus).not.toHaveBeenCalled();
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.status).toBe("pending");
  });
});

// ============================================================================
// setCardLimit
// ============================================================================

describe("setCardLimit", () => {
  test("finance_admin changes the limit; the local mirror only moves once Increase confirms", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture, {
      spendLimitCents: 10_000,
      limitPeriod: "week",
    });

    const result = await t.mutation(api.functions.finance.cards.setCardLimit, {
      token: await tokenFor(fixture.financeAdminUserId),
      cardId,
      spendLimitCents: 50_000,
      limitPeriod: "month",
    });
    expect(result).toEqual({ spendLimitCents: 50_000, limitPeriod: "month" });

    // The scheduled action hasn't run (fake timers), so the row still holds
    // the OLD limit — the mirror never claims a cap the bank hasn't taken.
    const beforeApply = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(beforeApply?.spendLimitCents).toBe(10_000);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    const audit = events.find((e) => e.action === "card.limit_updated");
    expect(audit).toBeDefined();
    expect(JSON.parse(audit!.detailsJson!)).toMatchObject({
      fromSpendLimitCents: 10_000,
      fromLimitPeriod: "week",
      toSpendLimitCents: 50_000,
      toLimitPeriod: "month",
    });

    await t.action(internal.functions.finance.cards.applyCardLimit, {
      cardId,
      spendLimitCents: 50_000,
      limitPeriod: "month",
    });

    expect(increase.updateCardSpendingLimit).toHaveBeenCalledWith("increase_card_1", {
      interval: "per_month",
      settlementAmountCents: 50_000,
    });
    const afterApply = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(afterApply?.spendLimitCents).toBe(50_000);
    expect(afterApply?.limitPeriod).toBe("month");
  });

  test("clearing the limit tells Increase explicitly, and clears the mirror", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture, {
      spendLimitCents: 10_000,
      limitPeriod: "week",
    });

    await t.mutation(api.functions.finance.cards.setCardLimit, {
      token: await tokenFor(fixture.financeAdminUserId),
      cardId,
    });
    await t.action(internal.functions.finance.cards.applyCardLimit, { cardId });

    expect(increase.updateCardSpendingLimit).toHaveBeenCalledWith(
      "increase_card_1",
      null,
    );
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card?.spendLimitCents).toBeUndefined();
    expect(card?.limitPeriod).toBeUndefined();
  });

  test("the card's own holder cannot change their own limit", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture);

    await expect(
      t.mutation(api.functions.finance.cards.setCardLimit, {
        token: await tokenFor(fixture.cardholderUserId),
        cardId,
        spendLimitCents: 500_000,
        limitPeriod: "week",
      }),
    ).rejects.toThrow();
  });

  test("rejects a card that hasn't finished provisioning", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );

    await expect(
      t.mutation(api.functions.finance.cards.setCardLimit, {
        token: await tokenFor(fixture.financeAdminUserId),
        cardId,
        spendLimitCents: 5_000,
        limitPeriod: "week",
      }),
    ).rejects.toThrow(/provisioning/i);
  });
});

// ============================================================================
// The group-giving kill switch must never disarm the incident-response
// tools: a card is a bank object, so it keeps authorizing after the flag
// goes off. Freeze and cancel stay reachable; everything else stops.
// ============================================================================

describe("with the group-giving flag OFF", () => {
  test("the holder can still freeze a compromised card", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture);
    await disableGroupGiving(t);

    const result = await t.mutation(api.functions.finance.cards.setCardFrozen, {
      token: await tokenFor(fixture.cardholderUserId),
      cardId,
      frozen: true,
    });
    expect(result.status).toBe("disabled");
  });

  test("finance_admin can still unfreeze and cancel", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture);
    await disableGroupGiving(t);
    const token = await tokenFor(fixture.financeAdminUserId);

    await t.mutation(api.functions.finance.cards.setCardFrozen, {
      token,
      cardId,
      frozen: true,
    });
    const unfrozen = await t.mutation(api.functions.finance.cards.setCardFrozen, {
      token,
      cardId,
      frozen: false,
    });
    expect(unfrozen.status).toBe("active");

    const canceled = await t.mutation(api.functions.finance.cards.cancelCard, {
      token,
      cardId,
    });
    expect(canceled.status).toBe("canceled");
  });

  test("the role checks still apply — a plain member can't freeze", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture);
    await disableGroupGiving(t);

    await expect(
      t.mutation(api.functions.finance.cards.setCardFrozen, {
        token: await tokenFor(fixture.memberUserId),
        cardId,
        frozen: true,
      }),
    ).rejects.toThrow();
  });

  test("the holder still can't self-unfreeze", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture);
    await disableGroupGiving(t);

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

  test("every other card entry point still refuses", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await provisionedCard(t, fixture);
    await disableGroupGiving(t);
    const token = await tokenFor(fixture.financeAdminUserId);

    await expect(
      createCard(t, fixture.fundId, fixture.financeAdminUserId, fixture.cardholderUserId),
    ).rejects.toThrow(/group-giving/i);
    await expect(
      t.query(api.functions.finance.cards.listFundCards, { token, fundId: fixture.fundId }),
    ).rejects.toThrow(/group-giving/i);
    await expect(
      t.query(api.functions.finance.cards.getCardDetail, { token, cardId }),
    ).rejects.toThrow(/group-giving/i);
    await expect(
      t.mutation(api.functions.finance.cards.setCardLimit, {
        token,
        cardId,
        spendLimitCents: 5_000,
        limitPeriod: "week",
      }),
    ).rejects.toThrow(/group-giving/i);
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

  test("capability flags: holder gets freeze-only, finance_admin gets all, a manager gets none", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedCardFixture(t);
    const cardId = await createCard(
      t,
      fixture.fundId,
      fixture.financeAdminUserId,
      fixture.cardholderUserId,
    );

    // A manager-role viewer — not the holder, not finance_admin — for the
    // "freeze false" case.
    const managerUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        firstName: "Manager",
        lastName: "User",
        phone: `+1555001${Math.floor(Math.random() * 9000 + 1000)}`,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: fixture.groupId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      await ctx.db.insert("fundRoles", {
        fundId: fixture.fundId,
        userId,
        role: "manager",
        grantedBy: fixture.adminUserId,
        grantedAt: Date.now(),
      });
      return userId;
    });

    const asHolder = await t.query(api.functions.finance.cards.getCardDetail, {
      token: await tokenFor(fixture.cardholderUserId),
      cardId,
    });
    expect(asHolder.viewerCanFreeze).toBe(true);
    expect(asHolder.viewerCanUnfreeze).toBe(false);
    expect(asHolder.viewerCanCancel).toBe(false);

    const asFinanceAdmin = await t.query(api.functions.finance.cards.getCardDetail, {
      token: await tokenFor(fixture.financeAdminUserId),
      cardId,
    });
    expect(asFinanceAdmin.viewerCanFreeze).toBe(true);
    expect(asFinanceAdmin.viewerCanUnfreeze).toBe(true);
    expect(asFinanceAdmin.viewerCanCancel).toBe(true);

    const asManager = await t.query(api.functions.finance.cards.getCardDetail, {
      token: await tokenFor(managerUserId),
      cardId,
    });
    expect(asManager.viewerCanFreeze).toBe(false);
    expect(asManager.viewerCanUnfreeze).toBe(false);
    expect(asManager.viewerCanCancel).toBe(false);
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

  test("still records expense + card_capture ledger entry when the fund is frozen", async () => {
    const t = convexTest(schema, modules);
    const { fixture, cardId } = await seedSettledCard(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.fundId, { status: "frozen" });
    });

    await t.mutation(internal.functions.finance.webhooks.recordCardSettlement, {
      increaseCardId: "increase_card_settlement_test",
      increaseTransactionId: "txn_settlement_frozen",
      accountId: "increase_account_test",
      amountCents: 2200,
      merchantDescription: "Frozen Fund Grocery",
    });

    const expenses = await t.run(async (ctx) =>
      ctx.db
        .query("expenses")
        .withIndex("by_card", (q) => q.eq("cardId", cardId))
        .collect(),
    );
    expect(expenses).toHaveLength(1);
    expect(expenses[0].kind).toBe("card_charge");

    const ledgerEntries = await t.run(async (ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fixture.fundId))
        .collect(),
    );
    const captureEntries = ledgerEntries.filter((e) => e.kind === "card_capture");
    expect(captureEntries).toHaveLength(1);
  });

  // The drift check: Increase enforces the limit, so an over-limit
  // settlement means our mirror and the bank disagree (a card issued before
  // limits were wired, a failed setCardLimit, a forced post). Audit-only —
  // the money already moved.
  describe("over-limit drift audit", () => {
    async function seedCardWithLimit(
      t: ReturnType<typeof convexTest>,
      limit: { spendLimitCents: number; limitPeriod: "week" | "month" | "charge" },
    ) {
      const fixture = await seedCardFixture(t);
      const cardId = await createCard(
        t,
        fixture.fundId,
        fixture.financeAdminUserId,
        fixture.cardholderUserId,
        limit,
      );
      await t.mutation(internal.functions.finance.cards.recordCardProvisioned, {
        cardId,
        increaseCardId: "increase_card_settlement_test",
        last4: "4242",
        status: "active",
      });
      return { fixture, cardId };
    }

    async function settle(
      t: ReturnType<typeof convexTest>,
      transactionId: string,
      amountCents: number,
    ) {
      await t.mutation(internal.functions.finance.webhooks.recordCardSettlement, {
        increaseCardId: "increase_card_settlement_test",
        increaseTransactionId: transactionId,
        accountId: "increase_account_test",
        amountCents,
        merchantDescription: "Local Grocery Co",
      });
    }

    async function limitEvents(
      t: ReturnType<typeof convexTest>,
      fundId: Id<"funds">,
    ) {
      const events = await t.run(async (ctx) =>
        ctx.db
          .query("financeAuditEvents")
          .withIndex("by_fund", (q) => q.eq("fundId", fundId))
          .collect(),
      );
      return events.filter((e) => e.action === "card.limit_exceeded");
    }

    test("a single charge past a per-charge limit is flagged", async () => {
      const t = convexTest(schema, modules);
      const { fixture } = await seedCardWithLimit(t, {
        spendLimitCents: 4_000,
        limitPeriod: "charge",
      });

      await settle(t, "txn_over_charge", 4_001);

      const flagged = await limitEvents(t, fixture.fundId);
      expect(flagged).toHaveLength(1);
      expect(JSON.parse(flagged[0].detailsJson!)).toMatchObject({
        spendLimitCents: 4_000,
        limitPeriod: "charge",
        windowTotalCents: 4_001,
      });
    });

    test("a charge exactly at the limit is not flagged", async () => {
      const t = convexTest(schema, modules);
      const { fixture } = await seedCardWithLimit(t, {
        spendLimitCents: 4_000,
        limitPeriod: "charge",
      });

      await settle(t, "txn_at_limit", 4_000);

      expect(await limitEvents(t, fixture.fundId)).toHaveLength(0);
    });

    test("charges that only breach the cap in aggregate are flagged on the one that tips it", async () => {
      const t = convexTest(schema, modules);
      const { fixture } = await seedCardWithLimit(t, {
        spendLimitCents: 10_000,
        limitPeriod: "month",
      });

      await settle(t, "txn_month_1", 6_000);
      expect(await limitEvents(t, fixture.fundId)).toHaveLength(0);

      await settle(t, "txn_month_2", 4_500);

      const flagged = await limitEvents(t, fixture.fundId);
      expect(flagged).toHaveLength(1);
      expect(JSON.parse(flagged[0].detailsJson!).windowTotalCents).toBe(10_500);
    });

    test("a card with no limit is never flagged", async () => {
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
        increaseCardId: "increase_card_settlement_test",
        last4: "4242",
        status: "active",
      });

      await settle(t, "txn_no_limit", 999_999);

      expect(await limitEvents(t, fixture.fundId)).toHaveLength(0);
    });
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
