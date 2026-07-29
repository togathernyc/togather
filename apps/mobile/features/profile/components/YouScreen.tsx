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
 * title, stacked `WaInsetGroup`/`WaCell` cards, plain monochrome icons —
 * never a colored icon-chip background.
 *
 * Every route and permission gate below is copied verbatim from
 * `ProfileMenu.tsx` / `ProfileScreen.tsx` / `(tabs)/_layout.tsx` (Admin tab
 * gate) — no new permission logic is introduced here. See the gate-by-gate
 * mapping in each row's inline comment.
 */
import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Avatar } from "@components/ui";
import { useDevAccess } from "@features/contribute/hooks/useDevAccess";
import {
  WaInsetGroup,
  WaCell,
  WaScreenHeader,
  WA_GROUP_SPACING,
} from "@components/wa";

export function YouScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, community, logout } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

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
    <View style={[styles.container, { backgroundColor: colors.backgroundGrouped }]}>
      <WaScreenHeader
        title="You"
        trailingButtons={[
          {
            icon: "create-outline",
            onPress: () => router.push("/(user)/edit-profile"),
            accessibilityLabel: "Edit profile",
          },
        ]}
        accent={primaryColor}
        style={{ paddingTop: insets.top }}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card — avatar + name + community name, navigates to View Profile
            (ProfileMenu's "View Profile" row / route). Editing is the header's pencil action. */}
        <View style={styles.group}>
          <WaInsetGroup>
            <WaCell
              iconNode={<Avatar name={fullName} imageUrl={user?.profile_photo} size={36} />}
              title={fullName || "Your profile"}
              description={community?.name}
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
});
