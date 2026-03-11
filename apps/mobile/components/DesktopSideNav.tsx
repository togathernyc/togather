import { View, Pressable, StyleSheet } from "react-native";
import { type Href, usePathname, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

type NavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconFocused: keyof typeof Ionicons.glyphMap;
  href: Href;
  match: (path: string) => boolean;
};

/**
 * Vertical navigation rail for desktop web.
 * Rendered in both (tabs)/_layout and inbox/_layout so it
 * appears persistent across route groups.
 */
export function DesktopSideNav() {
  const pathname = usePathname();
  const { user, community } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const isAdmin = user?.is_admin === true;
  const hasCommunity = !!community?.id;

  const items: NavItem[] = [
    {
      key: "explore",
      label: "Explore",
      icon: "globe-outline",
      iconFocused: "globe",
      href: "/(tabs)/search",
      match: (p) => p === "/" || p.startsWith("/search"),
    },
    ...(hasCommunity
      ? [
          {
            key: "inbox",
            label: "Inbox",
            icon: "chatbubbles-outline" as keyof typeof Ionicons.glyphMap,
            iconFocused: "chatbubbles" as keyof typeof Ionicons.glyphMap,
            href: "/inbox/",
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
            href: "/(tabs)/admin",
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

  return (
    <View style={styles.container}>
      {items.map((item) => {
        const active = item.match(pathname);
        const color = active ? primaryColor : "#999";
        return (
          <Pressable
            key={item.key}
            onPress={() => router.push(item.href)}
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
    backgroundColor: "#fff",
    borderRightWidth: 1,
    borderRightColor: "#E5E5E5",
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
