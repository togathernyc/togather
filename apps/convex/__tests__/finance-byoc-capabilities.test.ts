/**
 * The capability tables cannot drift (ADR-033 §2, Phase 3).
 *
 * Three name-keyed helpers in lib/finance/cardProviders/index.ts answer
 * questions about a provider WITHOUT building an adapter — `supportsWeeklyLimits`,
 * `requiresSpendLimit`, and the `describeProviderCapabilities` table that Phase 3
 * added for the client. All three exist for the same reason: the callers are
 * mutations and queries with no credential in hand, and "can a closed card be
 * reopened?" must never cost a decrypt of a church's API key.
 *
 * The cost of that is a second copy of the truth. This file is what makes the
 * copy safe: it loads every adapter's OWN `capabilities` and asserts the tables
 * agree, so a fourth provider that forgets to update the table fails here rather
 * than shipping a UI that promises the wrong thing.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-byoc-capabilities.test.ts
 */

import { describe, expect, test } from "vitest";
import {
  describeProviderCapabilities,
  maxCardsPerFund,
  requiresSpendLimit,
  supportsWeeklyLimits,
  usesManagedFundLimit,
  type CardProviderName,
} from "../lib/finance/cardProviders";
import { INCREASE_CAPABILITIES } from "../lib/finance/cardProviders/increase";
import { PRIVACY_CAPABILITIES } from "../lib/finance/cardProviders/privacy";
import { BILL_CAPABILITIES } from "../lib/finance/cardProviders/bill";
import type { ProviderCapabilities } from "../lib/finance/cardProviders/types";

const ADAPTER_CAPABILITIES: Record<
  Exclude<CardProviderName, "none">,
  ProviderCapabilities
> = {
  increase: INCREASE_CAPABILITIES,
  privacy: PRIVACY_CAPABILITIES,
  bill: BILL_CAPABILITIES,
};

describe("the name-keyed capability table matches every adapter", () => {
  for (const [name, capabilities] of Object.entries(ADAPTER_CAPABILITIES) as Array<
    [Exclude<CardProviderName, "none">, ProviderCapabilities]
  >) {
    test(`${name}`, () => {
      const client = describeProviderCapabilities(name);

      expect(client.cardCloseReversible).toBe(capabilities.cardCloseReversible);
      expect(client.cardFreezeReversible).toBe(
        capabilities.cardFreezeReversible,
      );
      expect(client.weeklyLimits).toBe(capabilities.weeklyLimits);
      expect(client.managedFundLimit).toBe(capabilities.managedFundLimit);
      expect(client.maxCardsPerFund).toBe(capabilities.maxCardsPerFund);
      expect(client.receiptForwarding).toBe(capabilities.receiptForwarding);

      // The three helpers must read the SAME table, not a parallel opinion.
      expect(supportsWeeklyLimits(name)).toBe(capabilities.weeklyLimits);
      expect(maxCardsPerFund(name)).toBe(capabilities.maxCardsPerFund);
      expect(usesManagedFundLimit(name)).toBe(capabilities.managedFundLimit);

      // A spend limit is required exactly where the BANK cannot enforce the
      // fund boundary — that equivalence is the reason `requiresSpendLimit`
      // exists at all, so it is asserted rather than restated.
      expect(requiresSpendLimit(name)).toBe(!capabilities.hardFundIsolation);
      expect(client.limitRequired).toBe(!capabilities.hardFundIsolation);
    });
  }
});

describe('"none" promises nothing', () => {
  test("every affordance is off and a limit is still required", () => {
    const none = describeProviderCapabilities("none");
    expect(none.cardCloseReversible).toBe(false);
    expect(none.cardFreezeReversible).toBe(false);
    expect(none.receiptForwarding).toBe(false);
    expect(none.managedFundLimit).toBe(false);
    // A community with no provider cannot issue at all, so nothing here is
    // reachable — but if a UI does render it, it must not offer a control.
    expect(none.limitRequired).toBe(true);
  });
});

describe("the managed-limit precondition holds", () => {
  test("managedFundLimit implies exactly one card per fund", () => {
    for (const name of ["increase", "privacy", "bill", "none"] as const) {
      const capabilities = describeProviderCapabilities(name);
      if (!capabilities.managedFundLimit) continue;
      // The managed cap is a per-CARD lifetime allowance sized to the fund's
      // balance. Two cards would each carry it, and the pair could spend the
      // fund twice — so this is not a style rule, it is what makes the number
      // true. See lib/finance/managedCardLimit.ts.
      expect(capabilities.maxCardsPerFund).toBe(1);
    }
  });
});
