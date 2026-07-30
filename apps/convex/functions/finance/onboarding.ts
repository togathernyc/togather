/**
 * Group giving: community onboarding (ADR-032 §2).
 *
 * One intake form (startOnboarding) kicks off a background action
 * (provisionProviders) that creates the Stripe connected account and the
 * Increase Entity + receiving/General Accounts, then records the result
 * (recordProvisioned). getOnboardingStatus is the read side the mobile admin
 * checklist polls. enableGroupGiving is the per-group toggle that creates a
 * group's fund, provisions its Increase Account, and grants its current
 * leaders finance_admin. applyStripeAccountStatus is the monotonic status
 * machine driven by the Stripe `account.updated` webhook (functions/finance/
 * webhooks.ts calls it); the Increase-side counterpart, applyIncreaseEntityStatus,
 * lives in webhooks.ts per the task split (it's purely webhook-driven glue).
 *
 * Every external write is idempotency-keyed off the community/fund id (see
 * lib/finance/increase.ts, lib/finance/stripeConnect.ts) so a retried action
 * — the scheduler retries a throwing action's *next* run, not the failed one
 * automatically, but an admin re-submitting the form or us re-running
 * provisionProviders by hand is always safe — re-resolves to the same
 * provider objects instead of creating duplicates.
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { requireCommunityAdmin } from "../../lib/permissions";
import { logFinanceAudit } from "../../lib/finance/audit";
import { hasFundRole, isActiveLeader } from "../../lib/helpers";
import { now } from "../../lib/utils";
import { requireGroupGivingEnabled } from "../../lib/finance/flag";
import {
  createConnectedAccount,
  createAccountOnboardingLink,
  attachIncreasePayoutAccount,
} from "../../lib/finance/stripeConnect";
import { createEntity, createAccount, createAccountNumber } from "../../lib/finance/increase";

// ============================================================================
// EIN validation
// ============================================================================

/** IRS EIN format: NN-NNNNNNN (two digits, dash, seven digits). */
const EIN_REGEX = /^\d{2}-\d{7}$/;

/** Mirrors communityFinance.onboardingStatus in schema.ts. Declared explicitly
 * (rather than derived via `typeof finance.onboardingStatus`) because a prior
 * `if (finance.onboardingStatus === "live") return;` guard narrows that
 * expression's type to exclude "live" for the rest of the function — which
 * would then reject assigning "live" back onto a `nextStatus` variable typed
 * from it. */
type OnboardingStatus =
  | "collecting"
  | "verifying"
  | "live"
  | "stripe_blocked"
  | "increase_blocked";

/** Pure so it's unit-testable without a Convex context (mirrors isAnomalousCountChange in billing.ts). */
export function isValidEin(ein: string): boolean {
  return EIN_REGEX.test(ein);
}

// ============================================================================
// Shared address validator (mirrors communityFinance.address in schema.ts)
// ============================================================================

const addressValidator = v.object({
  addressLine1: v.string(),
  addressLine2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  zipCode: v.string(),
});

// ============================================================================
// startOnboarding — the one intake form (ADR-032 §2 step 1)
// ============================================================================

export const startOnboarding = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    legalName: v.string(),
    ein: v.string(),
    website: v.optional(v.string()),
    statementDescriptor: v.optional(v.string()),
    address: addressValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    await requireGroupGivingEnabled(ctx);

    if (!isValidEin(args.ein)) {
      throw new Error(
        `EIN must be in NN-NNNNNNN format (e.g. "12-3456789"), got "${args.ein}"`,
      );
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    const previousStatus = existing?.onboardingStatus;

    const fields = {
      legalName: args.legalName,
      ein: args.ein,
      website: args.website,
      statementDescriptor: args.statementDescriptor,
      address: args.address,
      onboardingStatus: "collecting" as const,
      // A resubmitted form re-schedules provisioning below — clear any stale
      // failure message so the checklist reflects the fresh attempt.
      provisioningError: undefined,
      updatedAt: timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("communityFinance", {
        communityId: args.communityId,
        ...fields,
        createdAt: timestamp,
      });
    }

    // Always log the transition, even "collecting" -> "collecting" (a
    // corrected re-submission) — the audit trail should show every intake
    // form save, not just status changes.
    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      actorUserId: userId,
      action: "onboarding.status_changed",
      details: {
        from: previousStatus ?? null,
        to: "collecting",
        reason: existing ? "intake_form_resubmitted" : "intake_form_submitted",
      },
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.onboarding.provisionProviders,
      { communityId: args.communityId },
    );

    return { onboardingStatus: "collecting" as const };
  },
});

// ============================================================================
// provisionProviders — creates Stripe connected account + Increase Entity /
// receiving Account (ADR-032 §2 steps 2-3), then hands off to recordProvisioned.
// ============================================================================

export const getCommunityFinanceInternal = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
  },
});

export const provisionProviders = internalAction({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const finance = await ctx.runQuery(
      internal.functions.finance.onboarding.getCommunityFinanceInternal,
      { communityId: args.communityId },
    );
    if (!finance) {
      // Shouldn't happen — startOnboarding always writes the row before
      // scheduling this — but a stray/duplicate scheduled run should log,
      // not throw (throwing would just retry against a still-missing row).
      console.error(
        `[finance] provisionProviders: no communityFinance row for community ${args.communityId}`,
      );
      return;
    }

    // A failed provider call must not vanish into the scheduler (there's no
    // webhook yet at this stage to explain a stall) — record which provider
    // broke so the checklist can show a blocked state with the reason
    // instead of a permanent "In progress".
    let failingProvider: "stripe" | "increase" = "stripe";
    try {
      // Every external call is keyed on the community id, not a fresh random
      // key per attempt — a retried provisionProviders run resolves to the
      // SAME provider objects instead of creating duplicates.
      let stripeConnectedAccountId = finance.stripeConnectedAccountId;
      if (!stripeConnectedAccountId) {
        stripeConnectedAccountId = await createConnectedAccount({
          legalName: finance.legalName,
          ein: finance.ein,
          website: finance.website,
          address: finance.address,
          statementDescriptor: finance.statementDescriptor,
          idempotencyKey: `finance:stripe-account:${args.communityId}`,
        });
      }

      failingProvider = "increase";
      let increaseEntityId = finance.increaseEntityId;
      if (!increaseEntityId) {
        const entity = await createEntity({
          legalName: finance.legalName,
          ein: finance.ein,
          website: finance.website,
          address: finance.address,
          idempotencyKey: `finance:entity:${args.communityId}`,
        });
        increaseEntityId = entity.id;
      }

      let increaseReceivingAccountId = finance.increaseReceivingAccountId;
      if (!increaseReceivingAccountId) {
        const account = await createAccount(
          increaseEntityId,
          "Receiving Account",
          `finance:receiving-account:${args.communityId}`,
        );
        increaseReceivingAccountId = account.id;
      }

      // Mint an Account Number for the receiving Account and set it as the
      // connected account's payout destination. Both calls carry a
      // community-derived idempotency key (Increase's on the account-number
      // create; Stripe's external-account attach doesn't take one natively, so
      // stripeConnect.ts passes it via Stripe's request-options idempotency
      // key), so re-running this step on retry never mints a second bank
      // account or attaches a second payout destination.
      const accountNumber = await createAccountNumber(
        increaseReceivingAccountId,
        "Stripe payout destination",
        `finance:receiving-account-number:${args.communityId}`,
      );
      failingProvider = "stripe";
      await attachIncreasePayoutAccount(
        stripeConnectedAccountId,
        accountNumber.routingNumber,
        accountNumber.accountNumber,
        `finance:payout-destination:${args.communityId}`,
      );

      await ctx.runMutation(
        internal.functions.finance.onboarding.recordProvisioned,
        {
          communityId: args.communityId,
          stripeConnectedAccountId,
          increaseEntityId,
          increaseReceivingAccountId,
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[finance] provisionProviders failed (${failingProvider}) for community ${args.communityId}: ${message}`,
      );
      await ctx.runMutation(
        internal.functions.finance.onboarding.recordProvisioningFailure,
        {
          communityId: args.communityId,
          provider: failingProvider,
          message: message.slice(0, 500),
        },
      );
    }
  },
});

// ============================================================================
// recordProvisioningFailure — marks onboarding blocked when provisionProviders
// itself failed, so the checklist shows the reason instead of "In progress".
// ============================================================================

export const recordProvisioningFailure = internalMutation({
  args: {
    communityId: v.id("communities"),
    provider: v.union(v.literal("stripe"), v.literal("increase")),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!finance) return;
    // Never regress "live" — a stray retried run failing after the community
    // already went live must not flip a working community to blocked.
    if (finance.onboardingStatus === "live") return;
    // Same for a fully provisioned row: overlapping provisionProviders runs
    // are possible (each resubmit/retry schedules one), and a stale failing
    // run must not overwrite a newer run's recorded success — especially
    // since retryProvisioning refuses fully-provisioned rows, which would
    // leave the false blocked state permanently stuck.
    if (
      finance.stripeConnectedAccountId &&
      finance.increaseEntityId &&
      finance.increaseReceivingAccountId
    ) {
      return;
    }

    const previousStatus = finance.onboardingStatus;
    const nextStatus =
      args.provider === "stripe" ? ("stripe_blocked" as const) : ("increase_blocked" as const);
    await ctx.db.patch(finance._id, {
      onboardingStatus: nextStatus,
      provisioningError: args.message,
      updatedAt: now(),
    });
    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      action: "onboarding.provisioning_failed",
      details: {
        from: previousStatus,
        to: nextStatus,
        provider: args.provider,
        message: args.message,
      },
    });
  },
});

// ============================================================================
// retryProvisioning — admin-triggered re-run after a provisioning failure.
// Safe to repeat: every provider call in provisionProviders is idempotency-
// keyed on the community id.
// ============================================================================

export const retryProvisioning = mutation({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    await requireGroupGivingEnabled(ctx);

    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!finance) {
      throw new Error("Onboarding hasn't started — submit the church details form first");
    }
    const fullyProvisioned =
      !!finance.stripeConnectedAccountId &&
      !!finance.increaseEntityId &&
      !!finance.increaseReceivingAccountId;
    if (fullyProvisioned) {
      // All provider objects exist — blocked states past this point come
      // from webhooks (e.g. Stripe requirements) and resolve via the hosted
      // flow, not by re-provisioning. Re-running would also clobber a
      // legitimate webhook-set blocked status back to "verifying".
      throw new Error("Accounts are already set up — nothing to retry");
    }

    await ctx.db.patch(finance._id, {
      onboardingStatus: "collecting",
      provisioningError: undefined,
      updatedAt: now(),
    });
    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      actorUserId: userId,
      action: "onboarding.provisioning_retried",
      details: { from: finance.onboardingStatus },
    });
    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.onboarding.provisionProviders,
      { communityId: args.communityId },
    );
    return { onboardingStatus: "collecting" as const };
  },
});

// ============================================================================
// recordProvisioned — persists provider ids, advances to "verifying", and
// creates the community's General fund exactly once.
// ============================================================================

export const recordProvisioned = internalMutation({
  args: {
    communityId: v.id("communities"),
    stripeConnectedAccountId: v.string(),
    increaseEntityId: v.string(),
    increaseReceivingAccountId: v.string(),
  },
  handler: async (ctx, args) => {
    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!finance) {
      throw new Error(
        `recordProvisioned: no communityFinance row for community ${args.communityId}`,
      );
    }

    const timestamp = now();
    const previousStatus = finance.onboardingStatus;
    // Never regress "live" (see applyStripeAccountStatus) — a retried
    // provisionProviders run after the community already went live should
    // just refresh the (identical) provider ids, not touch status.
    const nextStatus = previousStatus === "live" ? previousStatus : "verifying";

    await ctx.db.patch(finance._id, {
      stripeConnectedAccountId: args.stripeConnectedAccountId,
      increaseEntityId: args.increaseEntityId,
      increaseReceivingAccountId: args.increaseReceivingAccountId,
      onboardingStatus: nextStatus,
      updatedAt: timestamp,
    });

    if (nextStatus !== previousStatus) {
      await logFinanceAudit(ctx, {
        communityId: args.communityId,
        action: "onboarding.status_changed",
        details: {
          from: previousStatus,
          to: nextStatus,
          reason: "providers_provisioned",
        },
      });
    }

    // Create the community's General fund exactly once — retries of this
    // mutation (idempotency-keyed the same as everything else here, since
    // recordProvisioned itself is only ever called with the actual provider
    // ids that were just created/confirmed) must never insert a second one.
    const existingGeneralFund = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("type"), "general"))
      .first();

    if (!existingGeneralFund) {
      const fundId = await ctx.db.insert("funds", {
        communityId: args.communityId,
        name: "General Fund",
        type: "general",
        status: "active",
        balanceCents: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await logFinanceAudit(ctx, {
        communityId: args.communityId,
        fundId,
        action: "fund.created",
        details: { type: "general", name: "General Fund" },
      });
    }
  },
});

// ============================================================================
// getOnboardingStatus — the two-item checklist the mobile admin UI polls
// (ADR-032 §2 step 4: "Payments verification" / "Bank accounts").
// ============================================================================

export const getOnboardingStatus = query({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    await requireGroupGivingEnabled(ctx);

    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();

    if (!finance) {
      return {
        formSubmitted: false,
        // False until provisionProviders lands the Stripe connected account —
        // the "Continue identity verification" action is impossible before
        // then (getStripeOnboardingLinkUrl would throw), so the UI shows a
        // "setting up" state instead of an actionable button.
        providersReady: false,
        paymentsVerified: false,
        bankAccountsReady: false,
        onboardingStatus: null as OnboardingStatus | null,
        blockedReason: null as "stripe_blocked" | "increase_blocked" | null,
        provisioningError: null as string | null,
      };
    }

    // "verifying" only exists once recordProvisioned has written both
    // Increase ids alongside it, so bankAccountsReady and paymentsVerified
    // are both derivable from onboardingStatus + the stored ids without any
    // live provider call (queries can't fetch external APIs).
    return {
      formSubmitted: true,
      providersReady: !!finance.stripeConnectedAccountId,
      paymentsVerified: finance.onboardingStatus === "live",
      bankAccountsReady:
        !!finance.increaseEntityId && !!finance.increaseReceivingAccountId,
      onboardingStatus: finance.onboardingStatus,
      blockedReason:
        finance.onboardingStatus === "stripe_blocked" ||
        finance.onboardingStatus === "increase_blocked"
          ? finance.onboardingStatus
          : null,
      provisioningError: finance.provisioningError ?? null,
    };
  },
});

// ============================================================================
// enableGroupGiving — per-group toggle (ADR-032 §2 step 4 / §4).
// ============================================================================

export const getFundInternal = internalQuery({
  args: { fundId: v.id("funds") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fundId);
  },
});

export const enableGroupGiving = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    await requireGroupGivingEnabled(ctx);

    const group = await ctx.db.get(args.groupId);
    if (!group || group.communityId !== args.communityId) {
      throw new Error("Group not found in this community");
    }

    let fund = await ctx.db
      .query("funds")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first();
    let fundCreated = false;

    if (!fund) {
      const timestamp = now();
      const fundId = await ctx.db.insert("funds", {
        communityId: args.communityId,
        groupId: args.groupId,
        name: `${group.name} Fund`,
        type: "group",
        status: "active",
        balanceCents: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      fund = await ctx.db.get(fundId);
      fundCreated = true;
      await logFinanceAudit(ctx, {
        communityId: args.communityId,
        fundId,
        actorUserId: userId,
        action: "fund.created",
        details: { type: "group", groupId: args.groupId, name: `${group.name} Fund` },
      });
    }
    if (!fund) {
      // Unreachable — we either found it above or just inserted+read it back.
      throw new Error("enableGroupGiving: failed to load the group's fund");
    }

    // A frozen fund on an UN-archived group is the unarchive case: archiving
    // froze it (freezeFundForArchivedGroup), the group came back, and this
    // toggle is how an admin turns giving back on. Reactivate the same fund
    // (its history and balance are still valid — nothing was swept in
    // Phase 1/2). Closed funds stay closed: their balance was swept, so a
    // re-enable should mint a fresh fund — not supported until the sweep
    // mutation exists (Phase 2 admin tooling), so reject with a clear error.
    if (fund.status === "frozen" && !group.isArchived) {
      await ctx.db.patch(fund._id, { status: "active", updatedAt: now() });
      await logFinanceAudit(ctx, {
        communityId: args.communityId,
        fundId: fund._id,
        actorUserId: userId,
        action: "fund.reactivated",
        details: { reason: "group_unarchived" },
      });
      fund = await ctx.db.get(fund._id);
      if (!fund) throw new Error("enableGroupGiving: fund vanished mid-update");
    } else if (fund.status === "closed") {
      throw new Error(
        "This group's fund was closed and its balance swept — re-opening it needs the Phase-2 fund tooling",
      );
    }
    const fundId = fund._id;

    // Grant finance_admin to every currently-active leader who doesn't
    // already hold an active fund role. Idempotent: calling this twice for
    // the same group never re-grants (and thus never duplicates) a role for
    // a leader who already has one — only newly-added leaders get granted on
    // a later call.
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    for (const membership of memberships) {
      if (!isActiveLeader(membership)) continue;

      const existingRoles = await ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", membership.userId).eq("fundId", fundId),
        )
        .collect();
      const alreadyHasActiveRole = existingRoles.some((role) =>
        hasFundRole(role, "cardholder"),
      );
      if (alreadyHasActiveRole) continue;

      await ctx.db.insert("fundRoles", {
        fundId,
        userId: membership.userId,
        role: "finance_admin",
        grantedBy: userId,
        grantedAt: now(),
      });
      await logFinanceAudit(ctx, {
        communityId: args.communityId,
        fundId,
        actorUserId: userId,
        action: "role.granted",
        details: {
          targetUserId: membership.userId,
          role: "finance_admin",
          reason: "group_giving_enabled",
        },
      });
    }

    // Provision the group's Increase Account in the background — always
    // scheduled; provisionGroupFundAccount itself no-ops if the fund already
    // has one, so a second enableGroupGiving call (or a scheduler retry)
    // never creates a duplicate Account.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.onboarding.provisionGroupFundAccount,
      { fundId },
    );

    return { fundId, created: fundCreated };
  },
});

// ============================================================================
// provisionGroupFundAccount — mints the group's Increase Account once its
// fund exists and the community's Increase Entity is provisioned.
// ============================================================================

export const provisionGroupFundAccount = internalAction({
  args: { fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const fund = await ctx.runQuery(
      internal.functions.finance.onboarding.getFundInternal,
      { fundId: args.fundId },
    );
    if (!fund || fund.increaseAccountId) {
      // Already provisioned (retry-safe no-op), or the fund is gone.
      return;
    }

    const finance = await ctx.runQuery(
      internal.functions.finance.onboarding.getCommunityFinanceInternal,
      { communityId: fund.communityId },
    );
    if (!finance?.increaseEntityId) {
      // The community hasn't finished its own onboarding yet. This
      // shouldn't happen — enableGroupGiving is community-admin gated on a
      // community whose giving is already live — but fail soft: log and
      // return rather than throw, so a stray retry doesn't spam errors.
      console.error(
        `[finance] provisionGroupFundAccount: community ${fund.communityId} has no Increase Entity yet — cannot create group Account for fund ${args.fundId}`,
      );
      return;
    }

    const account = await createAccount(
      finance.increaseEntityId,
      fund.name,
      `finance:group-account:${args.fundId}`,
    );

    await ctx.runMutation(
      internal.functions.finance.onboarding.recordFundAccount,
      { fundId: args.fundId, increaseAccountId: account.id },
    );
  },
});

export const recordFundAccount = internalMutation({
  args: { fundId: v.id("funds"), increaseAccountId: v.string() },
  handler: async (ctx, args) => {
    const fund = await ctx.db.get(args.fundId);
    if (!fund || fund.increaseAccountId) return; // already recorded — idempotent no-op
    await ctx.db.patch(args.fundId, {
      increaseAccountId: args.increaseAccountId,
      updatedAt: now(),
    });
  },
});

// ============================================================================
// applyStripeAccountStatus — driven by the Stripe `account.updated` webhook
// (functions/finance/webhooks.ts's handleFinanceStripeEvent). Monotonic
// toward "live"; the Increase-side counterpart (applyIncreaseEntityStatus)
// lives in webhooks.ts since it's purely webhook-driven glue.
// ============================================================================

export const applyStripeAccountStatus = internalMutation({
  args: {
    accountId: v.string(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    /** Stripe's `requirements.disabled_reason` — present means Stripe has paused the account. */
    disabledReason: v.optional(v.string()),
    /** Stripe's `requirements.currently_due` — surfaced to the admin checklist as remediation steps. */
    requirementsSummary: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // No index on stripeConnectedAccountId exists on communityFinance (only
    // by_community) — schema.ts is out of scope for this change, so this is
    // a full-table filter. Fine at today's community count; worth an index
    // if/when webhook volume grows.
    const finance = await ctx.db
      .query("communityFinance")
      .filter((q) => q.eq(q.field("stripeConnectedAccountId"), args.accountId))
      .first();
    if (!finance) {
      console.error(
        `[finance] applyStripeAccountStatus: no communityFinance row for Stripe account ${args.accountId}`,
      );
      return;
    }

    // Monotonic: once live, stay live. A later webhook reporting a
    // transient dip (e.g. charges briefly disabled during a Stripe review)
    // must never bounce an already-live community back to "verifying" or
    // "stripe_blocked".
    if (finance.onboardingStatus === "live") {
      return;
    }

    // "Provisioned" means both the Increase ids exist AND the Increase side
    // isn't currently blocked — an entity that was provisioned and later
    // disabled (increase_blocked) must not count as ready just because its
    // ids are still on the row.
    const increaseProvisioned =
      !!finance.increaseEntityId &&
      !!finance.increaseReceivingAccountId &&
      finance.onboardingStatus !== "increase_blocked";

    let nextStatus: OnboardingStatus;
    if (args.chargesEnabled && args.payoutsEnabled && increaseProvisioned) {
      nextStatus = "live";
    } else if (args.disabledReason) {
      nextStatus = "stripe_blocked";
    } else if (finance.onboardingStatus === "increase_blocked") {
      // Don't let a routine Stripe update clear an Increase-side block.
      nextStatus = "increase_blocked";
    } else {
      nextStatus = "verifying";
    }

    if (nextStatus === finance.onboardingStatus) return; // no-op — no audit noise for a repeat/duplicate webhook

    await ctx.db.patch(finance._id, {
      onboardingStatus: nextStatus,
      updatedAt: now(),
    });
    await logFinanceAudit(ctx, {
      communityId: finance.communityId,
      action: "onboarding.status_changed",
      details: {
        from: finance.onboardingStatus,
        to: nextStatus,
        reason:
          nextStatus === "live"
            ? "stripe_and_increase_ready"
            : nextStatus === "stripe_blocked"
              ? args.disabledReason
              : "stripe_pending",
        requirementsSummary: args.requirementsSummary,
      },
    });
  },
});

// ============================================================================
// freezeFundForArchivedGroup — ADR-032 §3 "Group archive" (the freeze half
// only; the bank-side sweep — AccountTransfer the remainder to General,
// close the Account, paired sweep ledger entries — is a deferred Phase-2
// admin mutation, see ARCHITECTURE.md's "Known Seams & TODOs").
// ============================================================================

export const freezeFundForArchivedGroup = internalMutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const fund = await ctx.db
      .query("funds")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first();
    if (!fund || fund.status !== "active") {
      // No fund (giving was never enabled for this group), or it's already
      // frozen/closed — idempotent no-op either way, safe for a scheduler
      // retry or a re-archive of an already-archived group.
      return;
    }

    await ctx.db.patch(fund._id, { status: "frozen", updatedAt: now() });
    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "fund.frozen",
      details: { reason: "group_archived" },
    });
  },
});

// ============================================================================
// getStripeOnboardingLinkUrl — the "one redirect" of ADR-032 §2. Account
// links expire within minutes, so the URL is minted on demand per tap, never
// stored. Lives here (not the mobile client) so STRIPE_SECRET_KEY stays
// server-side.
// ============================================================================

/** Auth + admin gate for the action below (actions have no ctx.db). */
export const assertAdminAndGetFinance = internalQuery({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    await requireGroupGivingEnabled(ctx);
    return await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
  },
});

export const getStripeOnboardingLinkUrl = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    returnUrl: v.string(),
    refreshUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    for (const url of [args.returnUrl, args.refreshUrl]) {
      // Strict https-only: Stripe's hosted onboarding requires https
      // return/refresh URLs, and the app's own deep-linking uses https
      // universal links — there is no legitimate non-https scheme here, so
      // requiring https by construction also rejects javascript:/data:/etc.
      // without needing a separate denylist to keep in sync.
      if (!/^https:\/\//i.test(url)) {
        throw new Error("Invalid return/refresh URL — must be https");
      }
    }

    const finance = await ctx.runQuery(
      internal.functions.finance.onboarding.assertAdminAndGetFinance,
      { token: args.token, communityId: args.communityId },
    );
    if (!finance?.stripeConnectedAccountId) {
      throw new Error(
        "Onboarding hasn't started — submit the church details form first",
      );
    }

    const url = await createAccountOnboardingLink(
      finance.stripeConnectedAccountId,
      args.returnUrl,
      args.refreshUrl,
    );
    return { url };
  },
});
