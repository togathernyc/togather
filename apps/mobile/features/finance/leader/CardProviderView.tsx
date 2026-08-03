/**
 * CardProviderView — presentational "Card provider" community setting
 * (ADR-033 Phase 3, bring-your-own-cards). Plain props only, no Convex — see
 * CardProviderScreen.tsx for the data wrapper.
 *
 * THIS is the one finance surface that NAMES the vendor. Everywhere else
 * (card list, card detail, create-card sheet) is deliberately
 * provider-anonymous — "your community's card provider" — because a fund's
 * members didn't choose the issuer and can't act on its name. Here the
 * community IS choosing, so hiding which vendor they're handing a spending
 * credential to would be the dishonest option.
 *
 * The capability notes on the two picker rows are the same facts the rest of
 * the app renders behaviourally (`capabilities.*`), stated up front: the point
 * of showing them BEFORE the choice is that both of them are irreversible-ish
 * in practice — switching providers later means closing every open card first.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { waAccentPalette } from "@utils/waPalette";
import { Button, ConfirmModal, Input, Skeleton } from "@components/ui";
// See GivingHubView.tsx for why Modal is imported from the concrete file
// rather than the "@components/ui" barrel.
import { CustomModal as Modal } from "@components/ui/Modal";
import { WaCell, WaInsetGroup } from "@components/wa";
import {
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_TYPE_FOOTNOTE,
  WA_WEIGHT_SEMIBOLD,
} from "@components/wa/metrics";
import { CommunityFinanceAccessDenied } from "./CommunityFinanceAccess";
import {
  BYO_PROVIDER_LABELS,
  type ByoCardProvider,
  type CardProviderConnection,
} from "./types";

export type CardProviderState = "loading" | "not-allowed" | "ready";

/** Shared by this screen's own not-allowed state and its access boundary's fallback. */
export const CARD_PROVIDER_DENIED_MESSAGE =
  "Connecting a card provider hands a vendor the ability to spend this community's money, so it's limited to people with financial controls. Ask your community's primary admin.";

/**
 * What each provider actually does to a church's money, in the church's terms.
 *
 * Written from `CLIENT_CAPABILITIES` in
 * `apps/convex/lib/finance/cardProviders/index.ts` — every clause below is a
 * flag on that table, not marketing copy. If a flag changes there, this
 * changes here.
 */
const PROVIDER_NOTES: Record<ByoCardProvider, string> = {
  bill: "Cards are a charge card on your organisation's credit line, so Togather can't show a balance or track repayment. A closed card can be reopened from BILL. Receipts you upload here are sent to BILL too.",
  privacy:
    "No weekly limits, and a closed card can't be reopened. Each fund's card limit follows that fund's balance automatically, and a fund can hold one card at a time.",
};

/**
 * How to get the credential, generically.
 *
 * Deliberately does NOT name menu paths inside either vendor's dashboard: we
 * can't verify them from here, and a confidently wrong path ("Settings →
 * Developers") sends an admin hunting for a screen that may not exist and
 * reads as Togather not knowing the product it's asking them to connect.
 */
const CONNECT_STEPS: Record<ByoCardProvider, string[]> = {
  privacy: [
    "Sign in to Privacy.com as an account owner.",
    "Find the API settings in your account dashboard and create an API key.",
    "Paste it below. Togather checks it against Privacy.com before saving.",
  ],
  bill: [
    "Sign in to BILL Spend & Expense as an admin.",
    "Find the API / integrations settings in your dashboard and create an API token.",
    "Paste it below. Togather checks it against BILL before saving.",
  ],
};

export interface CardProviderViewProps {
  state: CardProviderState;
  /** The community's connection, or null when they've never connected one. */
  connection: CardProviderConnection | null;

  /** Which provider's paste-credential sheet is open, if any. */
  connectingProvider: ByoCardProvider | null;
  onOpenConnectSheet: (provider: ByoCardProvider) => void;
  onCloseConnectSheet: () => void;
  apiKey: string;
  onApiKeyChange: (text: string) => void;
  isConnecting: boolean;
  /**
   * The provider's own refusal, verbatim. Rendered INSIDE the sheet rather
   * than toasted: it names the vendor's reason ("account suspended" vs "wrong
   * key"), and the admin has to be able to read it while the field is still
   * in front of them.
   */
  connectError: string | null;
  onConnect: () => void;

  isConfirmingDisconnect: boolean;
  onRequestDisconnect: () => void;
  onCancelDisconnect: () => void;
  onConfirmDisconnect: () => void;
  isDisconnecting: boolean;
  /** The live-cards guard's message ("3 cards are still open at privacy…"). */
  disconnectError: string | null;
}

export function CardProviderView({
  state,
  connection,
  connectingProvider,
  onOpenConnectSheet,
  onCloseConnectSheet,
  apiKey,
  onApiKeyChange,
  isConnecting,
  connectError,
  onConnect,
  isConfirmingDisconnect,
  onRequestDisconnect,
  onCancelDisconnect,
  onConfirmDisconnect,
  isDisconnecting,
  disconnectError,
}: CardProviderViewProps) {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const accent = useMemo(
    () => waAccentPalette(primaryColor, isDark).accent,
    [primaryColor, isDark],
  );

  if (state === "loading") {
    return (
      <View style={styles.loadingPad}>
        <Skeleton width="100%" height={120} borderRadius={24} />
        <Skeleton
          width="100%"
          height={160}
          borderRadius={24}
          style={{ marginTop: 16 }}
        />
      </View>
    );
  }

  if (state === "not-allowed") {
    return (
      <View style={styles.container} testID="card-provider-not-allowed">
        <CommunityFinanceAccessDenied message={CARD_PROVIDER_DENIED_MESSAGE} />
      </View>
    );
  }

  const isConnected = !!connection && connection.status !== "revoked";
  const label = connection ? BYO_PROVIDER_LABELS[connection.provider] : null;
  // "error" is CONNECTED-BUT-BROKEN, not disconnected: the row still exists,
  // and disconnecting is still refused while cards are open. Without a way back
  // in, an admin whose key was revoked or rotated at the provider could neither
  // reconnect nor close the cards the dead key is blocking. The backend accepts
  // a same-provider reconnect for exactly this.
  const needsReconnect = isConnected && connection?.status === "error";

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isConnected && connection && label ? (
          <>
            <View style={styles.section}>
              <WaInsetGroup
                header="Card provider"
                footer={`Cards for this community's group funds are issued at ${label.name}. Togather stores your ${label.credential} encrypted, uses it only to act on your account there, and never shows it again — not here, not anywhere in the app.`}
              >
                <WaCell
                  icon="card-outline"
                  title={label.name}
                  description={`Connected as ${connection.accountLabel ?? "your account"}`}
                  // None of these rows navigate anywhere, and `WaCell`'s
                  // default trailing block is a chevron — which would promise a
                  // detail screen that doesn't exist. An empty node is the
                  // component's own escape hatch for that.
                  trailingAccessory={<View />}
                  testID="card-provider-connected"
                />
                <ConnectionStatusRow connection={connection} />
                {needsReconnect ? (
                  <WaCell
                    icon="key-outline"
                    title="Enter a new key"
                    description={`Togather's ${label.credential} for ${label.name} stopped working. Paste a fresh one to restore control of this community's cards.`}
                    onPress={() => onOpenConnectSheet(connection.provider)}
                    testID="card-provider-reconnect"
                  />
                ) : null}
                {/* Dates as WA's in-card gray metadata line (WaCell's `footer`
                    variant, S3.6) rather than as two `value` rows: `value` and
                    `trailingAccessory` are mutually exclusive in WaCell, so a
                    value row can't drop its chevron. */}
                <WaCell
                  variant="footer"
                  title={`Connected ${formatShortDate(connection.connectedAt)}. ${
                    connection.lastSyncAt
                      ? `Last synced ${formatShortDate(connection.lastSyncAt)}.`
                      : "No transactions synced yet."
                  }`}
                  testID="card-provider-dates"
                />
              </WaInsetGroup>
            </View>

            <View style={styles.section}>
              <WaInsetGroup footer="Close every open card before disconnecting. A revoked key leaves the cards spending while Togather can no longer pause, close, or record them.">
                <WaCell
                  variant="destructive"
                  title="Disconnect"
                  onPress={onRequestDisconnect}
                  testID="card-provider-disconnect"
                />
              </WaInsetGroup>
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <WaInsetGroup
              header="Card provider"
              footer={
                "Togather issues your group-fund cards at the provider you connect, using your community's own account there.\n\n" +
                "At both providers the cards draw on ONE pooled account rather than a separate account per fund, so that pooled balance is what's at risk if a card is misused. Use an account you keep only for Togather group funds."
              }
            >
              <WaCell
                icon="card-outline"
                title={BYO_PROVIDER_LABELS.bill.name}
                description={PROVIDER_NOTES.bill}
                onPress={() => onOpenConnectSheet("bill")}
                testID="card-provider-option-bill"
              />
              <WaCell
                icon="card-outline"
                title={BYO_PROVIDER_LABELS.privacy.name}
                description={PROVIDER_NOTES.privacy}
                onPress={() => onOpenConnectSheet("privacy")}
                testID="card-provider-option-privacy"
              />
            </WaInsetGroup>
          </View>
        )}

        {/* A revoked connection is shown rather than hidden: an admin who
            disconnected needs to see "disconnected", not an empty state that
            implies they never connected at all. */}
        {connection && connection.status === "revoked" ? (
          <View style={styles.section}>
            <WaInsetGroup header="Previously">
              <WaCell
                variant="footer"
                title={`${BYO_PROVIDER_LABELS[connection.provider].name} was disconnected. No cards can be issued until you connect a provider again.`}
                testID="card-provider-revoked"
              />
            </WaInsetGroup>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={!!connectingProvider}
        onClose={onCloseConnectSheet}
        title={
          connectingProvider
            ? `Connect ${BYO_PROVIDER_LABELS[connectingProvider].name}`
            : "Connect"
        }
      >
        {connectingProvider ? (
          <View>
            {CONNECT_STEPS[connectingProvider].map((step, index) => (
              <View key={step} style={styles.stepRow}>
                <Text style={[styles.stepNumber, { color: accent }]}>
                  {index + 1}
                </Text>
                <Text
                  style={[styles.stepText, { color: colors.textSecondary }]}
                >
                  {step}
                </Text>
              </View>
            ))}

            <View style={styles.field}>
              <Input
                label={`${BYO_PROVIDER_LABELS[connectingProvider].name} ${BYO_PROVIDER_LABELS[connectingProvider].credential}`}
                placeholder={`Paste ${BYO_PROVIDER_LABELS[connectingProvider].credential}`}
                value={apiKey}
                onChangeText={onApiKeyChange}
                secureTextEntry
              />
            </View>

            {connectError ? (
              <Text
                style={[styles.errorText, { color: colors.error }]}
                testID="card-provider-connect-error"
              >
                {connectError}
              </Text>
            ) : null}

            <Button
              variant="primary"
              onPress={onConnect}
              loading={isConnecting}
              disabled={!apiKey.trim() || isConnecting}
              style={styles.connectButton}
            >
              Connect
            </Button>
          </View>
        ) : null}
      </Modal>

      <ConfirmModal
        visible={isConfirmingDisconnect}
        title="Disconnect card provider"
        // The guard's message REPLACES the generic warning once it fires: it
        // carries the card count and the required sequence, which a toast
        // would take off screen before the admin could act on it.
        message={
          disconnectError ??
          `Togather will stop issuing cards for this community and revoke its copy of your ${label?.credential ?? "credential"}. Cards already closed stay closed.`
        }
        confirmText="Disconnect"
        destructive
        isLoading={isDisconnecting}
        onConfirm={onConfirmDisconnect}
        onCancel={onCancelDisconnect}
      />
    </View>
  );
}

/**
 * The connection's health, as its own row.
 *
 * `error` shows the provider's own `lastError` as the sub-line in the
 * destructive color: an admin can't fix "something's wrong", only "the key was
 * revoked at the provider".
 */
function ConnectionStatusRow({
  connection,
}: {
  connection: CardProviderConnection;
}) {
  const { colors } = useTheme();

  if (connection.status === "error") {
    return (
      <WaCell
        icon="alert-circle-outline"
        iconColor={colors.error}
        title="Connection problem"
        description={
          connection.lastError ?? "Togather couldn't reach your card provider."
        }
        descriptionColor={colors.error}
        trailingAccessory={<View />}
        testID="card-provider-status-error"
      />
    );
  }

  return (
    <WaCell
      icon="checkmark-circle-outline"
      iconColor={colors.success}
      title="Active"
      description="Togather can issue, pause, and close cards at this provider."
      trailingAccessory={<View />}
      testID="card-provider-status-active"
    />
  );
}

/** "Jul 27, 2026" — a date, not a relative age: "2 months ago" is the wrong
 * precision for a credential's age when someone is auditing who connected what. */
function formatShortDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingPad: {
    padding: WA_GROUP_MARGIN,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 32,
  },
  section: {
    marginTop: WA_GROUP_SPACING,
  },
  stepRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  stepNumber: {
    fontSize: WA_TYPE_FOOTNOTE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    width: 14,
  },
  stepText: {
    flex: 1,
    fontSize: WA_TYPE_FOOTNOTE,
    lineHeight: 19,
  },
  field: {
    marginTop: 4,
  },
  errorText: {
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  connectButton: {
    marginTop: 12,
  },
});
