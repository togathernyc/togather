/**
 * RosteringTopTabBar
 *
 * The JS-only top tab switcher for the Rostering hub. Each tab is a real
 * route under `/rostering/[group_id]`; tapping navigates between them with
 * `router.replace` (the hub is a single entry in the parent stack, so tab
 * switches must not build history). An underline marks the active tab.
 *
 * Material top-tabs was rejected — it needs the native `react-native-pager-view`
 * dependency, which conflicts with the OTA / native-dep policy (ADR-013).
 * See ADR-024.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname, useLocalSearchParams } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

type TabKey = "schedule" | "teams" | "cross-team";

/** Tab order, labels, and the path suffix appended to `/rostering/[id]`. */
const TABS: Array<{ key: TabKey; label: string; suffix: string }> = [
  { key: "schedule", label: "Schedule", suffix: "" },
  { key: "teams", label: "Teams", suffix: "/teams" },
  { key: "cross-team", label: "Cross-team", suffix: "/cross-team" },
];

export function RosteringTopTabBar() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();

  // The `(hub)` route group is invisible in the URL, so the active tab is
  // read straight off the pathname suffix.
  const active: TabKey = pathname.endsWith("/teams")
    ? "teams"
    : pathname.endsWith("/cross-team")
      ? "cross-team"
      : "schedule";

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (isActive) return;
              router.replace(`/rostering/${group_id}${tab.suffix}` as never);
            }}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text
              style={[
                styles.tabLabel,
                { color: isActive ? primaryColor : colors.textSecondary },
                isActive && styles.tabLabelActive,
              ]}
            >
              {tab.label}
            </Text>
            <View
              style={[
                styles.indicator,
                { backgroundColor: isActive ? primaryColor : "transparent" },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "500",
    paddingTop: 12,
    paddingBottom: 10,
  },
  tabLabelActive: {
    fontWeight: "700",
  },
  indicator: {
    height: 3,
    width: "55%",
    borderRadius: 2,
  },
});
