/**
 * CommunityFinanceHomeView — presentational Finance home for a community
 * (ADR-032 §2, ADR-033 §5). Plain props only, no Convex — see
 * CommunityFinanceHomeScreen.tsx for the data wrapper.
 *
 * WHY THIS SCREEN EXISTS. Every community-level finance surface used to be a
 * flat quick link in Community settings, and `/finance-setup` was the
 * onboarding checklist and nothing else — so a community whose setup was
 * finished landed on four ticked boxes with no way onward, and there was no
 * screen anywhere that answered "how much money does this community have, and
 * which groups can receive it?". This is that screen, and it is the PARENT of
 * the card-provider and financial-controls ones rather than their sibling.
 *
 * Structure, top to bottom, on the `bg.grouped` canvas the wrapper paints
 * (the GroupInfoScreen/GivingHubView anatomy):
 *   1. Hero `WaInsetGroup` — total balance across every fund, with this
 *      month's given and spent underneath.
 *   2. "Groups & funds" — one cell per fund, then one per group that has no
 *      fund yet, each with an inline "Enable giving" action.
 *   3. "Setup" — card provider (with its status inline), financial controls
 *      (with the holder count inline), and the organization's own details.
 *
 * PROVIDER NAMES ARE ALLOWED HERE, and only here. Group-level card surfaces
 * are provider-ANONYMOUS on purpose (ADR-033 §1: a group didn't choose the
 * issuer, so it gets the behaviour and not the brand). This community DID
 * choose it, and "Card provider ›" with no name is exactly the row an admin
 * has to open to learn anything.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { waAccentPalette } from "@utils/waPalette";
import { Skeleton } from "@components/ui";
import { WaCell, WaInsetGroup } from "@components/wa";
import {
  WA_CELL_PADDING,
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_SUBTITLE,
} from "@components/wa/metrics";
import { formatCents } from "../format";
import { CommunityFinanceAccessDenied } from "./CommunityFinanceAccess";
import {
  CARD_PROVIDER_DISPLAY_NAMES,
  ENABLE_GIVING_LABEL,
  ENABLE_GIVING_PENDING_LABEL,
  enableGivingBlockedReasonFor,
  type CommunityFinanceOverview,
  type CommunityFundRow,
} from "./types";

export type CommunityFinanceHomeState = "loading" | "not-allowed" | "ready";

/** Shared by this screen's own not-allowed state and its access boundary's fallback. */
export const COMMUNITY_FINANCE_HOME_DENIED_MESSAGE =
  "This community's money — its balances, its card provider, and who can spend from it — is only visible to people who hold its financial controls. Ask your community's primary admin.";

/** Hero balance type size — matches the giving hub's, so the two read as one family. */
const HERO_BALANCE_SIZE = 36;
const HERO_LABEL_SIZE = 13.5;

export interface CommunityFinanceHomeViewProps {
  state: CommunityFinanceHomeState;
  /** `undefined` while loading. */
  overview: CommunityFinanceOverview | undefined;
  /** Opens a fund's group Giving hub ("Fund settings"). */
  onOpenFund: (groupId: string) => void;
  /** Turns giving on for a group that has no fund yet. */
  onEnableGiving: (groupId: string) => void;
  /** Group id currently being enabled, for the row-level label swap. */
  enablingGroupId: string | null;
  onOpenCardProvider: () => void;
  onOpenFinancialControls: () => void;
  onOpenOrganizationDetails: () => void;
}

export function CommunityFinanceHomeView({
  state,
  overview,
  onOpenFund,
  onEnableGiving,
  enablingGroupId,
  onOpenCardProvider,
  onOpenFinancialControls,
  onOpenOrganizationDetails,
}: CommunityFinanceHomeViewProps) {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const accent = useMemo(
    () => waAccentPalette(primaryColor, isDark).accent,
    [primaryColor, isDark],
  );

  if (state === "loading" || (state === "ready" && overview === undefined)) {
    return (
      <View style={styles.loadingPad} testID="community-finance-home-loading">
        <Skeleton width="100%" height={120} borderRadius={24} />
        <Skeleton width="100%" height={160} borderRadius={24} style={{ marginTop: 16 }} />
      </View>
    );
  }

  if (state === "not-allowed" || overview === undefined) {
    return (
      <View style={styles.container} testID="community-finance-home-not-allowed">
        <CommunityFinanceAccessDenied message={COMMUNITY_FINANCE_HOME_DENIED_MESSAGE} />
      </View>
    );
  }

  const { totals, funds, groupsWithoutFunds, provider } = overview;
  const blockedReason = enableGivingBlockedReasonFor(overview);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. HERO — what the community holds, and this month's movement. */}
        <WaInsetGroup>
          <View style={styles.hero}>
            <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>
              {totals.fundCount === 1 ? "Across 1 fund" : `Across ${totals.fundCount} funds`}
            </Text>
            <Text
              style={[styles.heroBalance, { color: colors.text }]}
              testID="community-finance-total-balance"
            >
              {formatCents(totals.balanceCents)}
            </Text>
            <Text style={[styles.heroMonth, { color: colors.textSecondary }]}>
              {formatCents(totals.monthDonatedCents)} given ·{" "}
              {formatCents(totals.monthSpentCents)} spent this month
            </Text>
          </View>
        </WaInsetGroup>

        {/* 2. GROUPS & FUNDS */}
        <View style={styles.section}>
          <WaInsetGroup
            header="Groups & funds"
            footer={
              blockedReason ??
              "Each group's fund keeps its own balance. Tap one to manage its cards, roles, and approvals."
            }
          >
            {funds.length === 0 && groupsWithoutFunds.length === 0 ? (
              <View key="funds-empty" style={styles.emptyCell}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  This community has no groups yet.
                </Text>
              </View>
            ) : null}

            {funds.map((fund) => (
              <WaCell
                key={fund.fundId}
                icon={fund.type === "general" ? "business-outline" : "wallet-outline"}
                title={fund.groupName ?? fund.fundName}
                description={fundSubtitle(fund)}
                // The general fund has no group, so there is no "Fund settings"
                // hub to open — it renders as a read-only line rather than a
                // chevron that goes nowhere.
                onPress={fund.groupId ? () => onOpenFund(fund.groupId!) : undefined}
                trailingAccessory={fund.groupId ? undefined : <View />}
                testID={`community-finance-fund-${fund.fundId}`}
              />
            ))}

            {groupsWithoutFunds.map((group) => {
              const isEnabling = enablingGroupId === group.groupId;
              return (
                <WaCell
                  key={group.groupId}
                  icon="add-circle-outline"
                  iconColor={blockedReason ? colors.textTertiary : accent}
                  title={group.groupName}
                  description={
                    isEnabling
                      ? ENABLE_GIVING_PENDING_LABEL
                      : blockedReason
                        ? "Giving unavailable"
                        : ENABLE_GIVING_LABEL
                  }
                  descriptionColor={blockedReason ? undefined : accent}
                  onPress={
                    blockedReason || isEnabling
                      ? undefined
                      : () => onEnableGiving(group.groupId)
                  }
                  disabled={!!blockedReason || isEnabling}
                  trailingAccessory={<View />}
                  testID={`community-finance-enable-${group.groupId}`}
                />
              );
            })}
          </WaInsetGroup>
        </View>

        {/* 3. SETUP */}
        <View style={styles.section}>
          <WaInsetGroup header="Setup">
            <WaCell
              icon="card-outline"
              title="Card provider"
              description={providerSubtitle(provider)}
              onPress={onOpenCardProvider}
              testID="community-finance-card-provider"
            />
            <WaCell
              icon="key-outline"
              title="Financial controls"
              description={financialControlsSubtitle(overview.financeGrantCount)}
              onPress={onOpenFinancialControls}
              testID="community-finance-controls"
            />
            <WaCell
              icon="document-text-outline"
              title="Organization details"
              description="Legal name, EIN, and address"
              onPress={onOpenOrganizationDetails}
              testID="community-finance-organization-details"
            />
          </WaInsetGroup>
        </View>
      </ScrollView>
    </View>
  );
}

/** "$250.00 · $30.00 spent this month · 1 card" — the fund's line, in one read. */
function fundSubtitle(fund: CommunityFundRow): string {
  const parts = [
    formatCents(fund.balanceCents),
    `${formatCents(fund.monthSpentCents)} spent this month`,
  ];
  if (fund.cardCount > 0) {
    parts.push(fund.cardCount === 1 ? "1 card" : `${fund.cardCount} cards`);
  }
  if (fund.status !== "active") {
    parts.push(fund.status === "frozen" ? "Frozen" : "Closed");
  }
  return parts.join(" · ");
}

function providerSubtitle(provider: CommunityFinanceOverview["provider"]): string {
  const name = CARD_PROVIDER_DISPLAY_NAMES[provider.name];
  if (provider.name === "none") return "Not connected";
  if (provider.connected) return `${name} · Connected`;
  if (provider.status === "error") return `${name} · Needs attention`;
  if (provider.status === "revoked") return `${name} · Disconnected`;
  return name;
}

/**
 * The primary admin always holds financial controls and has no grant row, so
 * the count is of everyone it was GIVEN to — the same population the
 * Financial controls screen lists. Saying "1 person" when the answer is
 * "the primary admin, plus one" is the kind of small wrongness that makes an
 * admin distrust the whole screen.
 */
function financialControlsSubtitle(grantCount: number): string {
  if (grantCount === 0) return "Primary admins only";
  return grantCount === 1
    ? "Primary admins, plus 1 other"
    : `Primary admins, plus ${grantCount} others`;
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
  hero: {
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: WA_CELL_PADDING,
    gap: 4,
  },
  heroLabel: {
    fontSize: HERO_LABEL_SIZE,
    fontWeight: "600",
  },
  heroBalance: {
    fontSize: HERO_BALANCE_SIZE,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  heroMonth: {
    fontSize: WA_TYPE_FOOTNOTE,
    textAlign: "center",
  },
  emptyCell: {
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: WA_CELL_PADDING,
  },
  emptyText: {
    fontSize: WA_TYPE_SUBTITLE,
  },
});
