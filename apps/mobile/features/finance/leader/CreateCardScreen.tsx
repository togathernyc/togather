/**
 * CreateCardScreen — data wrapper for the "New virtual card" sheet
 * (group-fund cards phase). Resolves the fund, eligible cardholders (fund
 * roles of cardholder or higher), and issues the card via `createFundCard`.
 *
 * ADR-033 Phase 3 moved the issuing gate from "finance_admin on this fund" to
 * COMMUNITY finance access, so this screen now has to answer for someone who
 * arrives without it. `GivingHubScreen` already hides the entry point
 * (`listFundCards.viewerCanManageCards`), but a deep link routes straight here
 * — hence the `not-allowed` state, driven by the same signal the server checks.
 */
import React, { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { ToastManager } from "@components/ui";
import { errorMessage, formatError } from "@/utils/error-handling";
import {
  CreateCardView,
  type CreateCardState,
  type LimitSelection,
} from "./CreateCardView";
import { financeDisplayName } from "./utils";
import type { CardholderCandidate, CardLimitPeriod } from "./types";
import { isCardSlotFull } from "./types";

const CARDHOLDER_ROLES = new Set(["cardholder", "manager", "finance_admin"]);

// The "does this fund have room for another card?" rule lives in types.ts
// (`isCardSlotFull`), so the one client-side copy of the server's dead-status
// denylist is testable on its own and can't drift per screen.

export function CreateCardScreen() {
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id || "";

  const givingContext = useAuthenticatedQuery(
    api.functions.finance.giving.getGivingContext,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );
  const fundId = givingContext?.fundId as Id<"funds"> | undefined;

  const overview = useAuthenticatedQuery(
    api.functions.finance.giving.getFundOverview,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const rolesRaw = useAuthenticatedQuery(
    api.functions.finance.roles.listFundRoles,
    fundId ? { fundId } : "skip",
  );

  const myFundRole = useAuthenticatedQuery(
    api.functions.finance.roles.getMyFundRole,
    fundId ? { fundId } : "skip",
  );

  // The provider's capabilities and the fund's existing cards both come from
  // here, so the sheet's two provider-shaped decisions (managed limit, per-fund
  // card cap) are the server's own answers rather than a client guess.
  const cardsRaw = useAuthenticatedQuery(
    api.functions.finance.cards.listFundCards,
    fundId ? { fundId } : "skip",
  );

  const createFundCard = useAuthenticatedMutation(
    api.functions.finance.cards.createFundCard,
  );

  const [selectedHolderUserId, setSelectedHolderUserId] = useState<
    string | null
  >(null);
  const [name, setName] = useState("");
  const [limitSelection, setLimitSelection] = useState<LimitSelection>("none");
  const [amountText, setAmountText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates: CardholderCandidate[] = useMemo(
    () =>
      (rolesRaw ?? [])
        .filter((r: any) => r.isActive && CARDHOLDER_ROLES.has(r.role))
        .map((r: any) => ({
          userId: String(r.userId),
          name: financeDisplayName({
            id: String(r.user?.id ?? r.userId),
            firstName: r.user?.firstName ?? null,
            lastName: r.user?.lastName ?? null,
            displayName: r.user?.displayName ?? null,
          }),
          role: r.role,
        })),
    [rolesRaw],
  );

  const managedLimit = !!cardsRaw?.capabilities?.managedFundLimit;
  const maxCardsPerFund = cardsRaw?.capabilities?.maxCardsPerFund ?? null;

  // A `failed` card doesn't hold the slot — on a one-card-per-fund provider
  // that is exactly what makes a retry possible after a refused provisioning.
  const cardSlotFull = useMemo(
    () => isCardSlotFull(cardsRaw?.cards ?? [], maxCardsPerFund),
    [cardsRaw, maxCardsPerFund],
  );

  const state: CreateCardState =
    myFundRole === undefined || cardsRaw === undefined
      ? "loading"
      : myFundRole.canManageCommunityFinance
        ? "ready"
        : "not-allowed";

  // On a managed provider the typed amount is an optional CAP, not a limit
  // with a window — so a blank one is valid and `limitSelection` is ignored.
  const amountCents = managedLimit
    ? amountText.trim()
      ? parseDollarsToCents(amountText)
      : null
    : limitSelection === "none"
      ? null
      : parseDollarsToCents(amountText);
  const canSubmit =
    !!selectedHolderUserId &&
    name.trim().length > 0 &&
    !isSubmitting &&
    (managedLimit
      ? !amountText.trim() || amountCents !== null
      : limitSelection === "none" || amountCents !== null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(user)/leader-tools/${groupId}/giving` as any);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !fundId || !selectedHolderUserId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const cardId = await createFundCard({
        fundId,
        holderUserId: selectedHolderUserId as Id<"users">,
        name: name.trim(),
        // A managed provider REFUSES a `limitPeriod` outright (there is no
        // window to honour), so the cap travels alone or not at all.
        ...(managedLimit
          ? amountCents !== null
            ? { spendLimitCents: amountCents }
            : {}
          : limitSelection !== "none"
            ? {
                spendLimitCents: amountCents as number,
                limitPeriod: limitSelection as CardLimitPeriod,
              }
            : {}),
      });
      ToastManager.success("Card created");
      router.replace(
        `/(user)/leader-tools/${groupId}/giving/cards/${cardId}` as any,
      );
    } catch (err) {
      setError(
        errorMessage(
          err,
          formatError(err, "Couldn't create this card. Please try again."),
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CreateCardView
      state={state}
      managedLimit={managedLimit}
      cardSlotFull={cardSlotFull}
      fundName={givingContext?.fundName || "this fund"}
      fundBalanceCents={overview?.balanceCents ?? 0}
      candidates={candidates}
      isLoadingCandidates={fundId != null && rolesRaw === undefined}
      selectedHolderUserId={selectedHolderUserId}
      onSelectHolder={setSelectedHolderUserId}
      onGrantRolePress={() =>
        router.push(`/(user)/leader-tools/${groupId}/giving/roles` as any)
      }
      name={name}
      onNameChange={setName}
      limitSelection={limitSelection}
      onChangeLimitSelection={(selection) => {
        setLimitSelection(selection);
        setAmountText("");
      }}
      amountText={amountText}
      onAmountChange={setAmountText}
      isSubmitting={isSubmitting}
      error={error}
      canSubmit={canSubmit}
      onSubmit={handleSubmit}
      onClose={handleBack}
    />
  );
}

/** Parses a user-typed dollar string into integer cents, or `null` if invalid. */
function parseDollarsToCents(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!trimmed || !/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}
