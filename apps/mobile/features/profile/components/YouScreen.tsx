/**
 * YouScreen — the `whatsapp-shell`-flag-on "You" tab.
 *
 * README.md "W9 — You": WhatsApp "You" hierarchy — profile card → Switch
 * community, Invite your church → My events/My schedule/My prayers/Archived
 * groups → Leader tools (role-gated) → Admin tools (role-gated) →
 * Notifications/Privacy/Help & feedback → Sign out. Absorbs today's
 * `ProfileMenu` catch-all drawer.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.2 (inset-grouped lists) + §4 (nav chrome) +
 * §8 You-tab checklist: `backgroundGrouped` canvas, `WaScreenHeader` large
 * title, a profile-hero tall cell (`YouProfileCell` — ~56pt avatar + name +
 * community subtitle + chevron, matching the reference Settings screenshot's
 * avatar/name/status treatment; a local variant since `WaCell`'s icon column
 * is fixed at 28pt, too narrow for this avatar size), stacked
 * `WaInsetGroup`/`WaCell` cards below it, plain monochrome icons — never a
 * colored icon-chip background.
 *
 * Every route and permission gate below is copied verbatim from
 * `ProfileMenu.tsx` / `ProfileScreen.tsx` / `(tabs)/_layout.tsx` (Admin tab
 * gate) — no new permission logic is introduced here. See the gate-by-gate
 * mapping in each row's inline comment.
 */
import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Avatar } from "@components/ui";
import { useDevAccess } from "@features/contribute/hooks/useDevAccess";
import {
  WaInsetGroup,
  WaCell,
  WaScreenHeader,
  WA_GROUP_SPACING,
  WA_CELL_PADDING,
  WA_ROW_AVATAR_GAP,
  WA_AVATAR_LG,
  WA_CHEVRON_SIZE,
  WA_TAB_CONTENT_CLEARANCE,
  waTabBarStripHeight,
} from "@components/wa";

/**
 * WaCell's icon column is a fixed 28pt (`WA_CELL_ICON_COLUMN`) — too narrow
 * for the ~56–60pt "tall cell" profile avatar the You-tab reference
 * screenshot shows (avatar + name + status), so this is a minimal local row
 * variant rather than a misuse of `WaCell`'s `iconNode` slot. It stays
 * consistent with the kit: `WA_AVATAR_LG` (the same 56pt avatar size §3.1
 * list rows use), `WA_CELL_PADDING`/`WA_ROW_AVATAR_GAP`/`WA_CHEVRON_SIZE`
 * for spacing, and it's meant to sit as the sole child of a `WaInsetGroup`
 * so it still gets the card fill/corner-radius/press-highlight for free.
 */
const YOU_PROFILE_AVATAR_SIZE = WA_AVATAR_LG;
const YOU_PROFILE_CELL_MIN_HEIGHT = 84;

function YouProfileCell({
  name,
  imageUrl,
  subtitle,
  onPress,
  disabled,
}: {
  name: string;
  imageUrl?: string | null;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, isDark } = useTheme();
  const pressHighlight = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [pressed && { backgroundColor: pressHighlight }]}
    >
      <View style={[styles.profileRow, { minHeight: YOU_PROFILE_CELL_MIN_HEIGHT }]}>
        <Avatar name={name} imageUrl={imageUrl} size={YOU_PROFILE_AVATAR_SIZE} />
        <View style={styles.profileTextColumn}>
          <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
            {name || "Your profile"}
          </Text>
          {subtitle ? (
            <Text style={[styles.profileSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={WA_CHEVRON_SIZE} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

export function YouScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, community, logout } = useAuth();
  const { colors } = useTheme();

  const userId = user?.id as Id<"users"> | undefined;
  const communityId = community?.id as Id<"communities"> | undefined;
  const fullName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();

  // --- Switch community — same query + navigation ProfileMenu.handleSwitchCommunity uses. ---
  const communities = useAuthenticatedQuery(
    api.functions.communities.listForUser,
    userId ? {} : "skip"
  );
  const isLoadingCommunities = communities === undefined && !!userId;

  const handleSwitchCommunity = () => {
    if (communities && communities.length > 0) {
      router.push({
        pathname: "/(auth)/select-community",
        params: { communities: JSON.stringify(communities) },
      });
    } else {
      router.push("/(auth)/select-community");
    }
  };

  // --- Leader tools gate — same query ProfileMenu uses for its Leader Tools card. ---
  const hasLeaderAccess = useAuthenticatedQuery(
    api.functions.tasks.index.hasLeaderAccess,
    communityId ? { communityId } : "skip"
  );

  // --- Admin tools gate — identical to the Admin tab's `href` gate in (tabs)/_layout.tsx. ---
  const isAdmin = user?.is_admin === true;
  const isInternalUser = user?.is_staff === true || user?.is_superuser === true;
  const hasCommunity = !!community?.id;
  const showAdminTools = (isAdmin && hasCommunity) || isInternalUser;

  // --- Dev dashboard gate — same hook ProfileMenu uses for its "Dev Dashboard" row. ---
  const { hasAccess: hasDevAccess } = useDevAccess();

  // --- Sign out — the exact handler ProfileScreen.handleLogout runs. ---
  const handleLogout = async () => {
    await logout();
    router.replace("/");
  };

  const otaVersion =
    (Constants.expoConfig?.extra?.otaVersion as string | undefined) ||
    Constants.expoConfig?.version;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundGrouped },
        // Reserve the strip below the floating island on the container that
        // carries the page background, so the home-indicator gap paints page
        // gray rather than showing whatever row scrolls past underneath.
        { paddingBottom: waTabBarStripHeight(insets.bottom) },
      ]}
    >
      {/* No large title here on purpose — WA's You/Settings tab shows floating
          buttons only (WA-VISUAL-DELTAS.md S1.3 / §4.1). */}
      <WaScreenHeader
        trailingButtons={[
          {
            icon: "create-outline",
            onPress: () => router.push("/(user)/edit-profile"),
            accessibilityLabel: "Edit profile",
          },
        ]}
        style={{ paddingTop: insets.top }}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          // The tab bar is a floating island over the content (S2) — pad past
          // it. The safe-area strip below it is reserved by the container.
          { paddingBottom: WA_TAB_CONTENT_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile hero cell — WhatsApp Settings' avatar+name+status tall
            cell (§8 You-tab checklist): ~56pt avatar, name + community
            subtitle, chevron. Navigates to View Profile (ProfileMenu's
            "View Profile" row / route); editing is the header's pencil
            action. */}
        <View style={styles.group}>
          <WaInsetGroup>
            <YouProfileCell
              name={fullName}
              imageUrl={user?.profile_photo}
              subtitle={community?.name}
              onPress={() => {
                if (userId) router.push(`/(user)/profile/${userId}`);
              }}
              disabled={!userId}
            />
          </WaInsetGroup>
        </View>

        {/* Switch community (ProfileMenu.handleSwitchCommunity) · Invite your church
            (ProfileMenu's whatsappShell-gated row — unconditional here since this whole
            screen only renders when the flag is on). "Use Togather on the web" omitted:
            no existing URL/help route to land it on — see report. */}
        <View style={styles.group}>
          <WaInsetGroup>
            <WaCell
              icon="people-outline"
              title={community?.name ? "Switch community" : "Pick a community"}
              description={community?.name}
              onPress={handleSwitchCommunity}
              disabled={isLoadingCommunities}
            />
            <WaCell
              icon="person-add-outline"
              title="Invite your church"
              onPress={() => router.push("/(user)/invite")}
            />
          </WaInsetGroup>
        </View>

        {/* My events / My schedule (ProfileMenu) · My prayers (ProfileMenu's
            community.churchFeatures.prayerEnabled gate) · Archived groups
            (QuickLinksSection's destination — "Starred" has no Togather
            equivalent so only "Archived groups" is rendered, see report). */}
        <View style={styles.group}>
          <WaInsetGroup>
            <WaCell
              icon="calendar-outline"
              title="My events"
              onPress={() => router.push("/(user)/my-events")}
            />
            <WaCell
              icon="people-circle-outline"
              title="My schedule"
              onPress={() => router.push("/(user)/my-schedule")}
            />
            {community?.churchFeatures?.prayerEnabled ? (
              <WaCell
                icon="heart-outline"
                title="My prayers"
                onPress={() => router.push("/(user)/my-prayers")}
              />
            ) : null}
            {/* Gated exactly like its pre-existing entry point
                (QuickLinksSection: user.is_admin) and the destination's own
                access check — internal staff who aren't community admins
                would hit an "Admins only" dead end. */}
            {isAdmin && hasCommunity ? (
              <WaCell
                icon="archive-outline"
                title="Archived groups"
                onPress={() => router.push("/(user)/settings/archived-groups")}
              />
            ) : null}
          </WaInsetGroup>
        </View>

        {/* Leader tools — ProfileMenu's hasLeaderAccess === true gate; same
            Tasks/People routes + returnTo param ProfileMenu uses. */}
        {hasLeaderAccess === true ? (
          <View style={styles.group}>
            <WaInsetGroup header="Leader tools">
              <WaCell
                icon="checkbox-outline"
                title="Tasks"
                onPress={() =>
                  router.push({ pathname: "/tasks", params: { returnTo: "/(tabs)/profile" } })
                }
              />
              <WaCell
                icon="people-outline"
                title="People"
                onPress={() =>
                  router.push({ pathname: "/people", params: { returnTo: "/(tabs)/profile" } })
                }
              />
            </WaInsetGroup>
          </View>
        ) : null}

        {/* Admin tools — identical gate to the Admin tab (isAdmin && hasCommunity) || isInternalUser. */}
        {showAdminTools ? (
          <View style={styles.group}>
            <WaInsetGroup>
              <WaCell
                icon="shield-checkmark-outline"
                title="Admin tools"
                onPress={() => router.push("/(tabs)/admin")}
              />
            </WaInsetGroup>
          </View>
        ) : null}

        {/* Notifications (→ Settings, which hosts NotificationPreferencesSection) ·
            Privacy & blocked (→ settings/blocked-users) · Help & feedback (→ the
            existing /support landing route) · Dev Dashboard (ProfileMenu's
            hasDevAccess gate, kept as its own row per its existing maintainer gate). */}
        <View style={styles.group}>
          <WaInsetGroup>
            <WaCell
              icon="notifications-outline"
              title="Notifications"
              onPress={() => router.push("/(user)/settings")}
            />
            <WaCell
              icon="lock-closed-outline"
              title="Privacy & blocked"
              onPress={() => router.push("/(user)/settings/blocked-users")}
            />
            <WaCell
              icon="help-circle-outline"
              title="Help & feedback"
              onPress={() => router.push("/support")}
            />
            {hasDevAccess ? (
              <WaCell
                icon="construct-outline"
                title="Dev Dashboard"
                description="Help build Togather"
                onPress={() => router.push("/(user)/dev")}
              />
            ) : null}
          </WaInsetGroup>
        </View>

        {/* Sign out — ProfileScreen.handleLogout, verbatim. */}
        <View style={styles.group}>
          <WaInsetGroup footer={otaVersion ? `Togather v${otaVersion}` : undefined}>
            <WaCell title="Log out" variant="destructive" centered onPress={handleLogout} />
          </WaInsetGroup>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: WA_GROUP_SPACING,
  },
  group: {
    marginBottom: WA_GROUP_SPACING,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WA_CELL_PADDING,
  },
  profileTextColumn: {
    flex: 1,
    minWidth: 0,
    marginLeft: WA_ROW_AVATAR_GAP,
    marginRight: 8,
  },
  profileName: {
    fontSize: 17,
    fontWeight: "600",
  },
  profileSubtitle: {
    fontSize: 15,
    marginTop: 2,
  },
});
