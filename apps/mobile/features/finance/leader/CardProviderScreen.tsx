/**
 * CardProviderScreen — data wrapper for the community's "Card provider"
 * setting (ADR-033 Phase 3, bring-your-own-cards). Owns the screen chrome
 * (grouped canvas + `WaSubScreenHeader`, the GivingHubScreen pattern) and
 * hands plain props to CardProviderView.
 *
 * THE GATE IS TWO-LAYERED, on purpose:
 *
 *   1. `user?.is_admin` decides whether the query runs at all. A finance grant
 *      only counts while its holder is still a community admin
 *      (`canManageCommunityFinance` re-checks it), so "not a community admin"
 *      is a certain no and can be answered without a round-trip.
 *   2. `CommunityFinanceAccessBoundary` catches the remaining case — a
 *      community admin with no grant, precisely the population ADR-033 §5
 *      created. `getCardProviderStatus` raises a ConvexError for them, which
 *      `useQuery` re-throws during render; see CommunityFinanceAccess.tsx for
 *      why a boundary is the honest way to turn that into a screen state.
 *
 * The connect call is an ACTION (it makes an HTTP call to the provider before
 * anything is stored), so it can take seconds — hence the sheet-local spinner
 * and the inline error rather than a toast.
 */
import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedAction,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { ToastManager } from "@components/ui";
import { WaSubScreenHeader } from "@components/wa";
import { errorMessage, formatError } from "@/utils/error-handling";
import {
  CardProviderView,
  CARD_PROVIDER_DENIED_MESSAGE,
  type CardProviderState,
} from "./CardProviderView";
import {
  CommunityFinanceAccessBoundary,
  CommunityFinanceAccessDenied,
} from "./CommunityFinanceAccess";
import {
  BYO_PROVIDER_LABELS,
  type ByoCardProvider,
  type CardProviderConnection,
} from "./types";

export function CardProviderScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/finance-setup" as any);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
    >
      <WaSubScreenHeader title="Card provider" onBack={handleBack} />
      <CommunityFinanceAccessBoundary
        fallback={
          <CommunityFinanceAccessDenied
            message={CARD_PROVIDER_DENIED_MESSAGE}
          />
        }
      >
        <CardProviderContent />
      </CommunityFinanceAccessBoundary>
    </View>
  );
}

/**
 * Split from the screen so the boundary above can sit BETWEEN the chrome and
 * the query: a refused admin has to keep the header (and the way back), not
 * lose the whole screen.
 */
function CardProviderContent() {
  const { user, community, isLoading: isAuthLoading } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;
  // Layer 1 of the gate — see the file header.
  const isCommunityAdmin = user?.is_admin === true;

  const status = useAuthenticatedQuery(
    api.functions.finance.cardProviderConnections.getCardProviderStatus,
    communityId && isCommunityAdmin ? { communityId } : "skip",
  );

  const connectCardProvider = useAuthenticatedAction(
    api.functions.finance.cardProviderConnections.connectCardProvider,
  );
  const disconnectCardProvider = useAuthenticatedMutation(
    api.functions.finance.cardProviderConnections.disconnectCardProvider,
  );

  const [connectingProvider, setConnectingProvider] =
    useState<ByoCardProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const state: CardProviderState =
    !isAuthLoading && !isCommunityAdmin
      ? "not-allowed"
      : status === undefined
        ? "loading"
        : "ready";

  const connection: CardProviderConnection | null = status?.connection
    ? toCardProviderConnection(status.connection)
    : null;

  const handleOpenConnectSheet = (provider: ByoCardProvider) => {
    setConnectingProvider(provider);
    setApiKey("");
    setConnectError(null);
  };

  const handleCloseConnectSheet = () => {
    setConnectingProvider(null);
    // The key is dropped the moment the sheet closes. It has no reason to
    // outlive the attempt, and a re-opened sheet holding a stale credential is
    // how the wrong one gets submitted.
    setApiKey("");
    setConnectError(null);
  };

  const handleConnect = async () => {
    if (!communityId || !connectingProvider || isConnecting) return;
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    setIsConnecting(true);
    setConnectError(null);
    try {
      const { accountLabel } = await connectCardProvider({
        communityId,
        provider: connectingProvider,
        apiKey: trimmed,
      });
      ToastManager.success(
        `Connected to ${BYO_PROVIDER_LABELS[connectingProvider].name}${
          accountLabel ? ` — ${accountLabel}` : ""
        }`,
      );
      handleCloseConnectSheet();
    } catch (error) {
      // Kept in the sheet, not toasted: the message carries the PROVIDER's own
      // reason for refusing, which is the only thing that tells the admin
      // whether to fix the key or fix their account.
      setConnectError(
        errorMessage(
          error,
          formatError(
            error,
            "Couldn't connect that account. Please try again.",
          ),
        ),
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRequestDisconnect = () => {
    setDisconnectError(null);
    setIsConfirmingDisconnect(true);
  };

  const handleConfirmDisconnect = async () => {
    if (!communityId || isDisconnecting) return;
    setIsDisconnecting(true);
    try {
      await disconnectCardProvider({ communityId });
      ToastManager.success("Card provider disconnected");
      setIsConfirmingDisconnect(false);
      setDisconnectError(null);
    } catch (error) {
      // The live-cards guard is re-rendered INTO the still-open confirm
      // dialog. It says how many cards are open and what to do about them —
      // a toast would take that off screen before the admin could act, and
      // `force` is deliberately not offered here: this screen has no way to
      // establish that the key is compromised, which is the only case that
      // justifies stranding live cards.
      setDisconnectError(
        errorMessage(
          error,
          formatError(
            error,
            "Couldn't disconnect this provider. Please try again.",
          ),
        ),
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <CardProviderView
      state={state}
      connection={connection}
      connectingProvider={connectingProvider}
      onOpenConnectSheet={handleOpenConnectSheet}
      onCloseConnectSheet={handleCloseConnectSheet}
      apiKey={apiKey}
      onApiKeyChange={setApiKey}
      isConnecting={isConnecting}
      connectError={connectError}
      onConnect={handleConnect}
      isConfirmingDisconnect={isConfirmingDisconnect}
      onRequestDisconnect={handleRequestDisconnect}
      onCancelDisconnect={() => {
        setIsConfirmingDisconnect(false);
        setDisconnectError(null);
      }}
      onConfirmDisconnect={handleConfirmDisconnect}
      isDisconnecting={isDisconnecting}
      disconnectError={disconnectError}
    />
  );
}

function toCardProviderConnection(raw: any): CardProviderConnection {
  return {
    provider: raw.provider,
    accountLabel: raw.accountLabel ?? null,
    status: raw.status,
    lastSyncAt: raw.lastSyncAt ?? null,
    lastError: raw.lastError ?? null,
    connectedAt: raw.connectedAt,
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
