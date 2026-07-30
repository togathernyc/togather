/**
 * Finance audit trail (ADR-032).
 *
 * Every control-plane finance action — role grants, card issue/freeze/limit
 * changes, expense approvals, onboarding transitions, fund freezes/sweeps —
 * must leave a row in `financeAuditEvents`. Money movement itself is audited
 * by the append-only ledger (lib/finance/ledger.ts); this covers everything
 * that *governs* the money. Rows are append-only: never patch or delete.
 */

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { now } from "../utils";

export interface FinanceAuditArgs {
  communityId: Id<"communities">;
  fundId?: Id<"funds">;
  /** Omit for system actions (webhooks, crons); name the trigger in details. */
  actorUserId?: Id<"users">;
  /** Dot-namespaced, e.g. "role.granted", "card.frozen", "expense.approved". */
  action: string;
  /** Structured context — JSON-encoded before storage. */
  details?: Record<string, unknown>;
}

export async function logFinanceAudit(
  ctx: MutationCtx,
  args: FinanceAuditArgs,
): Promise<Id<"financeAuditEvents">> {
  return await ctx.db.insert("financeAuditEvents", {
    communityId: args.communityId,
    fundId: args.fundId,
    actorUserId: args.actorUserId,
    action: args.action,
    detailsJson:
      args.details === undefined ? undefined : JSON.stringify(args.details),
    createdAt: now(),
  });
}
