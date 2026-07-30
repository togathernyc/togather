/**
 * YouScreen — the `whatsapp-shell`-flag-on "You" tab.
 *
 * README.md "W9 — You": WhatsApp "You" hierarchy — hero → Community (switch ·
 * invite) → Personal (my events/schedule/prayers/archived groups) → Settings
 * (Account · Appearance · Notifications · Privacy & blocked) → Leader tools
 * (role-gated) → Admin (role-gated, one row per surface) → App (App info ·
 * Help & feedback · Dev Dashboard) → Log out. Absorbs today's `ProfileMenu`
 * catch-all drawer.
 *
 * Settings/Admin IA regroup: the two rows that used to be catch-alls are gone.
 * "Notifications" opened the ENTIRE legacy `SettingsScreen` — a flat 10-section
 * scroll mixing profile info, theme, time zone, four cards duplicated from this
 * very screen, app info and account deletion — and "Admin tools" opened the
 * whole segmented `AdminScreen`. Both are now split into one row per
 * destination, pointing at thin flag-on-only `/(user)/you/*` routes that WRAP
 * the same section/content components those screens render (see `YouSubScreen`).
 * The legacy screens and their routes are untouched: flag-off users still reach
 * them through `ProfileMenu`, and `/(tabs)/admin` stays live for deep links.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.2 (inset-grouped lists) + §4 (nav chrome) +
 * §8 You-tab checklist, as recalibrated by WA-VISUAL-DELTAS.md §4: a
 * `backgroundGrouped` canvas, no large title (S1.3 — WA's You tab shows
 * floating buttons only), a CENTERED hero (100pt avatar disc, 28pt bold name,
 * 15pt gray community subtitle) with the first card starting BELOW it, then
 * stacked `WaInsetGroup`/`WaCell` cards with plain monochrome icons — never a
 * colored icon-chip background.
 *
 * §4.2/§4.3 note: the hero used to be an in-card "tall cell" (56pt avatar +
 * name + chevron, styled after the iOS Settings screenshot). The reference
 * You tab has no such row — the avatar and name float centered on the grouped
 * background above the cards — so that layout is gone rather than kept
 * alongside the new one.
 *
 * Every route and permission gate below is copied verbatim from
 * `ProfileMenu.tsx` / `ProfileScreen.tsx` / `(tabs)/_layout.tsx` (Admin tab
 * gate) — no new permission logic is introduced here. See the gate-by-gate
 * mapping in each row's inline comment.
 */
import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Avatar } from "@components/ui";
import { useDevAccess } from "@features/contribute/hooks/useDevAccess";
import { useYouAdminAccess } from "../hooks/useYouAdminAccess";
import {
  WaInsetGroup,
  WaCell,
  WaScreenHeader,
  WA_GROUP_SPACING,
  WA_AVATAR_PROFILE,
  WA_HERO_NAME_GAP,
  WA_HERO_SUBTITLE_GAP,
  WA_TYPE_HERO_NAME,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_BOLD,
  WA_TAB_CONTENT_CLEARANCE,
  waTabBarStripHeight,
} from "@components/wa";

/**
 * WaHero — §4.2's centered You-tab hero: a 100pt avatar disc, the user's name
 * at 28pt bold, and the community name at 15pt gray beneath it, all centered
 * on the grouped-gray canvas with no card behind them. Tapping it opens the
 * user's own profile (the destination the old in-card hero row had); editing
 * stays on the header's pencil button, as before.
 */
function YouHero({
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
  const { colors } = useTheme();
  const displayName = name || "Your profile";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${displayName}, view profile`}
      style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
      testID="you-hero"
    >
      <Avatar name={displayName} imageUrl={imageUrl} size={WA_AVATAR_PROFILE} />
      <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={2}>
        {displayName}
      </Text>
      {subtitle ? (
        <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
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

  // --- Admin gates — see useYouAdminAccess: the same facts AdminScreen uses to
  //     decide which of its segmented tabs to show, one row per tab. Their OR is
  //     the Admin tab's own `href` gate in (tabs)/_layout.tsx. ---
  const { showCommunityAdmin, showStaffDashboard, showAdminGroup } = useYouAdminAccess();
  const isAdmin = user?.is_admin === true;
  const hasCommunity = !!community?.id;

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
        {/* Centered hero (§4.2) — 100pt avatar, 28pt bold name, 15pt gray
            community subtitle, no card. Navigates to View Profile
            (ProfileMenu's "View Profile" row / route); editing is the
            header's pencil action. */}
        <YouHero
          name={fullName}
          imageUrl={user?.profile_photo}
          subtitle={community?.name}
          onPress={() => {
            if (userId) router.push(`/(user)/profile/${userId}`);
          }}
          disabled={!userId}
        />

        {/* Switch community (ProfileMenu.handleSwitchCommunity) · Invite your community
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
              title="Invite your community"
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

        {/* Settings — one row per destination instead of the old single
            "Notifications" row that opened the whole 10-section legacy
            SettingsScreen. Account/Appearance/Notifications are new flag-on-only
            routes wrapping the same section components that screen renders;
            Privacy & blocked keeps its existing standalone route. */}
        <View style={styles.group}>
          <WaInsetGroup header="Settings">
            <WaCell
              icon="person-outline"
              title="Account"
              onPress={() => router.push("/(user)/you/account")}
            />
            <WaCell
              icon="color-palette-outline"
              title="Appearance"
              onPress={() => router.push("/(user)/you/appearance")}
            />
            <WaCell
              icon="notifications-outline"
              title="Notifications"
              onPress={() => router.push("/(user)/you/notifications")}
            />
            <WaCell
              icon="lock-closed-outline"
              title="Privacy & blocked"
              onPress={() => router.push("/(user)/settings/blocked-users")}
            />
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

        {/* Admin — one row per AdminScreen segment instead of the old single
            "Admin tools" row that pushed the whole segmented screen. Row gates
            come from useYouAdminAccess, which derives them from exactly the
            facts AdminScreen's own tab list uses: the four community-admin rows
            need `isAdmin && hasCommunity`, the staff dashboard needs only the
            internal-staff bit (so no-community / non-admin staff still get it,
            just as Dashboard is their only AdminScreen tab). The legacy
            /(tabs)/admin route stays live for deep links and flag-off. */}
        {showAdminGroup ? (
          <View style={styles.group}>
            <WaInsetGroup header="Admin">
              {/* Gated one row at a time rather than as a single fragment:
                  WaInsetGroup counts a Fragment as ONE child, which would drop
                  the hairlines between these rows. */}
              {showCommunityAdmin ? (
                <WaCell
                  icon="enter-outline"
                  title="Join requests"
                  onPress={() => router.push("/(user)/you/admin/requests")}
                />
              ) : null}
              {showCommunityAdmin ? (
                <WaCell
                  icon="people-outline"
                  title="Members"
                  onPress={() => router.push("/(user)/you/admin/members")}
                />
              ) : null}
              {showCommunityAdmin ? (
                <WaCell
                  icon="stats-chart-outline"
                  title="Attendance stats"
                  onPress={() => router.push("/(user)/you/admin/stats")}
                />
              ) : null}
              {showCommunityAdmin ? (
                <WaCell
                  icon="settings-outline"
                  title="Community settings"
                  onPress={() => router.push("/(user)/you/admin/community")}
                />
              ) : null}
              {showStaffDashboard ? (
                <WaCell
                  icon="speedometer-outline"
                  title="Staff dashboard"
                  onPress={() => router.push("/(user)/you/admin/staff")}
                />
              ) : null}
            </WaInsetGroup>
          </View>
        ) : null}

        {/* App — App info (its own route wrapping AppInfoSection, which the
            legacy SettingsScreen buried second-to-last) · Help & feedback (→ the
            existing /support landing route) · Dev Dashboard (ProfileMenu's
            hasDevAccess gate, kept as its own row per its existing maintainer gate). */}
        <View style={styles.group}>
          <WaInsetGroup header="App">
            <WaCell
              icon="information-circle-outline"
              title="App info"
              onPress={() => router.push("/(user)/you/app-info")}
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
  hero: {
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: WA_GROUP_SPACING,
  },
  heroPressed: {
    opacity: 0.7,
  },
  heroName: {
    marginTop: WA_HERO_NAME_GAP,
    fontSize: WA_TYPE_HERO_NAME,
    fontWeight: WA_WEIGHT_BOLD,
    textAlign: "center",
  },
  heroSubtitle: {
    marginTop: WA_HERO_SUBTITLE_GAP,
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: "400",
    textAlign: "center",
  },
});
