/**
 * `getCardDetail.failureMessage` — reading back why a card was never issued.
 *
 * A refused provisioning stores the provider's own sentence in a
 * `financeAuditEvents` row (`recordCardProvisionFailed`) or ours
 * (`recordCardProvisionRefused`), patches the card to `failed`, and nothing
 * ever read it. On staging that meant Privacy's "Insufficient privileges to
 * create UNLOCKED cards" — an account-plan problem the admin could have fixed
 * in a minute — surfaced as "Something went wrong. Contact support."
 *
 * The reason is community-finance information: it names the issuer, which
 * group-level card surfaces are anonymous about on purpose (ADR-033 §1), and
 * describes a fix only a financial-controls holder can carry out. So these
 * tests pin BOTH directions — the holder gets it, the group leader doesn't.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-card-failure.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const PRIVACY_REFUSAL =
  "Insufficient privileges to create UNLOCKED cards — this Privacy account may not have general-purpose cards enabled; check the plan.";

interface Fixture {
  communityId: Id<"communities">;
  fundId: Id<"funds">;
  cardId: Id<"cards">;
  primaryAdminUserId: Id<"users">; // holds financial controls implicitly
  leaderUserId: Id<"users">; // group leader, no financial controls
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  return await t.run(async (ctx) => {
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

    const mkUser = async (name: string) =>
      ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    const primaryAdminUserId = await mkUser("Primary");
    const leaderUserId = await mkUser("Leader");

    await ctx.db.insert("userCommunities", {
      userId: primaryAdminUserId,
      communityId,
      roles: 4, // PRIMARY_ADMIN — implicit financial controls
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("userCommunities", {
      userId: leaderUserId,
      communityId,
      roles: 1, // MEMBER
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: `small-group-${suffix}`,
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Worship Team",
      isArchived: false,
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

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_test",
      cardProvider: "privacy",
      onboardingStatus: "live",
      legalName: "Test Church",
      ein: "12-3456789",
      address: {
        addressLine1: "1 Main St",
        city: "Austin",
        state: "TX",
        zipCode: "78701",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Worship Team Fund",
      type: "group",
      status: "active",
      balanceCents: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // The card the provider refused: `failed`, and with no last4 — it never
    // existed at the issuer, so there are no digits to show.
    const cardId = await ctx.db.insert("cards", {
      fundId,
      holderUserId: leaderUserId,
      name: "Groceries",
      provider: "privacy",
      status: "failed",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return { communityId, fundId, cardId, primaryAdminUserId, leaderUserId };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

async function logFailure(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  opts: { action: string; details: Record<string, unknown>; createdAt?: number },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("financeAuditEvents", {
      communityId: f.communityId,
      fundId: f.fundId,
      action: opts.action,
      detailsJson: JSON.stringify(opts.details),
      createdAt: opts.createdAt ?? Date.now(),
    });
  });
}

function detail(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  userId: Id<"users">,
) {
  return tokenFor(userId).then((token) =>
    t.query(api.functions.finance.cards.getCardDetail, {
      token,
      cardId: f.cardId,
    }),
  );
}

describe("getCardDetail — a card that failed to issue", () => {
  test("hands the provider's reason to a financial-controls holder", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await logFailure(t, f, {
      action: "card.provision_failed",
      details: { cardId: f.cardId, message: PRIVACY_REFUSAL },
    });

    const result = await detail(t, f, f.primaryAdminUserId);

    expect(result.status).toBe("failed");
    expect(result.last4).toBeNull();
    expect(result.failureMessage).toBe(PRIVACY_REFUSAL);
  });

  test("withholds it from a group leader, who can neither verify nor fix it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await logFailure(t, f, {
      action: "card.provision_failed",
      details: { cardId: f.cardId, message: PRIVACY_REFUSAL },
    });

    const result = await detail(t, f, f.leaderUserId);

    // The leader still sees the card — just not the vendor's account detail.
    expect(result.status).toBe("failed");
    expect(result.failureMessage).toBeNull();
  });

  test("reads our own preflight refusal too, which uses a different key", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await logFailure(t, f, {
      action: "card.provision_refused",
      details: { cardId: f.cardId, reason: 'fund status is "frozen"' },
    });

    const result = await detail(t, f, f.primaryAdminUserId);
    expect(result.failureMessage).toBe('fund status is "frozen"');
  });

  test("takes the most recent attempt, not the first", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const nowMs = Date.now();
    await logFailure(t, f, {
      action: "card.provision_failed",
      details: { cardId: f.cardId, message: "an older, already-fixed problem" },
      createdAt: nowMs - 60_000,
    });
    await logFailure(t, f, {
      action: "card.provision_failed",
      details: { cardId: f.cardId, message: PRIVACY_REFUSAL },
      createdAt: nowMs,
    });

    const result = await detail(t, f, f.primaryAdminUserId);
    expect(result.failureMessage).toBe(PRIVACY_REFUSAL);
  });

  test("ignores another card's failure on the same fund", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await logFailure(t, f, {
      action: "card.provision_failed",
      details: { cardId: "some-other-card", message: "not this card's problem" },
    });

    const result = await detail(t, f, f.primaryAdminUserId);
    expect(result.failureMessage).toBeNull();
  });

  test("falls back to null when nothing was recorded", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const result = await detail(t, f, f.primaryAdminUserId);
    expect(result.failureMessage).toBeNull();
  });

  test("a healthy card never carries one, holder or not", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await logFailure(t, f, {
      action: "card.provision_failed",
      details: { cardId: f.cardId, message: PRIVACY_REFUSAL },
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(f.cardId, { status: "active", last4: "4921" });
    });

    const result = await detail(t, f, f.primaryAdminUserId);
    expect(result.failureMessage).toBeNull();
    expect(result.last4).toBe("4921");
  });

  test("truncates a runaway provider message", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await logFailure(t, f, {
      action: "card.provision_failed",
      details: { cardId: f.cardId, message: "x".repeat(500) },
    });

    const result = await detail(t, f, f.primaryAdminUserId);
    expect(result.failureMessage).toHaveLength(300);
  });
});
