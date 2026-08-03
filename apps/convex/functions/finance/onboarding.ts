/**
 * Group giving: community onboarding (ADR-032 §2).
 *
 * One intake form (startOnboarding) kicks off a background action
 * (provisionProviders) that creates the Stripe connected account and the
 * Increase Entity + receiving/General Accounts, then records the result
 * (recordProvisioned). getOnboardingStatus is the read side the mobile admin
 * checklist polls. enableGroupGiving is the per-group toggle that creates a
 * group's fund, provisions its Increase Account, and grants its current
 * leaders finance_admin — it refuses outright unless the community's own
 * onboarding already reached "live", because provisioning a fund under a
 * half-onboarded community can only fail silently in the background.
 * applyStripeAccountStatus is the monotonic status
 * machine driven by the Stripe `account.updated` webhook (functions/finance/
 * webhooks.ts calls it); the Increase-side counterpart, applyIncreaseEntityStatus,
 * lives in webhooks.ts per the task split (it's purely webhook-driven glue).
 *
 * WHO CAN DO ANY OF THIS CHANGED IN ADR-033. Every public entry point here
 * used to gate on `requireCommunityAdmin`; they now gate on
 * `requireCommunityFinanceAccess` — primary admin, or an explicit
 * `communityFinanceRoles` grant. A plain community admin (roles === 3) with
 * no grant NO LONGER has implicit access to a church's finance setup. That is
 * the deliberate, approved tightening: submitting an EIN, redirecting through
 * Stripe identity verification, and turning giving on for a group are not
 * things "can add a channel" should carry. No migration is needed — the
 * primary admin's access is implicit, so every community keeps exactly one
 * person who can do this on day one, and they grant the rest.
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
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireCommunityFinanceAccess } from "../../lib/finance/communityFinanceAccess";
import { logFinanceAudit } from "../../lib/finance/audit";
import { hasFundRole, isActiveLeader } from "../../lib/helpers";
import { now } from "../../lib/utils";
import { requireGroupGivingEnabled } from "../../lib/finance/flag";
import {
  createConnectedAccount,
  createAccountOnboardingLink,
  attachIncreasePayoutAccount,
  choosePayoutDestination,
  isStripeTestMode,
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

/**
 * Normalize the optional website field: trim, drop empties, and default a
 * bare domain ("firstchurch.org") to https:// — church admins type bare
 * domains, and Stripe's business_profile.url validation hard-rejects
 * scheme-less values, which blocked provisioning with "Not a valid URL".
 * Pure so it's unit-testable.
 */
export function normalizeWebsite(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Deterministic fingerprint of the intake fields that feed the provider
 * requests, appended to every provisioning idempotency key. Same submission →
 * same keys (safe retry, no duplicate provider objects); corrected
 * resubmission → new keys, because Stripe/Increase permanently reject reusing
 * an idempotency key with different parameters — a bare communityId key
 * deadlocked onboarding after any failed-then-corrected first attempt.
 * djb2 over a NUL-joined field list: a uniqueness tag, not a security hash.
 * Pure so it's unit-testable without a Convex context.
 */
export function fingerprintIntake(intake: {
  legalName: string;
  ein: string;
  website?: string;
  statementDescriptor?: string;
  address: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
  };
}): string {
  const joined = [
    intake.legalName,
    intake.ein,
    intake.website ?? "",
    intake.statementDescriptor ?? "",
    intake.address.addressLine1,
    intake.address.addressLine2 ?? "",
    intake.address.city,
    intake.address.state,
    intake.address.zipCode,
  ].join("\u0000");
  let hash = 5381;
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
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
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);
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
      website: normalizeWebsite(args.website),
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
  // Explicit return annotation breaks the self-referential type cycle that
  // otherwise poisons ApiFromModules inference repo-wide (this action calls
  // its own module via `internal.functions.finance.onboarding.*`).
  handler: async (ctx, args): Promise<void> => {
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

    // Idempotency keys carry a fingerprint of the intake data. Same
    // submission retried → same keys → providers return the original objects
    // (no duplicates). CORRECTED submission → new fingerprint → fresh keys —
    // without this, Stripe permanently rejects the retry ("keys can only be
    // used with the same parameters they were first used with"), which
    // deadlocked onboarding whenever the first attempt failed and the admin
    // resubmitted with fixed details (hit live on staging). An earlier
    // attempt's now-orphaned provider objects are harmless: nothing is
    // recorded until recordProvisioned persists the ids we actually use.
    const fp = fingerprintIntake(finance);

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
          idempotencyKey: `finance:stripe-account:${args.communityId}:${fp}`,
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
          idempotencyKey: `finance:entity:${args.communityId}:${fp}`,
        });
        increaseEntityId = entity.id;
      }

      let increaseReceivingAccountId = finance.increaseReceivingAccountId;
      if (!increaseReceivingAccountId) {
        const account = await createAccount(
          increaseEntityId,
          "Receiving Account",
          `finance:receiving-account:${args.communityId}:${fp}`,
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
        `finance:receiving-account-number:${args.communityId}:${fp}`,
      );
      failingProvider = "stripe";
      // Test mode attaches Stripe's test bank account instead of the minted
      // Increase number (see choosePayoutDestination). The idempotency key
      // additionally carries the destination: Stripe caches FAILED requests
      // under their key too, so a retry that switches destinations (e.g.
      // after this fix deploys over a previously failed attach) must not
      // replay the old key with new params.
      const payoutDestination = choosePayoutDestination(
        isStripeTestMode(),
        accountNumber,
      );
      await attachIncreasePayoutAccount(
        stripeConnectedAccountId,
        payoutDestination.routingNumber,
        payoutDestination.accountNumber,
        `finance:payout-destination:${args.communityId}:${fp}:${payoutDestination.routingNumber}-${payoutDestination.accountNumber.slice(-4)}`,
      );

      const generalFundId: Id<"funds"> = await ctx.runMutation(
        internal.functions.finance.onboarding.recordProvisioned,
        {
          communityId: args.communityId,
          stripeConnectedAccountId,
          increaseEntityId,
          increaseReceivingAccountId,
        },
      );

      // ADR-032 §1 puts TWO accounts under the community's Entity: the
      // receiving Account (Stripe's payout destination — a transit account
      // holding money still attributed to individual funds) and a General
      // Account, which is the community-wide fund's own bank account. Without
      // it, `runAllocation` has nowhere to send general-fund money and
      // `getFundsWithIncreaseAccount` skips the fund entirely.
      //
      // It is minted here by the SAME action every other fund's Account goes
      // through, after `recordProvisioned` has created the fund row — because
      // there must be exactly ONE producer of a fund's Increase Account, with
      // exactly one idempotency key per fund. Minting it inline here as well
      // (which is what this used to do, under a community+fingerprint key)
      // gave the General Account two different keys across the three
      // provisioning paths, and Increase dedupes on the key: a backfill run
      // interleaved with this one would have minted a SECOND, unreferenced
      // Account under a KYB'd Entity.
      //
      // Its failure is logged, not reported as a provisioning failure: the
      // community's own onboarding genuinely did succeed, and the missing
      // Account self-heals (next `enableGroupGiving`, `retryProvisioning`, or
      // migrations/backfillGeneralFundAccounts.ts) without an admin-facing
      // blocked state that they cannot act on.
      try {
        await ctx.runAction(
          internal.functions.finance.onboarding.provisionFundAccount,
          { fundId: generalFundId },
        );
      } catch (generalAccountError) {
        console.error(
          `[finance] provisionProviders: community ${args.communityId} is provisioned but its General Account could not be created — it will be healed by the next enableGroupGiving/backfill`,
          generalAccountError,
        );
      }
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
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);
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
  // Returns the community's General fund id so `provisionProviders` can mint
  // its Increase Account through `provisionFundAccount` — the single producer
  // of every fund's Account (see the comment at that call site).
  handler: async (ctx, args): Promise<Id<"funds">> => {
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

    if (existingGeneralFund) {
      // Communities provisioned before the General Account existed (see
      // migrations/backfillGeneralFundAccounts.ts) have a general fund with no
      // bank account behind it. Returning it heals them: the caller runs
      // `provisionFundAccount` on it, which is a no-op if it already has one.
      return existingGeneralFund._id;
    }

    // The fund is created WITHOUT an `increaseAccountId`; the caller binds one
    // moments later via `provisionFundAccount`. Two reasons it isn't set here:
    // the Account has to be keyed on the fund id (which only exists after this
    // insert), and every fund's Account must come from one code path or the
    // idempotency keys drift apart. A general fund that ends up without an
    // Account isn't silently broken — allocation fails its items loudly and
    // the fund is picked up by the backfill/self-heal.
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
    return fundId;
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
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);
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
        // Stored intake values, echoed so "Edit church details" can prefill
        // the form — without this an admin fixing one rejected field had to
        // retype the entire form.
        intake: null as {
          legalName: string;
          ein: string;
          website?: string;
          statementDescriptor?: string;
          address: {
            addressLine1: string;
            addressLine2?: string;
            city: string;
            state: string;
            zipCode: string;
          };
        } | null,
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
      intake: {
        legalName: finance.legalName,
        ein: finance.ein,
        website: finance.website,
        statementDescriptor: finance.statementDescriptor,
        address: finance.address,
      },
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
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);
    await requireGroupGivingEnabled(ctx);

    const group = await ctx.db.get(args.groupId);
    if (!group || group.communityId !== args.communityId) {
      throw new Error("Group not found in this community");
    }

    // The community's OWN giving has to be live first. Without this check the
    // toggle "succeeded" against a community that had never finished (or had
    // failed) onboarding: the fund row appeared, leaders got finance_admin,
    // the admin saw a success toast — and then provisionFundAccount hit a
    // community with no Increase Entity, logged to the server console, and
    // returned. The result was a fund with no bank account behind it and no
    // error anywhere the admin could see. Fail here, loudly, instead.
    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!finance) {
      throw new Error(
        "Set up giving for this community first — Community Settings → Finance",
      );
    }
    if (finance.onboardingStatus !== "live") {
      throw new Error(
        finance.onboardingStatus === "stripe_blocked" ||
        finance.onboardingStatus === "increase_blocked"
          ? "This community's giving setup needs attention before groups can be enabled — check Community Settings → Finance"
          : "This community's giving setup isn't finished yet — finish verification in Community Settings → Finance, then enable groups",
      );
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
    // scheduled; provisionFundAccount itself no-ops if the fund already
    // has one, so a second enableGroupGiving call (or a scheduler retry)
    // never creates a duplicate Account.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.onboarding.provisionFundAccount,
      { fundId },
    );

    // Self-heal the community's General Account on the way past. Communities
    // onboarded before ADR-032 §1's General Account was actually built have a
    // general fund with no `increaseAccountId`, which silently excludes it
    // from allocation and nightly reconcile. This is the same no-op-if-present
    // action, so it costs nothing once healed; migrations/
    // backfillGeneralFundAccounts.ts is the bulk path for communities whose
    // admin never touches this toggle.
    const generalFund = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("type"), "general"))
      .first();
    if (generalFund && !generalFund.increaseAccountId) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.finance.onboarding.provisionFundAccount,
        { fundId: generalFund._id },
      );
    }

    return { fundId, created: fundCreated };
  },
});

// ============================================================================
// provisionFundAccount — the ONE producer of a fund's Increase Account. Works
// for both fund types: a group's Account (the enableGroupGiving path) and the
// community's General Account (provisionProviders, the enableGroupGiving
// self-heal, and migrations/backfillGeneralFundAccounts.ts all route here).
// ============================================================================

/**
 * The Increase idempotency key for a fund's Account. One key per fund,
 * forever — Increase dedupes on it, so two DIFFERENT keys for the same
 * logical account are two different bank Accounts under a KYB'd Entity.
 *
 * The `group-account` prefix is kept for group funds rather than unified to
 * something tidier: changing it would ask Increase for a SECOND Account for
 * any group fund whose first attempt is still in flight under the old key.
 * The General Account has no such history — it was never minted under a
 * fund-scoped key at all — so it takes the honest `general-account` prefix.
 *
 * Pure so it's unit-testable, and exported so tests can assert the exact key
 * every provisioning path asks Increase for.
 */
export function fundAccountIdempotencyKey(
  fundType: "general" | "group",
  fundId: Id<"funds">,
): string {
  return `finance:${fundType}-account:${fundId}`;
}

export const provisionFundAccount = internalAction({
  args: { fundId: v.id("funds") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    provisioned: boolean;
    reopenedCount: number;
    reopenedCents: number;
  }> => {
    const noop = { provisioned: false, reopenedCount: 0, reopenedCents: 0 };
    const fund = await ctx.runQuery(
      internal.functions.finance.onboarding.getFundInternal,
      { fundId: args.fundId },
    );
    if (!fund || fund.increaseAccountId) {
      // Already provisioned (retry-safe no-op), or the fund is gone.
      return noop;
    }

    const finance = await ctx.runQuery(
      internal.functions.finance.onboarding.getCommunityFinanceInternal,
      { communityId: fund.communityId },
    );
    if (!finance?.increaseEntityId) {
      // The community hasn't finished its own onboarding yet. Since
      // enableGroupGiving now refuses a non-live community outright, reaching
      // here means a stray/queued run — fail soft: log and return rather than
      // throw, so a scheduler retry doesn't spam errors.
      console.error(
        `[finance] provisionFundAccount: community ${fund.communityId} has no Increase Entity yet — cannot create an Account for fund ${args.fundId}`,
      );
      return noop;
    }

    const account = await createAccount(
      finance.increaseEntityId,
      fund.name,
      fundAccountIdempotencyKey(fund.type, args.fundId),
    );

    return await ctx.runMutation(
      internal.functions.finance.onboarding.recordFundAccount,
      { fundId: args.fundId, increaseAccountId: account.id },
    );
  },
});

export const recordFundAccount = internalMutation({
  args: { fundId: v.id("funds"), increaseAccountId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    provisioned: boolean;
    reopenedCount: number;
    reopenedCents: number;
  }> => {
    const fund = await ctx.db.get(args.fundId);
    if (!fund || fund.increaseAccountId) {
      // already recorded — idempotent no-op
      return { provisioned: false, reopenedCount: 0, reopenedCents: 0 };
    }

    // ------------------------------------------------------------------
    // Reconcile the fund's history BEFORE it enters reconcile scope.
    //
    // `getFundsWithIncreaseAccount` selects on `increaseAccountId`, so the
    // patch below is the exact instant the nightly invariant starts covering
    // this fund. Any donation already marked "allocated" on a fund that had
    // no Account cannot have settled — there was no Account to transfer it
    // into. (This is how general-fund donations behaved before ADR-032 §1's
    // General Account was actually built: `runAllocation` special-cased them
    // and flipped them to "allocated" with no transfer at all.) Their cash is
    // still sitting in the community's receiving Account.
    //
    // Bringing the fund into scope on top of that history would report
    // `drift = the whole historical balance` every night, forever — killing,
    // through alarm fatigue, the one control that would catch real theft. So
    // reopen them: "pending" is what they factually are, and it is what makes
    // the invariant hold on the very first night
    // (ledger == bank 0 + pending), with the money movement left to the
    // ordinary allocation path rather than invented here.
    //
    // The ledger is untouched — it is APPEND-ONLY, and nothing needs
    // appending: allocation deliberately posts no credit (the donation credit
    // already happened at gift time), so an allocation that never moved money
    // left no ledger entry to reverse.
    // ------------------------------------------------------------------
    const settledWithoutTransfer = await ctx.db
      .query("donations")
      .withIndex("by_fund", (q) => q.eq("fundId", args.fundId))
      .filter((q) => q.eq(q.field("allocationStatus"), "allocated"))
      .collect();

    let reopenedCents = 0;
    for (const donation of settledWithoutTransfer) {
      await ctx.db.patch(donation._id, { allocationStatus: "pending" });
      // Sum on the same basis `computePendingAllocationCents` will now count
      // them: the delivered net once a payout bound one, gross otherwise.
      reopenedCents +=
        donation.payoutNetCents ?? donation.amountCents + donation.feeCoverCents;
    }

    await ctx.db.patch(args.fundId, {
      increaseAccountId: args.increaseAccountId,
      updatedAt: now(),
    });

    // Binding a fund to a bank account is a control-plane event worth a
    // trail: it's the moment allocation and nightly reconcile start covering
    // the fund, and for a backfilled General Account it's the only record of
    // when that gap closed.
    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: args.fundId,
      action: "fund.account_provisioned",
      details: { type: fund.type, increaseAccountId: args.increaseAccountId },
    });

    if (settledWithoutTransfer.length > 0) {
      await logFinanceAudit(ctx, {
        communityId: fund.communityId,
        fundId: args.fundId,
        action: "allocation.reopened",
        details: {
          reason: "fund_account_provisioned_after_the_fact",
          reopenedCount: settledWithoutTransfer.length,
          reopenedCents,
          // Capped: the point of the row is that an operator can find the
          // affected gifts, not that it holds an unbounded array.
          donationIds: settledWithoutTransfer.slice(0, 100).map((d) => d._id),
          truncated: settledWithoutTransfer.length > 100,
        },
      });
    }

    return {
      provisioned: true,
      reopenedCount: settledWithoutTransfer.length,
      reopenedCents,
    };
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
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);
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
