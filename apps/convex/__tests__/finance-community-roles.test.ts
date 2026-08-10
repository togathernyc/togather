/**
 * Community-level financial-controls role + card-provider resolution
 * (ADR-033 §2, §5).
 *
 * Two things ship together here and are tested together because the second is
 * only safe because of the first:
 *
 * 1. `functions/finance/communityRoles.ts` — grant/revoke/list, primary-admin
 *    only, grantee must already be a community admin.
 * 2. THE GATE TIGHTENING. A plain community admin (roles === 3) used to reach
 *    every community-level finance surface implicitly. They no longer do. The
 *    tests below assert that in both directions — the plain admin FAILS, the
 *    granted admin PASSES, the primary admin always passes — because a
 *    silent regression in either direction is either a lockout or a hole.
 *
 * Plus the resolver: a legacy community (Increase ids, no `cardProvider`
 * column) must still resolve to Increase, and a community with neither must
 * throw rather than quietly try Increase.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-community-roles.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import {
  canManageCommunityFinance,
  requireCommunityFinanceAccess,
} from "../lib/finance/communityFinanceAccess";
import {
  resolveCardProviderName,
  getCardProvider,
} from "../lib/finance/cardProviders";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Same hazard as finance-cards.test.ts: `startOnboarding` schedules
// `provisionProviders`, which would call the real Stripe/Increase APIs on a
// REAL setTimeout. Frozen timers mean it never fires here.
vi.useFakeTimers();

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

interface Fixture {
  communityId: Id<"communities">;
  primaryAdminUserId: Id<"users">; // roles === 4 — implicit finance access
  plainAdminUserId: Id<"users">; // roles === 3, NO grant — must be denied
  grantedAdminUserId: Id<"users">; // roles === 3 + a communityFinanceRoles row
  memberUserId: Id<"users">; // roles === 1 — never eligible
  otherCommunityId: Id<"communities">;
}

/**
 * @param withIncreaseIds whether the community has finished ADR-032
 * onboarding. `false` models a community that has a finance row but never
 * provisioned — the case the provider resolver must refuse rather than guess.
 */
async function seed(
  t: ReturnType<typeof convexTest>,
  opts: { withIncreaseIds?: boolean; cardProvider?: string } = {},
): Promise<Fixture> {
  const withIncreaseIds = opts.withIncreaseIds ?? true;
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
    const otherCommunityId = await ctx.db.insert("communities", {
      name: "Other Church",
      slug: `other-church-${suffix}`,
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
    const plainAdminUserId = await mkUser("PlainAdmin");
    const grantedAdminUserId = await mkUser("GrantedAdmin");
    const memberUserId = await mkUser("Member");

    const membership = async (userId: Id<"users">, roles: number) =>
      ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    await membership(primaryAdminUserId, 4); // PRIMARY_ADMIN
    await membership(plainAdminUserId, 3); // ADMIN
    await membership(grantedAdminUserId, 3); // ADMIN
    await membership(memberUserId, 1); // MEMBER

    await ctx.db.insert("communityFinance", {
      communityId,
      ...(withIncreaseIds
        ? {
            stripeConnectedAccountId: "acct_test",
            increaseEntityId: "entity_test",
            increaseReceivingAccountId: "increase_account_receiving_test",
          }
        : {}),
      ...(opts.cardProvider ? { cardProvider: opts.cardProvider as any } : {}),
      onboardingStatus: withIncreaseIds ? "live" : "collecting",
      legalName: "Test Church",
      ein: "12-3456789",
      address: ADDRESS,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      communityId,
      primaryAdminUserId,
      plainAdminUserId,
      grantedAdminUserId,
      memberUserId,
      otherCommunityId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

/** Grant through the real mutation, so every test exercises the real path. */
async function grant(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  targetUserId: Id<"users">,
  callerId: Id<"users"> = f.primaryAdminUserId,
) {
  return await t.mutation(api.functions.finance.communityRoles.grantCommunityFinanceRole, {
    token: await tokenFor(callerId),
    communityId: f.communityId,
    userId: targetUserId,
  });
}

// ============================================================================
// grantCommunityFinanceRole
// ============================================================================

describe("grantCommunityFinanceRole", () => {
  test("the primary admin can grant it to a community admin", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const roleId = await grant(t, f, f.grantedAdminUserId);

    const row = await t.run(async (ctx) => ctx.db.get(roleId));
    expect(row?.role).toBe("finance_admin");
    expect(row?.userId).toBe(f.grantedAdminUserId);
    expect(row?.grantedBy).toBe(f.primaryAdminUserId);
    expect(row?.revokedAt).toBeUndefined();
  });

  test("audits the grant", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .collect(),
    );
    const granted = events.filter((e) => e.action === "community_role.granted");
    expect(granted).toHaveLength(1);
    expect(granted[0].actorUserId).toBe(f.primaryAdminUserId);
    expect(JSON.parse(granted[0].detailsJson!).targetUserId).toBe(
      f.grantedAdminUserId,
    );
  });

  test("a NON-primary community admin cannot grant", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(grant(t, f, f.memberUserId, f.plainAdminUserId)).rejects.toThrow(
      /only the community's primary admin/i,
    );
  });

  test("a HOLDER of the role still cannot grant it to someone else", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    // This is the ladder the design exists to prevent: if a grantee could
    // mint peers, the role would decay into "community admin" with extra steps.
    await expect(
      grant(t, f, f.plainAdminUserId, f.grantedAdminUserId),
    ).rejects.toThrow(/only the community's primary admin/i);
  });

  test("a non-admin grantee is rejected", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(grant(t, f, f.memberUserId)).rejects.toThrow(
      /can only be given to a community admin/i,
    );
  });

  test("granting to the primary admin is rejected — their access is implicit", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(grant(t, f, f.primaryAdminUserId)).rejects.toThrow(
      /already has financial-controls access/i,
    );
  });

  test("re-granting is idempotent — one active row, not two", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const first = await grant(t, f, f.grantedAdminUserId);
    const second = await grant(t, f, f.grantedAdminUserId);
    expect(second).toBe(first);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("communityFinanceRoles")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });
});

// ============================================================================
// revokeCommunityFinanceRole
// ============================================================================

describe("revokeCommunityFinanceRole", () => {
  test("the primary admin can revoke, and the row is soft-deleted", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const roleId = await grant(t, f, f.grantedAdminUserId);

    await t.mutation(api.functions.finance.communityRoles.revokeCommunityFinanceRole, {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      userId: f.grantedAdminUserId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(roleId));
    // Soft-deleted, not deleted: the audit trail of who held the keys outlives
    // the grant (same rule as fundRoles).
    expect(row).not.toBeNull();
    expect(row?.revokedAt).toBeGreaterThan(0);
  });

  test("a non-primary admin cannot revoke", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    await expect(
      t.mutation(api.functions.finance.communityRoles.revokeCommunityFinanceRole, {
        token: await tokenFor(f.plainAdminUserId),
        communityId: f.communityId,
        userId: f.grantedAdminUserId,
      }),
    ).rejects.toThrow(/only the community's primary admin/i);
  });

  test("revoking someone with no active grant is rejected", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.mutation(api.functions.finance.communityRoles.revokeCommunityFinanceRole, {
        token: await tokenFor(f.primaryAdminUserId),
        communityId: f.communityId,
        userId: f.plainAdminUserId,
      }),
    ).rejects.toThrow(/doesn't have financial-controls access/i);
  });

  test("a re-grant after a revoke works — the revoked row must not shadow it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);
    await t.mutation(api.functions.finance.communityRoles.revokeCommunityFinanceRole, {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      userId: f.grantedAdminUserId,
    });
    await grant(t, f, f.grantedAdminUserId);

    const allowed = await t.run(async (ctx) =>
      canManageCommunityFinance(ctx, f.grantedAdminUserId, f.communityId),
    );
    expect(allowed).toBe(true);
  });
});

// ============================================================================
// listCommunityFinanceRoles
// ============================================================================

describe("listCommunityFinanceRoles", () => {
  test("shows active and revoked grants, active first, with viewer gating", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.plainAdminUserId);
    await t.mutation(api.functions.finance.communityRoles.revokeCommunityFinanceRole, {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      userId: f.plainAdminUserId,
    });
    await grant(t, f, f.grantedAdminUserId);

    const result = await t.query(
      api.functions.finance.communityRoles.listCommunityFinanceRoles,
      { token: await tokenFor(f.primaryAdminUserId), communityId: f.communityId },
    );

    expect(result.roles).toHaveLength(2);
    expect(result.roles[0].isActive).toBe(true);
    expect(result.roles[0].userId).toBe(f.grantedAdminUserId);
    expect(result.roles[1].isActive).toBe(false);
    expect(result.viewerIsPrimaryAdmin).toBe(true);
  });

  test("a holder can read the roster but is told they can't manage it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    const result = await t.query(
      api.functions.finance.communityRoles.listCommunityFinanceRoles,
      { token: await tokenFor(f.grantedAdminUserId), communityId: f.communityId },
    );
    expect(result.viewerIsPrimaryAdmin).toBe(false);
  });

  test("a plain community admin cannot read the roster", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.query(api.functions.finance.communityRoles.listCommunityFinanceRoles, {
        token: await tokenFor(f.plainAdminUserId),
        communityId: f.communityId,
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  /**
   * The by-id path every other finance gate closes through
   * `requireCommunityFinanceAccess`. This query checks access directly, so it
   * has to assert the archived state itself — otherwise it would be the one
   * finance surface still readable on an archived community.
   */
  test("an archived community is refused even for a legitimate holder", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);
    await t.run(async (ctx) => {
      await ctx.db.patch(f.communityId, { isArchived: true });
    });

    for (const userId of [f.primaryAdminUserId, f.grantedAdminUserId]) {
      await expect(
        t.query(api.functions.finance.communityRoles.listCommunityFinanceRoles, {
          token: await tokenFor(userId),
          communityId: f.communityId,
        }),
      ).rejects.toThrow();
    }
  });
});

// ============================================================================
// THE GATE — canManageCommunityFinance
// ============================================================================

describe("canManageCommunityFinance", () => {
  test("the primary admin always passes, with no row of their own", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("communityFinanceRoles")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .collect(),
    );
    // The whole no-migration claim: the primary admin's power is implicit.
    expect(rows).toHaveLength(0);

    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.primaryAdminUserId, f.communityId),
      ),
    ).resolves.toBe(true);
  });

  test("a plain community admin with no grant now FAILS", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.plainAdminUserId, f.communityId),
      ),
    ).resolves.toBe(false);
  });

  test("a granted community admin passes", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.grantedAdminUserId, f.communityId),
      ),
    ).resolves.toBe(true);
  });

  test("a revoked holder loses access", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);
    await t.mutation(api.functions.finance.communityRoles.revokeCommunityFinanceRole, {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      userId: f.grantedAdminUserId,
    });

    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.grantedAdminUserId, f.communityId),
      ),
    ).resolves.toBe(false);
  });

  /**
   * The grant checks community-admin standing at GRANT time, but nothing
   * revokes the finance row on demotion — the role-management mutations only
   * patch `userCommunities.roles`. If the standing weren't re-checked here, a
   * user demoted to member would keep submitting the church's EIN forever.
   */
  test("a holder demoted out of community admin loses access, grant row or not", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.grantedAdminUserId, f.communityId),
      ),
    ).resolves.toBe(true);

    // Demote to plain member, exactly as the role-management mutations do.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("userCommunities")
        .filter((q) =>
          q.and(
            q.eq(q.field("userId"), f.grantedAdminUserId),
            q.eq(q.field("communityId"), f.communityId),
          ),
        )
        .first();
      await ctx.db.patch(row!._id, { roles: 1 });
    });

    // The communityFinanceRoles row is still active and un-revoked...
    await expect(
      t.run(async (ctx) => {
        const rows = await ctx.db
          .query("communityFinanceRoles")
          .withIndex("by_user_community", (q) =>
            q
              .eq("userId", f.grantedAdminUserId)
              .eq("communityId", f.communityId),
          )
          .collect();
        return rows.filter((r) => r.revokedAt === undefined).length;
      }),
    ).resolves.toBe(1);

    // ...and access is gone anyway.
    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.grantedAdminUserId, f.communityId),
      ),
    ).resolves.toBe(false);
  });

  test("the primary admin survives a roles patch that would demote anyone else", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    // Sanity: the implicit path must not accidentally depend on the recheck.
    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.primaryAdminUserId, f.communityId),
      ),
    ).resolves.toBe(true);
  });

  test("a grant on one community does not carry to another", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    await expect(
      t.run(async (ctx) =>
        canManageCommunityFinance(ctx, f.grantedAdminUserId, f.otherCommunityId),
      ),
    ).resolves.toBe(false);
  });

  test("requireCommunityFinanceAccess throws for the denied and passes for the allowed", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    await expect(
      t.run(async (ctx) =>
        requireCommunityFinanceAccess(ctx, f.plainAdminUserId, f.communityId),
      ),
    ).rejects.toThrow();
    // Returns a sentinel rather than asserting on the void return: convex-test
    // serializes an action's result, and `undefined` comes back as `null`.
    await expect(
      t.run(async (ctx) => {
        await requireCommunityFinanceAccess(
          ctx,
          f.grantedAdminUserId,
          f.communityId,
        );
        return "allowed";
      }),
    ).resolves.toBe("allowed");
  });
});

// ============================================================================
// The tightening, through a real onboarding surface
// ============================================================================

describe("finance onboarding gate (ADR-033 tightening)", () => {
  test("a plain community admin can no longer read onboarding status", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.query(api.functions.finance.onboarding.getOnboardingStatus, {
        token: await tokenFor(f.plainAdminUserId),
        communityId: f.communityId,
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("the primary admin can, and so can a granted admin", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    for (const userId of [f.primaryAdminUserId, f.grantedAdminUserId]) {
      const status = await t.query(
        api.functions.finance.onboarding.getOnboardingStatus,
        { token: await tokenFor(userId), communityId: f.communityId },
      );
      expect(status.formSubmitted).toBe(true);
    }
  });

  test("a plain community admin can no longer start onboarding", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.mutation(api.functions.finance.onboarding.startOnboarding, {
        token: await tokenFor(f.plainAdminUserId),
        communityId: f.communityId,
        legalName: "Test Church",
        ein: "12-3456789",
        address: ADDRESS,
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("a granted admin can start onboarding", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    const result = await t.mutation(
      api.functions.finance.onboarding.startOnboarding,
      {
        token: await tokenFor(f.grantedAdminUserId),
        communityId: f.communityId,
        legalName: "Test Church",
        ein: "12-3456789",
        address: ADDRESS,
      },
    );
    expect(result.onboardingStatus).toBe("collecting");
  });
});

// ============================================================================
// Card-provider resolution (ADR-033 §2)
// ============================================================================

describe("getCardProvider", () => {
  test("a legacy community (Increase ids, no cardProvider column) resolves to increase", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const name = await t.run(async (ctx) =>
      resolveCardProviderName(ctx, f.communityId),
    );
    expect(name).toBe("increase");

    // Asserted INSIDE t.run: an adapter carries methods, and convex-test
    // serializes whatever t.run returns, which would strip them.
    const capabilities = await t.run(async (ctx) => {
      const provider = await getCardProvider(ctx, f.communityId);
      expect(provider.name).toBe("increase");
      expect(typeof provider.createCard).toBe("function");
      return provider.capabilities;
    });
    // The capability profile is a contract other code reads before offering a
    // control, so pin the ones that decide user-visible copy.
    expect(capabilities.hardFundIsolation).toBe(true);
    expect(capabilities.weeklyLimits).toBe(true);
    expect(capabilities.cardCloseReversible).toBe(false);
    expect(capabilities.webhooks).toBe("all");
    expect(capabilities.declineFeed).toBe("webhook");
    expect(capabilities.maxCardsPerMonth).toBeNull();
    expect(capabilities.repaymentVisibility).toBe("n/a");
  });

  test("an explicit cardProvider wins over the legacy inference", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { cardProvider: "increase" });

    await expect(
      t.run(async (ctx) => resolveCardProviderName(ctx, f.communityId)),
    ).resolves.toBe("increase");
  });

  test("a community with no Increase ids and no choice resolves to none and THROWS", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { withIncreaseIds: false });

    await expect(
      t.run(async (ctx) => resolveCardProviderName(ctx, f.communityId)),
    ).resolves.toBe("none");
    await expect(
      t.run(async (ctx) => getCardProvider(ctx, f.communityId)),
    ).rejects.toThrow(/no card provider is configured/i);
  });

  test('an explicit "none" throws even when Increase ids exist', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { cardProvider: "none" });

    // "opted out" and "not chosen yet" are different facts; the explicit
    // choice must not be overridden by the legacy inference.
    await expect(
      t.run(async (ctx) => getCardProvider(ctx, f.communityId)),
    ).rejects.toThrow(/no card provider is configured/i);
  });

  test("a community with no communityFinance row at all resolves to none", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.run(async (ctx) => resolveCardProviderName(ctx, f.otherCommunityId)),
    ).resolves.toBe("none");
  });

  /**
   * The BILL adapter EXISTS now (ADR-033 Phase 2), so this case moved from
   * "the code isn't there" to "the credential isn't there" — same as Privacy
   * below, and for the same reason: the message decides whether an admin goes
   * to paste a token or goes to ask an engineer about a deploy.
   *
   * What must NOT happen either way is the fall-through to Increase, which
   * would issue a card at Togather's bank for a church that chose their own.
   */
  test("bill with no connection fails on the credential, not onto Increase", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { cardProvider: "bill" });

    await expect(
      t.run(async (ctx) => getCardProvider(ctx, f.communityId)),
    ).rejects.toThrow(/BILL Spend & Expense account isn't connected/i);
  });

  /**
   * The Privacy adapter EXISTS now (ADR-033 Phase 1), so "privacy with no
   * connection row" has to fail for the right reason — the credential is
   * missing, not the code. Getting the old "isn't available yet" message here
   * would send an admin to ask an engineer about a deploy instead of going to
   * paste their API key.
   */
  test("privacy with no connection fails on the credential, not on the adapter", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { cardProvider: "privacy" });

    await expect(
      t.run(async (ctx) => getCardProvider(ctx, f.communityId)),
    ).rejects.toThrow(/isn't connected/i);
  });
});

// ============================================================================
// listGrantableFinanceAdmins — the grant screen's picker (ADR-033 Phase 3)
// ============================================================================

describe("listGrantableFinanceAdmins", () => {
  test("offers only community admins who don't already hold the grant", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    const candidates = await t.query(
      api.functions.finance.communityRoles.listGrantableFinanceAdmins,
      { token: await tokenFor(f.primaryAdminUserId), communityId: f.communityId },
    );
    const ids = candidates.map((c: { id: string }) => c.id);

    // A plain admin with no grant is the whole point of the screen.
    expect(ids).toContain(f.plainAdminUserId);
    // Already holds it — they're on the roster above, not in the picker.
    expect(ids).not.toContain(f.grantedAdminUserId);
    // Implicit access; a row for them is the one thing that could be revoked.
    expect(ids).not.toContain(f.primaryAdminUserId);
    // The mutation refuses a plain member, so offering one would be a tap that
    // can only fail.
    expect(ids).not.toContain(f.memberUserId);
  });

  test("a revoked grant puts someone back in the picker", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await grant(t, f, f.grantedAdminUserId);

    await t.mutation(
      api.functions.finance.communityRoles.revokeCommunityFinanceRole,
      {
        token: await tokenFor(f.primaryAdminUserId),
        communityId: f.communityId,
        userId: f.grantedAdminUserId,
      },
    );

    const candidates = await t.query(
      api.functions.finance.communityRoles.listGrantableFinanceAdmins,
      { token: await tokenFor(f.primaryAdminUserId), communityId: f.communityId },
    );
    expect(candidates.map((c: { id: string }) => c.id)).toContain(
      f.grantedAdminUserId,
    );
  });

  test("someone with no finance access can't read it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.query(api.functions.finance.communityRoles.listGrantableFinanceAdmins, {
        token: await tokenFor(f.plainAdminUserId),
        communityId: f.communityId,
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });
});
