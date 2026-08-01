/**
 * DuplicateDateFlag
 *
 * The ⚠ on a roster date column whose date is shared with another plan of the
 * same group. Duplicate plans on one date used to be created silently — a
 * leader authored tasks on one plan while rostered on another, because the two
 * column headers were indistinguishable. Creation is guarded now, but the
 * duplicates already in the data still need to be visible.
 *
 * Deliberately the SAME vocabulary the grid already uses for a person staffed
 * twice in a day: `warning` icon in `colors.destructive`, the word
 * "Double-booked", and the shared legend entry. No new chrome.
 *
 * Rendered by both date-column headers — the mobile tappable one in
 * RosterGridScreen and the desktop inline editor (DateColumnHeaderEditor).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useTheme } from "@hooks/useTheme";

type Colors = ReturnType<typeof useTheme>["colors"];

/** The screen-reader / hover text for a column sharing its date. */
export function duplicateDateLabel(sameDatePlanCount: number): string {
  const others = sameDatePlanCount - 1;
  return `Double-booked date — ${others} other plan${others === 1 ? "" : "s"} on this date. Check you are on the right one.`;
}

/**
 * Web-only `title` tooltip. RN-Web forwards an unknown `title` DOM prop onto
 * the host node; the RN types don't know it, hence the bag + spread (the same
 * idiom as RosterGridScreen's `webTitle`). On native this is `{}` — the
 * `accessibilityLabel` carries the text.
 */
function webTitle(title: string): Record<string, unknown> {
  if (typeof document === "undefined") return {};
  return { title };
}

export function DuplicateDateFlag({
  sameDatePlanCount,
  colors,
  /** Show the "Same date" wording next to the icon (wide desktop columns). */
  withLabel = false,
}: {
  sameDatePlanCount: number;
  colors: Colors;
  withLabel?: boolean;
}) {
  if (sameDatePlanCount <= 1) return null;
  const label = duplicateDateLabel(sameDatePlanCount);
  return (
    <View
      style={styles.wrap}
      accessibilityRole="image"
      accessibilityLabel={label}
      {...webTitle(label)}
    >
      <Ionicons name="warning" size={11} color={colors.destructive} />
      {withLabel && (
        <Text style={[styles.text, { color: colors.destructive }]} numberOfLines={1}>
          Same date
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 2 },
  text: { fontSize: 9, fontWeight: "700" },
});
