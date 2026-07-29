/**
 * Expense submission, approval, and reimbursement payout (ADR-032 §3-4).
 *
 * Card-charge expenses are out of scope here — Phase 3 (cards) creates those
 * from the card-transaction webhook. This file only handles the
 * member-submitted reimbursement flow: submit -> approve/deny -> pay.
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { now, getDisplayName, getMediaUrl } from "../../lib/utils";
import { isCommunityAdmin } from "../../lib/permissions";
import { logFinanceAudit } from "../../lib/finance/audit";
import { requireGroupGivingEnabled } from "../../lib/finance/flag";
import { postLedgerEntry } from "../../lib/finance/ledger";
import {
  requireFundRole,
  requireFundRoleOrGroupLeader,
  isActiveMember,
  type FundRole,
} from "../../lib/helpers";
import {
  canApprove,
  canPay,
  canSubmit,
  nextStatusOnApproval,
} from "../../lib/finance/expensePolicy";

const expenseStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("paid"),
);

const expenseKindValidator = v.union(
  v.literal("card_charge"),
  v.literal("reimbursement"),
);

/** Build the display info a submitter/approver needs on an expense card. */
function toUserSummary(user: Doc<"users"> | null) {
  if (!user) return null;
  return {
    id: user._id,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    displayName: getDisplayName(user.firstName, user.lastName),
    profileImage: getMediaUrl(user.profilePhoto),
  };
}

/** Find this user's currently-active (non-revoked) fundRoles row, if any. */
async function getActiveRoleRow(
  ctx: { db: any },
  fundId: Id<"funds">,
  userId: Id<"users">,
): Promise<Doc<"fundRoles"> | null> {
  const rows = await ctx.db
    .query("fundRoles")
    .withIndex("by_user_fund", (q: any) =>
      q.eq("userId", userId).eq("fundId", fundId),
    )
    .collect();
  return rows.find((r: Doc<"fundRoles">) => r.revokedAt === undefined) ?? null;
}

/**
 * Resolve a caller's effective fund role for policy checks: their explicit
 * `fundRoles` grant, or `"finance_admin"` if they're a community admin
 * (the ADR-032 §4 override — admins can do anything on a fund without
 * needing their own grant), or `null` if neither applies.
 */
async function resolveEffectiveRole(
  ctx: { db: any },
  fund: Doc<"funds">,
  userId: Id<"users">,
): Promise<FundRole | null> {
  const roleRow = await getActiveRoleRow(ctx, fund._id, userId);
  if (roleRow) return roleRow.role;
  const isAdmin = await isCommunityAdmin(ctx, fund.communityId, userId);
  return isAdmin ? "finance_admin" : null;
}

// ============================================================================
// submitExpense
// ============================================================================

/**
 * Submit a reimbursement request. Any active member of the fund's group can
 * submit — this is intentionally NOT gated by a fund role (ADR-032 §4: every
 * member can submit an expense/reimbursement).
 *
 * `description` is persisted on the expense document and echoed on the
 * "expense.submitted" audit event.
 */
export const submitExpense = mutation({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    amountCents: v.number(),
    kind: expenseKindValidator,
    description: v.string(),
    receiptKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    // Card-charge expenses are created by the card-transaction webhook
    // (Phase 3), not submitted by members.
    if (args.kind !== "reimbursement") {
      throw new Error(
        "Card-charge expenses are created automatically from card activity — submit a reimbursement instead",
      );
    }

    if (!fund.groupId) {
      throw new Error("Reimbursements are only supported for group funds");
    }

    // A frozen/closed fund (e.g. its group was just archived — see
    // functions/finance/onboarding.ts's freezeFundForArchivedGroup) accepts
    // no new spend activity, only settlement of what's already in flight.
    if (fund.status !== "active") {
      throw new Error(
        "This fund isn't active — new expenses can't be submitted",
      );
    }

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", fund.groupId!).eq("userId", userId),
      )
      .first();
    if (!isActiveMember(membership)) {
      throw new Error(
        "You must be an active member of this fund's group to submit an expense",
      );
    }

    const decision = canSubmit({
      amountCents: args.amountCents,
      kind: args.kind,
      receiptKey: args.receiptKey,
    });
    if (!decision.allowed) {
      throw new Error(decision.reason ?? "This expense cannot be submitted");
    }

    if (!args.receiptKey.startsWith("r2:")) {
      throw new Error("Receipt must be an uploaded file (r2:<key>)");
    }

    const timestamp = now();
    const expenseId = await ctx.db.insert("expenses", {
      fundId: args.fundId,
      submitterId: userId,
      amountCents: args.amountCents,
      kind: "reimbursement",
      description: args.description,
      receiptKey: args.receiptKey,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: "expense.submitted",
      details: {
        expenseId,
        amountCents: args.amountCents,
        kind: args.kind,
        description: args.description,
      },
    });

    return expenseId;
  },
});

// ============================================================================
// approveExpense
// ============================================================================

/**
 * Approve a pending expense. Requires manager+ on the fund. Amounts under
 * `SECOND_APPROVAL_THRESHOLD_CENTS` approve on the first manager sign-off;
 * amounts at/above it need a second, distinct manager+ approval before
 * status flips to "approved" — see lib/finance/expensePolicy.ts.
 */
export const approveExpense = mutation({
  args: { token: v.string(), expenseId: v.id("expenses") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);

    const expense = await ctx.db.get(args.expenseId);
    if (!expense) {
      throw new Error("Expense not found");
    }
    const fund = await ctx.db.get(expense.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    // A fund frozen/closed after submission (e.g. group archived mid-review)
    // must not approve new spend — denyExpense stays available regardless,
    // since a denial is never a new commitment of money.
    if (fund.status !== "active") {
      throw new Error("This fund isn't active — expenses can't be approved");
    }

    await requireFundRole(ctx, fund._id, userId, "manager");

    const approverRole = await resolveEffectiveRole(ctx, fund, userId);
    const decision = canApprove({
      expense,
      approverUserId: userId,
      approverRole,
    });
    if (!decision.allowed) {
      throw new Error(decision.reason ?? "This expense cannot be approved");
    }

    const outcome = nextStatusOnApproval({ expense, approverUserId: userId });
    const firstOrSecond: "first" | "second" =
      outcome.secondApproverId !== undefined ? "second" : "first";

    await ctx.db.patch(args.expenseId, {
      status: outcome.status,
      approverId: outcome.approverId,
      secondApproverId: outcome.secondApproverId,
      updatedAt: now(),
    });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: "expense.approved",
      details: { expenseId: args.expenseId, decision: outcome.status, firstOrSecond },
    });

    if (outcome.status === "approved") {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.finance.expenses.payReimbursement,
        { expenseId: args.expenseId },
      );
    }

    return { status: outcome.status };
  },
});

// ============================================================================
// denyExpense
// ============================================================================

/** Deny a pending expense. Requires manager+ on the fund; never the submitter. */
export const denyExpense = mutation({
  args: { token: v.string(), expenseId: v.id("expenses"), reason: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const expense = await ctx.db.get(args.expenseId);
    if (!expense) {
      throw new Error("Expense not found");
    }
    const fund = await ctx.db.get(expense.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    await requireFundRole(ctx, fund._id, userId, "manager");

    if (expense.submitterId === userId) {
      throw new Error("You cannot deny your own expense");
    }
    if (expense.status !== "pending") {
      throw new Error(`Expense is already ${expense.status}`);
    }

    await ctx.db.patch(args.expenseId, { status: "denied", updatedAt: now() });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: "expense.denied",
      details: { expenseId: args.expenseId, reason: args.reason },
    });
  },
});

// ============================================================================
// Reimbursement payout
// ============================================================================

/**
 * TODO(Phase 2 follow-up — mobile wave stub): there is no member
 * payout-destination table yet (Increase Financial Connections linking, or
 * manual bank-account entry). Until that lands, this always returns `null`,
 * which routes every approved reimbursement to the
 * "expense.pay_blocked_no_destination" audit breadcrumb below instead of an
 * actual ACH transfer — a finance_admin can see why in financeAuditEvents
 * and pay out-of-band, then call `recordReimbursementPaid` once the transfer
 * settles. Replace this stub with a real lookup as soon as the linking flow
 * ships; the rest of `payReimbursement` is already structured to use it.
 */
async function getPayoutDestination(
  _submitterId: Id<"users">,
): Promise<{ routingNumber: string; accountNumber: string; individualName?: string } | null> {
  return null;
}

/** Internal: fetch the expense + its fund for the payout action (actions have no `ctx.db`). */
export const getExpenseForPayout = internalQuery({
  args: { expenseId: v.id("expenses") },
  handler: async (ctx, args) => {
    const expense = await ctx.db.get(args.expenseId);
    if (!expense) return null;
    const fund = await ctx.db.get(expense.fundId);
    if (!fund) return null;
    return { expense, fund };
  },
});

/** Internal: log a payout attempt that didn't result in a transfer. */
export const logReimbursementPayOutcome = internalMutation({
  args: {
    expenseId: v.id("expenses"),
    action: v.union(
      v.literal("expense.pay_skipped"),
      v.literal("expense.pay_blocked_no_destination"),
      v.literal("expense.pay_blocked_fund_inactive"),
    ),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const expense = await ctx.db.get(args.expenseId);
    if (!expense) return;
    const fund = await ctx.db.get(expense.fundId);
    if (!fund) return;

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: args.action,
      details: { expenseId: args.expenseId, ...args.details },
    });
  },
});

/**
 * Internal: post the reimbursement ledger debit and mark the expense paid.
 * Idempotent — `postLedgerEntry`'s `reimb:<expenseId>` key means a repeat
 * call (e.g. a retried scheduler run) posts the debit at most once; the
 * status patch + audit log are separately guarded on `status !== "paid"` so
 * they don't double-fire either.
 */
export const recordReimbursementPaid = internalMutation({
  args: { expenseId: v.id("expenses"), increaseTransferId: v.string() },
  handler: async (ctx, args) => {
    const expense = await ctx.db.get(args.expenseId);
    if (!expense) {
      throw new Error("Expense not found");
    }
    const fund = await ctx.db.get(expense.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    await postLedgerEntry(ctx, {
      fundId: fund._id,
      direction: "debit",
      amountCents: expense.amountCents,
      kind: "reimbursement",
      idempotencyKey: `reimb:${args.expenseId}`,
      increaseObjectId: args.increaseTransferId,
      actorUserId: expense.submitterId,
    });

    if (expense.status !== "paid") {
      await ctx.db.patch(args.expenseId, {
        status: "paid",
        increaseTransferId: args.increaseTransferId,
        updatedAt: now(),
      });

      await logFinanceAudit(ctx, {
        communityId: fund.communityId,
        fundId: fund._id,
        action: "expense.paid",
        details: {
          expenseId: args.expenseId,
          increaseTransferId: args.increaseTransferId,
          amountCents: expense.amountCents,
        },
      });
    }
  },
});

/**
 * Internal action: pay out an approved reimbursement via Increase ACH
 * transfer. Scheduled by `approveExpense` the moment an expense lands in
 * "approved". No-ops (with an audit breadcrumb) if the expense isn't payable
 * or the submitter has no linked payout destination yet.
 *
 * The Increase client is under concurrent development elsewhere in this
 * change — imported lazily so this file's typecheck/tests don't race its
 * landing. It is never reached in tests today because
 * `getPayoutDestination` always returns `null` (see its TODO above).
 */
export const payReimbursement = internalAction({
  args: { expenseId: v.id("expenses") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(
      internal.functions.finance.expenses.getExpenseForPayout,
      { expenseId: args.expenseId },
    );
    if (!loaded) return;
    const { expense, fund } = loaded;

    if (!canPay(expense)) {
      await ctx.runMutation(
        internal.functions.finance.expenses.logReimbursementPayOutcome,
        {
          expenseId: args.expenseId,
          action: "expense.pay_skipped",
          details: {
            status: expense.status,
            kind: expense.kind,
            hasReceipt: !!expense.receiptKey,
          },
        },
      );
      return;
    }

    // HARD GATE, checked BEFORE any call to Increase: a frozen/closed fund
    // must never have money moved out of it via createAchTransfer. This
    // used to be enforced only by postLedgerEntry's frozen-kind check inside
    // recordReimbursementPaid — which runs AFTER the ACH transfer already
    // executed, so a fund frozen between approval and payout (e.g. its
    // group got archived) could still have money leave the bank account
    // even though the ledger write would later fail/skip. Checking here
    // stops the transfer from ever being initiated.
    if (fund.status !== "active") {
      await ctx.runMutation(
        internal.functions.finance.expenses.logReimbursementPayOutcome,
        {
          expenseId: args.expenseId,
          action: "expense.pay_blocked_fund_inactive",
          details: { fundStatus: fund.status },
        },
      );
      return;
    }

    // The fund itself needs a live Increase Account (Phase 2 onboarding) as
    // well as the member's payout destination — either missing piece means
    // there's nowhere to send the transfer yet.
    if (!fund.increaseAccountId) {
      await ctx.runMutation(
        internal.functions.finance.expenses.logReimbursementPayOutcome,
        {
          expenseId: args.expenseId,
          action: "expense.pay_blocked_no_destination",
          details: { reason: "fund_not_provisioned" },
        },
      );
      return;
    }

    const destination = await getPayoutDestination(expense.submitterId);
    if (!destination) {
      await ctx.runMutation(
        internal.functions.finance.expenses.logReimbursementPayOutcome,
        {
          expenseId: args.expenseId,
          action: "expense.pay_blocked_no_destination",
          details: {
            reason: "member_payout_destination_missing",
            submitterId: expense.submitterId,
          },
        },
      );
      return;
    }

    const { createAchTransfer } = await import("../../lib/finance/increase");
    const transfer = await createAchTransfer({
      accountId: fund.increaseAccountId,
      amountCents: expense.amountCents,
      // TODO: source from communityFinance.statementDescriptor once the
      // onboarding flow (functions/finance/onboarding.ts) is in place.
      statementDescriptor: "TOGATHER REIMB",
      routingNumber: destination.routingNumber,
      accountNumber: destination.accountNumber,
      individualName: destination.individualName,
      individualId: expense._id,
      idempotencyKey: `reimb:${args.expenseId}`,
    });

    await ctx.runMutation(
      internal.functions.finance.expenses.recordReimbursementPaid,
      { expenseId: args.expenseId, increaseTransferId: transfer.id },
    );
  },
});

// ============================================================================
// listExpenses / listMyExpenses
// ============================================================================

/**
 * All expenses on a fund (optionally filtered by status), with submitter
 * display info and a resolved receipt URL. Manager+ or an active group
 * leader only — full activity/receipts visibility is a management surface
 * (ADR-032 §4 table), not something every member sees.
 */
export const listExpenses = query({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    status: v.optional(expenseStatusValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireFundRoleOrGroupLeader(ctx, args.fundId, userId, "manager");

    let rows = await ctx.db
      .query("expenses")
      .withIndex("by_fund_status", (q) => q.eq("fundId", args.fundId))
      .collect();
    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);

    const submitters = await Promise.all(rows.map((r) => ctx.db.get(r.submitterId)));

    return rows.map((row, i) => ({
      id: row._id,
      amountCents: row.amountCents,
      kind: row.kind,
      description: row.description,
      status: row.status,
      // getMediaUrl resolves the `r2:<key>` path synchronously; no separate
      // action round-trip is needed to display the receipt.
      receiptUrl: getMediaUrl(row.receiptKey),
      approverId: row.approverId,
      secondApproverId: row.secondApproverId,
      increaseTransferId: row.increaseTransferId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      submitter: toUserSummary(submitters[i]),
    }));
  },
});

/** The viewer's own submitted expenses on a fund, with their status trail. */
export const listMyExpenses = query({
  args: { token: v.string(), fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_submitter", (q) => q.eq("submitterId", userId))
      .filter((q) => q.eq(q.field("fundId"), args.fundId))
      .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);

    return rows.map((row) => ({
      id: row._id,
      amountCents: row.amountCents,
      kind: row.kind,
      description: row.description,
      status: row.status,
      receiptUrl: getMediaUrl(row.receiptKey),
      approverId: row.approverId,
      secondApproverId: row.secondApproverId,
      increaseTransferId: row.increaseTransferId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});
