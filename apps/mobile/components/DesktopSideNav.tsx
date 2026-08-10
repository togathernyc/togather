import { View, Pressable, StyleSheet } from "react-native";
import { type Href, usePathname, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useEventModeStore } from "@/stores/eventModeStore";
import { useWhatsappShell } from "@hooks/useWhatsappShell";

type NavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconFocused: keyof typeof Ionicons.glyphMap;
  href: Href;
  match: (path: string) => boolean;
  /** Action override (e.g. Exit) — runs instead of navigating to `href`. */
  onPress?: () => void;
};

/**
 * Vertical navigation rail for desktop web.
 * Rendered in both (tabs)/_layout and inbox/_layout so it
 * appears persistent across route groups.
 *
 * In serving/event mode the rail mirrors the mobile serving tab bar
 * (Runsheet · Inbox · Tasks · Exit) instead of the normal nav.
 */
export function DesktopSideNav() {
  const pathname = usePathname();
  const { user, community } = useAuth();
  const { primaryColor, isKnicksMode } = useCommunityTheme();
  const { colors } = useTheme();
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const exitServingMode = useEventModeStore((s) => s.exit);
  const eventTasksEnabled =
    (community?.churchFeatures as { eventTasksEnabled?: boolean } | undefined)
      ?.eventTasksEnabled === true;
  const inServingMode = isServingMode && eventTasksEnabled;

  const isAdmin = user?.is_admin === true;
  const hasCommunity = !!community?.id;
  const prayerEnabled = community?.churchFeatures?.prayerEnabled === true;

  // whatsapp-shell (docs/plans/church-migration-ui-redesign/README.md §5,
  // §9.5): flag off (or still loading) = `normalItems` below, unchanged.
  // Never active during serving mode.
  const whatsappShellFlag = useWhatsappShell();
  const showWhatsappShell = whatsappShellFlag && !inServingMode;

  const inboxIcon = (isKnicksMode
    ? "basketball-outline"
    : "chatbubbles-outline") as keyof typeof Ionicons.glyphMap;
  const inboxIconFocused = (isKnicksMode
    ? "basketball"
    : "chatbubbles") as keyof typeof Ionicons.glyphMap;

  // Serving mode: mirror the mobile order Runsheet · Inbox · Tasks · Exit
  // (no Groups/Events/Admin/Profile). Exit is an action, not a route.
  const servingItems: NavItem[] = [
    {
      key: "serving-runsheet",
      label: "Runsheet",
      icon: "list-outline",
      iconFocused: "list",
      href: "/(tabs)/serving-runsheet",
      match: (p) => p.startsWith("/serving-runsheet"),
    },
    {
      key: "inbox",
      label: "Inbox",
      icon: inboxIcon,
      iconFocused: inboxIconFocused,
      href: "/inbox/",
      match: (p) => p.startsWith("/inbox") || p.startsWith("/chat"),
    },
    {
      key: "serving-tasks",
      label: "Tasks",
      icon: "checkmark-done-outline",
      iconFocused: "checkmark-done",
      href: "/(tabs)/serving-tasks",
      match: (p) => p.startsWith("/serving-tasks"),
    },
    {
      key: "serving-exit",
      label: "Exit",
      icon: "exit-outline",
      iconFocused: "exit",
      href: "/(tabs)/chat",
      match: () => false,
      onPress: () => {
        router.replace("/(tabs)/chat");
        requestAnimationFrame(() => exitServingMode());
      },
    },
  ];

  const normalItems: NavItem[] = [
    {
      key: "groups",
      label: "Groups",
      icon: "map-outline",
      iconFocused: "map",
      href: "/(tabs)/search",
      match: (p) => p === "/" || p.startsWith("/search"),
    },
    {
      key: "events",
      label: "Events",
      icon: "calendar-outline",
      iconFocused: "calendar",
      href: "/(tabs)/events",
      match: (p) => p.startsWith("/events"),
    },
    ...(hasCommunity
      ? [
          {
            key: "inbox",
            label: "Inbox",
            icon: inboxIcon,
            iconFocused: inboxIconFocused,
            href: "/inbox/" as Href,
            match: (p: string) =>
              p.startsWith("/inbox") || p.startsWith("/chat"),
          },
        ]
      : []),
    ...(isAdmin && hasCommunity
      ? [
          {
            key: "admin",
            label: "Admin",
            icon: "shield-checkmark-outline" as keyof typeof Ionicons.glyphMap,
            iconFocused: "shield-checkmark" as keyof typeof Ionicons.glyphMap,
            href: "/(tabs)/admin" as Href,
            match: (p: string) => p.startsWith("/admin"),
          },
        ]
      : []),
    {
      key: "profile",
      label: "Profile",
      icon: "person-outline",
      iconFocused: "person",
      href: "/(tabs)/profile",
      match: (p) => p.startsWith("/profile"),
    },
  ];

  // whatsapp-shell set: Chats, Events, Prayer, admin (unlike mobile, admin
  // stays available on desktop per the redesign), You.
  const whatsappItems: NavItem[] = [
    ...(hasCommunity
      ? [
          {
            key: "inbox",
            label: "Chats",
            icon: inboxIcon,
            iconFocused: inboxIconFocused,
            href: "/inbox/" as Href,
            match: (p: string) =>
              p.startsWith("/inbox") || p.startsWith("/chat"),
          },
        ]
      : []),
    {
      key: "events",
      label: "Events",
      icon: "calendar-outline",
      iconFocused: "calendar",
      href: "/(tabs)/events",
      match: (p) => p.startsWith("/events"),
    },
    ...(hasCommunity && prayerEnabled
      ? [
          {
            key: "prayer",
            label: "Prayer",
            icon: "heart-outline" as keyof typeof Ionicons.glyphMap,
            iconFocused: "heart" as keyof typeof Ionicons.glyphMap,
            href: "/(tabs)/prayer" as Href,
            match: (p: string) => p.startsWith("/prayer"),
          },
        ]
      : []),
    ...(isAdmin && hasCommunity
      ? [
          {
            key: "admin",
            label: "Admin",
            icon: "shield-checkmark-outline" as keyof typeof Ionicons.glyphMap,
            iconFocused: "shield-checkmark" as keyof typeof Ionicons.glyphMap,
            href: "/(tabs)/admin" as Href,
            match: (p: string) => p.startsWith("/admin"),
          },
        ]
      : []),
    {
      key: "profile",
      label: "You",
      icon: "person-outline",
      iconFocused: "person",
      href: "/(tabs)/profile",
      match: (p) => p.startsWith("/profile"),
    },
  ];

  const items = inServingMode
    ? servingItems
    : showWhatsappShell
      ? whatsappItems
      : normalItems;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
      {items.map((item) => {
        const active = item.match(pathname);
        const color = active ? primaryColor : colors.tabBarInactive;
        return (
          <Pressable
            key={item.key}
            onPress={() => (item.onPress ? item.onPress() : router.push(item.href))}
            style={styles.item}
          >
            <View style={styles.itemInner}>
              <Ionicons
                name={active ? item.iconFocused : item.icon}
                size={24}
                color={color}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 64,
    borderRightWidth: 1,
    paddingTop: 16,
    alignItems: "center",
  },
  item: {
    width: 64,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  itemInner: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
});
