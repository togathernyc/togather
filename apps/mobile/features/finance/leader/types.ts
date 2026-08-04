/**
 * Shared types for the leader/community-admin group-giving surfaces
 * (ADR-032 §2 community onboarding, §4 permissions).
 *
 * These mirror the backend shapes in `apps/convex/functions/finance/*`
 * loosely typed (string ids) so the presentational Views stay framework-
 * agnostic — no `Id<"...">` branding here, that conversion happens in the
 * data-wrapper Screens.
 */

/** Fund-scoped permission role, separate from group leader/member roles. */
export type FundRole = "finance_admin" | "manager" | "cardholder";

export interface FinanceUserSummary {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  profileImage?: string | null;
}

export type ExpenseStatus = "pending" | "approved" | "denied" | "paid";
export type ExpenseKind = "card_charge" | "reimbursement";

export interface GivingExpense {
  id: string;
  amountCents: number;
  kind: ExpenseKind;
  description: string;
  status: ExpenseStatus;
  receiptUrl?: string | null;
  approverId?: string | null;
  secondApproverId?: string | null;
  increaseTransferId?: string | null;
  createdAt: number;
  updatedAt: number;
  submitter: FinanceUserSummary;
}

export interface FundRoleRow {
  id: string;
  userId: string;
  role: FundRole;
  grantedBy: string;
  grantedAt: number;
  revokedAt?: number | null;
  isActive: boolean;
  user: FinanceUserSummary;
}

export type OnboardingStatus =
  | "collecting"
  | "verifying"
  | "live"
  | "stripe_blocked"
  | "increase_blocked";

export interface FinanceOnboardingStatus {
  formSubmitted: boolean;
  paymentsVerified: boolean;
  bankAccountsReady: boolean;
  onboardingStatus: OnboardingStatus;
  blockedReason?: string | null;
}

export const FUND_ROLE_LABELS: Record<FundRole, string> = {
  finance_admin: "Finance admin",
  manager: "Manager",
  cardholder: "Cardholder",
};

/** Backend guardrails surfaced verbatim to admins granting/reviewing roles. */
export const GIVING_GUARDRAILS_NOTE =
  "Approvals over $200 need a second approver. You can't approve your own requests.";

/**
 * Group-fund virtual cards (ADR-032 cards phase). Mirrors
 * `apps/convex/functions/finance/cards.ts`'s `listFundCards`/`getCardDetail`
 * return shapes — loosely typed (string ids) per this file's Convex-free
 * contract for presentational Views.
 */
export type CardStatus = "pending" | "active" | "disabled" | "canceled" | "failed";
export type CardLimitPeriod = "week" | "month" | "charge";

export interface FundCard {
  id: string;
  /** Null on a card that failed to issue — never interpolate it unguarded. */
  name: string | null;
  holderUserId: string;
  holderName: string;
  /** Null until the provider issues the card (and forever, if it never does). */
  last4: string | null;
  status: CardStatus;
  spendLimitCents: number | null;
  limitPeriod: CardLimitPeriod | null;
  /**
   * The limit is COMPUTED from the fund's balance rather than typed
   * (ADR-033 Phase 3). A managed card carries `spendLimitCents` with NO
   * `limitPeriod`, which the "amount / period" shape can't express — see
   * `formatCardLimit`, which is why this field has to travel with the card
   * rather than be inferred from a null period.
   */
  managedLimit: boolean;
  /** An admin-pinned ceiling BELOW the fund's balance, or null for "follow the fund". */
  manualCapCents: number | null;
  createdAt: number;
}

/**
 * What the community's card provider can and can't do, PROVIDER-ANONYMOUS
 * (ADR-033 §1). Mirrors `ClientCardCapabilities` in
 * `apps/convex/lib/finance/cardProviders/index.ts`.
 *
 * Group-level surfaces render behaviour, never the vendor's name: the fund's
 * members didn't choose the issuer and have no standing to act on its name.
 * What they do need is whether closing a card is reversible and whether the
 * limit is theirs to type. The community-level card-provider screen is the one
 * place a vendor gets named, because that community chose it.
 */
export interface CardCapabilities {
  /** A closed card can be reopened at the provider. Drives the cancel copy. */
  cardCloseReversible: boolean;
  /** A paused card can be un-paused. */
  cardFreezeReversible: boolean;
  /** A per-week spend limit is expressible. */
  weeklyLimits: boolean;
  /** Every card must carry a spend limit (no hard fund isolation). */
  limitRequired: boolean;
  /** The limit is computed from the fund's ledger, not typed by an admin. */
  managedFundLimit: boolean;
  /** Live cards allowed per fund, or null for no cap. */
  maxCardsPerFund: number | null;
  /** A receipt uploaded here is also sent to the provider. */
  receiptForwarding: boolean;
}

export interface CardActivityEntry {
  id: string;
  amountCents: number;
  description: string;
  status: ExpenseStatus;
  receiptAttached: boolean;
  createdAt: number;
}

export interface CardDetail extends FundCard {
  activity: CardActivityEntry[];
  /** Provider behaviour this screen must tell the truth about. */
  capabilities: CardCapabilities;
  /** Per-action capability flags — mirror the mutations' own gates, so the UI
   * never renders a control whose mutation would reject this viewer. Freeze =
   * finance_admin OR the card's holder; unfreeze/cancel = finance_admin only. */
  viewerCanFreeze: boolean;
  viewerCanUnfreeze: boolean;
  viewerCanCancel: boolean;
  /**
   * Why a `failed` card was never issued, in the PROVIDER's own words — or
   * null, which is what every viewer without the community's financial
   * controls gets. Untrusted vendor text: render it as text, never as markup,
   * and never let it displace the generic line for people who can't act on it.
   */
  failureMessage: string | null;
}

/** The line a viewer sees when there's no stored reason they may read. */
export const CARD_FAILED_GENERIC_MESSAGE =
  "Something went wrong issuing this card. Contact support.";

/**
 * Card statuses that mean the card is dead and doesn't occupy a fund's slot —
 * the client-side mirror of `DEAD_CARD_STATUSES` in
 * `apps/convex/functions/finance/cards.ts`.
 *
 * It must contain everything the server's does. Missing an entry doesn't fail
 * safe: the client would refuse a card the server would happily issue, which
 * is a fund stuck with no way to replace a dead card. `closed`/`CLOSED` are
 * the pre-normalization spellings an older build could have written; `failed`
 * is the one that matters most in practice, because a refused provisioning is
 * exactly the case where the admin needs to try again.
 */
const DEAD_CARD_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "closed",
  "CLOSED",
  "failed",
]);

/** How many of a fund's cards still occupy its slot. `pending` counts — a row
 * waiting on the provider is a card about to exist. */
export function countLiveCards(cards: Array<{ status: string }>): number {
  return cards.filter((card) => !DEAD_CARD_STATUSES.has(card.status)).length;
}

/**
 * Whether the provider's per-fund cap is already used up, so "Create card"
 * would only error. `null` means the provider declares no cap.
 */
export function isCardSlotFull(
  cards: Array<{ status: string }>,
  maxCardsPerFund: number | null,
): boolean {
  if (maxCardsPerFund === null) return false;
  return countLiveCards(cards) >= maxCardsPerFund;
}

/** `listFundCards`' return shape — a fund's card roster plus whether the
 * viewer can issue new cards (finance_admin, incl. the community-admin
 * override — same gate `createFundCard` enforces). */
export interface ListFundCardsResult {
  cards: FundCard[];
  viewerCanManageCards: boolean;
  capabilities: CardCapabilities;
}

/** A fund member eligible to hold a card — cardholder role or higher. */
export interface CardholderCandidate {
  userId: string;
  name: string;
  role: FundRole;
}

export const CARD_LIMIT_PERIOD_LABELS: Record<CardLimitPeriod, string> = {
  week: "week",
  month: "month",
  charge: "charge",
};

/**
 * The card's limit as one line: "$250 / week", "No limit", or — on a provider
 * whose limit Togather manages — "$40.00 left — follows the fund balance".
 *
 * Takes the CARD rather than the two limit fields, which is the whole point of
 * the change: a managed card stores an amount with no period, so the old
 * `(amount, period)` pair rendered "$400 / undefined" for it. Which of the two
 * limit models applies is a property of the card, so the card is what has to be
 * passed for the answer to be right.
 */
export function formatCardLimit(
  card: Pick<
    FundCard,
    "spendLimitCents" | "limitPeriod" | "managedLimit" | "manualCapCents"
  >,
  formatCents: (cents: number) => string,
): string {
  if (card.managedLimit) {
    // The pinned ceiling is what the admin chose and what the card will honour
    // even as the fund grows, so it leads. "Follows the fund balance" still
    // trails it: the cap only ever makes the card TIGHTER than the fund, never
    // looser, and hiding that would imply spare headroom the card doesn't have.
    if (card.manualCapCents != null) {
      return `Capped at ${formatCents(card.manualCapCents)} — follows the fund balance`;
    }
    // What's LEFT, not what the limit "is": on a managed card the number is
    // recomputed from the ledger, so it is a remaining-balance reading and
    // reads as a lie if labelled as a fixed cap.
    if (card.spendLimitCents != null) {
      return `${formatCents(card.spendLimitCents)} left — follows the fund balance`;
    }
    return "Follows the fund balance";
  }
  if (card.spendLimitCents == null || card.limitPeriod == null) return "No limit";
  return `${formatCents(card.spendLimitCents)} / ${CARD_LIMIT_PERIOD_LABELS[card.limitPeriod]}`;
}

/**
 * What actually happens to a card charge, surfaced verbatim on the
 * create-card sheet and card detail.
 *
 * Says only what the product does today. A card swipe settles straight from
 * the fund's bank account: the only things that can stop it are the card's
 * own limit (Increase enforces it) and the account balance. There is no
 * approval step for a `card_charge` expense — nothing surfaces one for
 * sign-off and `canPay` refuses the kind outright — so this copy must claim
 * neither sign-off nor a second approver. See the "What card controls still
 * DON'T do" seam in `apps/convex/functions/finance/ARCHITECTURE.md`: no card
 * surface may advertise a control that isn't on that list.
 */
export const CARD_CHARGE_SETTLEMENT_NOTE =
  "Charges settle straight away — nothing in the app can stop one. Each lands in the fund's activity as soon as the bank confirms it.";

// ============================================================================
// Community-level financial controls (ADR-033 Phase 3)
// ============================================================================

/** The card issuers a community can bring its own account at. */
export type ByoCardProvider = "privacy" | "bill";

/**
 * What to call each provider to a human, and what its credential is called
 * THERE. Mirrors `PROVIDER_LABELS` in
 * `apps/convex/functions/finance/cardProviderConnections.ts` — "paste your
 * Privacy.com API key" shown to someone connecting BILL is the small wrongness
 * that makes a person paste the wrong secret.
 */
export const BYO_PROVIDER_LABELS: Record<
  ByoCardProvider,
  { name: string; credential: string }
> = {
  privacy: { name: "Privacy.com", credential: "API key" },
  bill: { name: "BILL Spend & Expense", credential: "API token" },
};

export type CardProviderConnectionStatus = "active" | "error" | "revoked";

/**
 * The community's card-provider connection, as the settings screen sees it.
 *
 * There is no credential field here and there must never be one: the backend
 * deliberately cannot read the key back, and a masked prefix is still live
 * characters of a spending credential handed to whoever can read a response.
 * `accountLabel` and `lastError` are the PROVIDER's own text — untrusted, and
 * rendered as text only.
 */
export interface CardProviderConnection {
  provider: ByoCardProvider;
  accountLabel: string | null;
  status: CardProviderConnectionStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  connectedAt: number;
}

/** One financial-controls grant on a community. */
export interface CommunityFinanceRoleRow {
  id: string;
  userId: string;
  grantedAt: number;
  revokedAt?: number | null;
  isActive: boolean;
  user: FinanceUserSummary | null;
}

/**
 * The rule the financial-controls screen exists to make legible, in one
 * sentence. Stated on the screen because every question an admin arrives with
 * ("why can't I press this?", "why isn't so-and-so in the list?") is answered
 * by it.
 */
export const FINANCIAL_CONTROLS_NOTE =
  "The community's primary admin always has financial controls and is the only person who can give or take them. Anyone they give them to must already be a community admin.";

// ============================================================================
// Community Finance home (the parent of every surface above)
// ============================================================================

/** Every issuer a community can be on, as an admin should hear it named. */
export const CARD_PROVIDER_DISPLAY_NAMES: Record<
  "increase" | "privacy" | "bill" | "none",
  string
> = {
  increase: "Togather-issued cards",
  privacy: BYO_PROVIDER_LABELS.privacy.name,
  bill: BYO_PROVIDER_LABELS.bill.name,
  none: "Not set up",
};

/** One fund's line on the Finance home. Mirrors `getCommunityFinanceOverview`. */
export interface CommunityFundRow {
  fundId: string;
  /** Null for the community's general fund, which belongs to no group. */
  groupId: string | null;
  groupName: string | null;
  fundName: string;
  type: "group" | "general";
  status: "active" | "frozen" | "closed";
  balanceCents: number;
  monthDonatedCents: number;
  monthSpentCents: number;
  /** LIVE cards only — a canceled or failed one isn't a card the fund has. */
  cardCount: number;
}

/** A group giving could be turned on for. */
export interface CommunityGroupWithoutFund {
  groupId: string;
  groupName: string;
}

export interface CommunityFinanceOverview {
  onboardingStatus: OnboardingStatus | null;
  /** `enableGroupGiving`'s first precondition: the community's giving is live. */
  canEnableGiving: boolean;
  provider: {
    name: "increase" | "privacy" | "bill" | "none";
    connected: boolean;
    /** Provider-supplied text — untrusted, rendered as text only. */
    accountLabel: string | null;
    status: CardProviderConnectionStatus | null;
  };
  totals: {
    balanceCents: number;
    monthDonatedCents: number;
    monthSpentCents: number;
    cardCount: number;
    fundCount: number;
  };
  funds: CommunityFundRow[];
  groupsWithoutFunds: CommunityGroupWithoutFund[];
  /** Active grants. The primary admin holds the controls with no row at all. */
  financeGrantCount: number;
}

/**
 * The label on every "turn giving on for this group" control, wherever it
 * appears — the Finance home's per-group row and the group Giving hub's empty
 * state both call `enableGroupGiving`, so they have to say the same thing.
 */
export const ENABLE_GIVING_LABEL = "Enable giving";
export const ENABLE_GIVING_PENDING_LABEL = "Enabling…";

/**
 * Why "Enable giving" can't be pressed yet, in the admin's words — or `null`
 * when it can.
 *
 * These are `enableGroupGiving`'s OWN preconditions, restated before the tap
 * rather than after it: the mutation's refusals are accurate but they arrive
 * as a toast on a screen that can't act on them, and the fix always lives back
 * on the Finance home.
 *
 * The wording has to be true on BOTH callers — the Finance home's per-group
 * row and the group Giving hub's empty state — so it names the community
 * Finance screen rather than saying "this screen". In practice the hub is the
 * only place a blocked reason is ever SEEN: the home hands the whole screen
 * to the onboarding checklist while the status isn't `"live"`, so "this
 * screen" would have been wrong every time it rendered.
 */
export function enableGivingBlockedReason(
  onboardingStatus: OnboardingStatus | null,
): string | null {
  switch (onboardingStatus) {
    case "live":
      return null;
    case null:
    case undefined:
      return "Set up giving for your community first — that's the Setup section on your community's Finance screen.";
    case "stripe_blocked":
    case "increase_blocked":
      return "Your community's giving setup needs attention before groups can be enabled.";
    default:
      return "Your community's giving setup isn't finished yet — finish verification first, then enable groups.";
  }
}

/** The words for a refusal the onboarding status alone doesn't explain. */
export const ENABLE_GIVING_UNAVAILABLE_REASON =
  "Giving can't be enabled for groups in this community right now.";

/**
 * The one function both surfaces ask. The SERVER decides whether
 * `enableGroupGiving` would accept (`canEnableGiving`, computed next to the
 * mutation's own gate); the status only supplies the words. Deriving the
 * answer from `onboardingStatus` alone would drift the moment the mutation
 * refuses for a reason the status can't see — an archived community being the
 * live example — leaving a button that always errors.
 */
export function enableGivingBlockedReasonFor(access: {
  canEnableGiving: boolean;
  onboardingStatus: OnboardingStatus | null;
}): string | null {
  if (access.canEnableGiving) return null;
  return (
    enableGivingBlockedReason(access.onboardingStatus) ??
    ENABLE_GIVING_UNAVAILABLE_REASON
  );
}

/**
 * Giving hub balance header + month-to-date stat tiles. Mirrors the fields
 * of `getFundOverview`'s return (`fund.name`, `balanceCents`,
 * `monthToDate.*`) the hub actually renders — kept as a narrow local shape
 * rather than importing the member feature's `FundOverview` type, per this
 * file's Convex-free, cross-feature-import-free contract.
 */
export interface GivingHubBalanceSummary {
  fundName: string;
  balanceCents: number;
  monthDonationsCents: number;
  monthDonationCount: number;
  monthSpentCents: number;
  /**
   * Stripe's processing fees this month. Kept OUT of `monthSpentCents` — the
   * group didn't spend them — but shown, because a fee nobody can see is a
   * gap between "given" and "balance" that leaders can't explain.
   */
  monthFeesCents: number;
}

// NOTE: `GivingHubActivityEntry` was dropped with the giving hub's inline
// recent-activity list — the WA "Fund settings" hub links out to the member
// fund screen ("View all transactions") instead of rendering ledger rows, and
// that screen has its own row type. Re-add here only if a leader surface
// renders `getFundOverview().activity` again.
