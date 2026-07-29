/**
 * ServingTeamScreen
 *
 * Serving-mode "Team" view: a grid of everyone serving alongside the current
 * user. Opened from the pinned "Team" card at the top of the serving inbox.
 *
 * Layout mirrors the ask: one section per plan the user is serving (a volunteer
 * can be on two campuses the same morning), and inside each plan a horizontally
 * scrolling row of TEAM columns. Each column header is the team name; under it a
 * card per confirmed volunteer showing their name + the role they fill. Tapping
 * a card opens an action sheet to message them in Togather (a same-day DM, which
 * the serving inbox surfaces) or text their number.
 *
 * Data comes from `scheduling.serving.getServingTeamRoster`, which already scopes
 * to the user's eligible serving plans and confirmed assignments — so this screen
 * is purely presentational over that shape.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import { Avatar } from "@components/ui/Avatar";
import {
  WaSubScreenHeader,
  WA_CELL_PADDING,
  WA_GROUP_MARGIN,
  WA_GROUP_RADIUS,
  WA_GROUP_SPACING,
  WA_SECTION_HEADER_GAP,
  WA_SECTION_LABEL_SIZE,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SECTION_HEADER,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
} from "@components/wa";
import {
  ActionMenuSheet,
  type MenuAction,
} from "@components/ui/ActionMenuSheet";
import { useStartDirectMessage } from "@features/chat/hooks/useStartDirectMessage";
import { useEventModeStore } from "@/stores/eventModeStore";

/** The person shape returned per team by `getServingTeamRoster`. */
type RosterPerson = {
  userId: string;
  displayName: string;
  firstName: string | null;
  roleName: string;
  roleColor: string | null;
  profilePhoto: string | null;
  phone: string | null;
  isSelf: boolean;
  /**
   * Accept status. Declined people are never returned, so this is always
   * "confirmed" or "unconfirmed" — unconfirmed cards get an "Unconfirmed" pill.
   */
  status: "confirmed" | "unconfirmed";
};

/** Column width for each team — wide enough for a name + role, snug on mobile. */
const TEAM_COL_WIDTH = 168;

/** Format a stored phone (usually E.164) for display; falls back to raw. */
function formatPhoneForDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const usMatch = trimmed.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (usMatch) return `(${usMatch[1]}) ${usMatch[2]}-${usMatch[3]}`;
  return trimmed;
}

function formatPlanDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function ServingTeamScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  // Flag-on restyle only (WHATSAPP-DESIGN-SYSTEM.md §7).
  const wa = useWhatsappShell();
  const isServingMode = useEventModeStore((s) => s.isServingMode);

  const roster = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingTeamRoster,
    isServingMode ? {} : "skip",
  );

  const { messageUser, canMessage } = useStartDirectMessage();

  // The person whose action sheet is open (null = closed).
  const [selected, setSelected] = useState<RosterPerson | null>(null);

  const actions = useMemo<MenuAction[]>(() => {
    if (!selected) return [];
    const list: MenuAction[] = [];
    if (canMessage) {
      list.push({
        label: "Message in Togather",
        onPress: () =>
          messageUser({
            otherUserId: selected.userId as Id<"users">,
            firstName: selected.firstName,
            displayName: selected.displayName,
            profilePhoto: selected.profilePhoto,
          }),
      });
    }
    const pretty = formatPhoneForDisplay(selected.phone);
    if (pretty) {
      list.push({
        label: `Text ${pretty}`,
        onPress: () => {
          // Strip formatting to a dialable string for the sms: scheme.
          const dialable = (selected.phone ?? "").replace(/[^\d+]/g, "");
          Linking.openURL(`sms:${dialable}`).catch(() => {});
        },
      });
    }
    return list;
  }, [selected, canMessage, messageUser]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/chat");
  };

  const plans = roster?.plans ?? [];
  const hasAnyTeams = plans.some((p) => p.teams.length > 0);

  // §4: current WhatsApp iOS has no opaque nav bar — a floating white circle
  // back button and a centered 17pt title sit directly over the content.
  const header = wa ? (
    <WaSubScreenHeader
      title="Team"
      onBack={handleBack}
      accent={primaryColor}
      style={{ paddingTop: insets.top + 8 }}
    />
  ) : (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + 16, borderBottomColor: colors.border },
      ]}
    >
      <TouchableOpacity
        onPress={handleBack}
        style={styles.headerSide}
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Team</Text>
      <View style={styles.headerSide} />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}

      {!isServingMode ? (
        // The query is skipped outside serving mode, so `roster` would stay
        // undefined and spin forever. Show a plain empty state instead.
        <View style={styles.centered}>
          <Ionicons
            name="people-outline"
            size={30}
            color={colors.textTertiary}
          />
          <Text
            style={[styles.emptyText, wa && waStyles.emptyText, { color: colors.textSecondary }]}
          >
            Not currently serving on an event.
          </Text>
        </View>
      ) : roster === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : !hasAnyTeams ? (
        <View style={styles.centered}>
          <Ionicons
            name="people-outline"
            size={30}
            color={colors.textTertiary}
          />
          <Text
            style={[styles.emptyText, wa && waStyles.emptyText, { color: colors.textSecondary }]}
          >
            No one else is on the team yet.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          {plans.map((plan) => (
            <View key={plan.planId} style={[styles.planSection, wa && waStyles.planSection]}>
              <View style={[styles.planHeader, wa && waStyles.planHeader]}>
                <Text
                  style={[styles.planTitle, wa && waStyles.planTitle, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {plan.title}
                </Text>
                <Text
                  style={[
                    styles.planDate,
                    wa && waStyles.planDate,
                    { color: colors.textTertiary },
                  ]}
                >
                  {formatPlanDate(plan.eventDate)}
                </Text>
              </View>

              {plan.teams.length === 0 ? (
                <Text
                  style={[
                    styles.planEmpty,
                    wa && waStyles.planEmpty,
                    { color: colors.textTertiary },
                  ]}
                >
                  No one on this team yet.
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.teamsRow}
                >
                  {plan.teams.map((team) => (
                    <View
                      key={team.teamId}
                      style={[styles.teamColumn, wa && waStyles.teamColumn]}
                    >
                      <Text
                        style={[
                          styles.teamName,
                          wa && waStyles.teamName,
                          { color: colors.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {/* S3.5: the ALL-CAPS letter-spaced label is dead. */}
                        {team.name}
                      </Text>
                      {(() => {
                        const cards = team.people.map((person, i) => {
                          // No actionable card for yourself, or for someone with
                          // neither a DM path (no community context) nor a phone —
                          // opening an empty action sheet would be a dead end.
                          const actionable =
                            !person.isSelf &&
                            (canMessage || !!person.phone);
                          return (
                            <PersonCard
                              key={`${person.userId}:${person.roleName}:${i}`}
                              person={person}
                              colors={colors}
                              primaryColor={primaryColor}
                              wa={wa}
                              first={i === 0}
                              actionable={actionable}
                              onPress={() =>
                                actionable ? setSelected(person) : undefined
                              }
                            />
                          );
                        });
                        // The rounded-card wrapper exists flag-on only —
                        // flag-off keeps origin/main's bare list (byte-
                        // identical tree), spaced by the column's own gap.
                        return wa ? (
                          <View style={waStyles.teamPeople}>{cards}</View>
                        ) : (
                          <>{cards}</>
                        );
                      })()}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <ActionMenuSheet
        visible={selected != null}
        title={
          selected
            ? `${selected.displayName} · ${selected.roleName}`
            : undefined
        }
        actions={actions}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

/** A single volunteer card in a team column: avatar, name, and their role. */
function PersonCard({
  person,
  colors,
  primaryColor,
  wa,
  first,
  actionable,
  onPress,
}: {
  person: RosterPerson;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  wa: boolean;
  /** First row in its team card — suppresses the intra-card hairline. */
  first: boolean;
  /** Whether tapping does anything (has a message/text action available). */
  actionable: boolean;
  onPress: () => void;
}) {
  const roleColor =
    person.roleColor && /^#?[0-9a-fA-F]{6}$/.test(person.roleColor)
      ? person.roleColor.startsWith("#")
        ? person.roleColor
        : `#${person.roleColor}`
      : primaryColor;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={actionable ? 0.7 : 1}
      disabled={!actionable}
      style={[
        styles.personCard,
        wa && waStyles.personCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
        wa &&
          !first && {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
          },
      ]}
      accessibilityRole={actionable ? "button" : "text"}
      accessibilityLabel={
        (person.isSelf
          ? `${person.displayName} (you), ${person.roleName}`
          : actionable
            ? `Message ${person.displayName}, ${person.roleName}`
            : `${person.displayName}, ${person.roleName}`) +
        (person.status === "unconfirmed" ? ", unconfirmed" : "")
      }
    >
      <View style={styles.personTop}>
        <Avatar
          name={person.displayName}
          imageUrl={person.profilePhoto}
          size={28}
        />
        <Text
          style={[styles.personName, wa && waStyles.personName, { color: colors.text }]}
          numberOfLines={1}
        >
          {person.displayName}
          {person.isSelf ? " (you)" : ""}
        </Text>
      </View>
      <View style={styles.roleRow}>
        {/* §7 bans a per-entity color as a taxonomy device — one arbitrary hue
            per role is exactly the banned "pastel category chip" pattern,
            just rendered as a dot. Flag-on the role reads as plain text. */}
        {wa ? null : (
          <View style={[styles.roleDot, { backgroundColor: roleColor }]} />
        )}
        <Text
          style={[styles.roleText, wa && waStyles.roleText, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {/* Flag-on the unconfirmed signal folds into this line rather than
              becoming a `colors.warning`-filled pill (§7: no new semantic
              hue families). Nothing is lost — the a11y label already says it. */}
          {wa && person.status === "unconfirmed"
            ? `${person.roleName} · Unconfirmed`
            : person.roleName}
        </Text>
      </View>
      {!wa && person.status === "unconfirmed" ? (
        <UnconfirmedBadge colors={colors} />
      ) : null}
    </TouchableOpacity>
  );
}

/**
 * A small "Unconfirmed" pill for a teammate who's assigned but hasn't accepted
 * yet. Reuses the leader roster's "awaiting" vocabulary (`colors.warning` + a
 * clock icon) so unconfirmed reads the same everywhere in the app.
 */
function UnconfirmedBadge({
  colors,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={[styles.unconfirmedBadge, { backgroundColor: colors.warning }]}>
      <Ionicons name="time-outline" size={11} color="#fff" />
      <Text style={styles.unconfirmedText}>Unconfirmed</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { width: 40, height: 32, justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  emptyText: { fontSize: 15, textAlign: "center" },
  planSection: { paddingTop: 20 },
  planHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  planTitle: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  planDate: { fontSize: 13, fontWeight: "500" },
  planEmpty: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
  teamsRow: { paddingHorizontal: 16, gap: 12 },
  teamColumn: { width: TEAM_COL_WIDTH, gap: 8 },
  // Holds the column's person rows; flag-on it becomes the inset-grouped card.
  teamName: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingBottom: 2,
  },
  personCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  personTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  personName: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  roleDot: { width: 8, height: 8, borderRadius: 4 },
  roleText: { fontSize: 12, fontWeight: "500", flexShrink: 1 },
  unconfirmedBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  unconfirmedText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },
});

/**
 * `whatsapp-shell` (flag-on) style overrides — applied as
 * `style={[styles.x, wa && waStyles.x]}`, so flag-off renders `styles`
 * byte-for-byte.
 *
 * The team grid keeps its shape (one horizontally-scrolling column per team,
 * a row per volunteer) but stops speaking in mini-cards: per
 * WHATSAPP-DESIGN-SYSTEM.md §7 a column becomes ONE inset-grouped card
 * (24pt radius, no border) whose volunteers are flat rows separated by
 * hairlines — "no custom card component, no shadow, no unique corner
 * radius". The ALL-CAPS letter-spaced column label, the per-role color dot
 * and the `colors.warning` "Unconfirmed" pill are dropped at their call
 * sites (§7 bans colored taxonomy/status chips outright); the unconfirmed
 * signal survives as text on the role line.
 */
const waStyles = StyleSheet.create({
  emptyText: { fontSize: WA_TYPE_SUBTITLE },

  planSection: { paddingTop: WA_GROUP_SPACING },
  planHeader: { paddingHorizontal: WA_GROUP_MARGIN, marginBottom: WA_SECTION_HEADER_GAP },
  // §2 landing section header: ~20pt semibold, sentence case.
  planTitle: { fontSize: WA_TYPE_SECTION_HEADER, fontWeight: WA_WEIGHT_SEMIBOLD },
  planDate: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },
  planEmpty: { fontSize: WA_TYPE_SUBTITLE, paddingHorizontal: WA_GROUP_MARGIN },

  // Type grew (names 14 -> 17pt, roles 12 -> 13pt), so the column widens to
  // keep a two-word name and its role on one line each.
  teamColumn: { width: 200, gap: WA_SECTION_HEADER_GAP },
  // §3.2 section label: sentence-case 15pt gray, no letter-spacing.
  teamName: {
    fontSize: WA_SECTION_LABEL_SIZE,
    fontWeight: WA_WEIGHT_REGULAR,
    letterSpacing: 0,
    textTransform: "none",
    paddingBottom: 0,
  },
  // The column's people become one inset-grouped card.
  teamPeople: { borderRadius: WA_GROUP_RADIUS, overflow: "hidden", gap: 0 },
  // ...so each person is a flat row inside it, not a bordered card.
  personCard: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: WA_CELL_PADDING - 4,
    paddingVertical: 12,
    gap: 6,
  },
  personName: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_REGULAR },
  roleText: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_REGULAR },
});
