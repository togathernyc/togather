/**
 * GroupDetailsCard
 *
 * Combines the recurring schedule (e.g. "Wednesdays at 7:00pm") and the
 * address into one "DETAILS" card, replacing the giant blue map-icon block
 * from the legacy LOCATION section.
 *
 * Each row is rendered only when its data exists. If neither row has data,
 * the card returns null so we don't leave an empty stub on minimal groups
 * (e.g. online-only groups without an address and without a configured
 * cadence — though most groups do have a cadence).
 *
 * Address row taps open the platform maps app, matching the legacy behavior.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { Group } from "../types";
import { formatCadence } from "../utils";

interface GroupDetailsCardProps {
  group: Group;
}

export function GroupDetailsCard({ group }: GroupDetailsCardProps) {
  const { colors } = useTheme();

  const cadence = formatCadence(group);
  // Mirrors GroupMapSection address resolution.
  const address =
    group.full_address ||
    (group.address_line1 || group.city || group.state || group.zip_code
      ? [
          group.address_line1,
          group.address_line2,
          [group.city, group.state].filter(Boolean).join(", "),
          group.zip_code,
        ]
          .filter(Boolean)
          .join(", ")
      : null) ||
    group.location ||
    null;

  if (!cadence && (!address || address.trim() === "")) {
    return null;
  }

  const handleOpenMaps = async () => {
    if (!address) return;
    const encoded = encodeURIComponent(address);
    const mapsUrl =
      Platform.OS === "ios"
        ? `maps://maps.apple.com/?q=${encoded}`
        : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
    try {
      const canOpen = await Linking.canOpenURL(mapsUrl);
      if (canOpen) {
        await Linking.openURL(mapsUrl);
      } else {
        await Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${encoded}`,
        );
      }
    } catch (err) {
      // Intentional: failure to open maps is benign for the user — the row
      // just stays put. Errors get logged for diagnostics.
      console.error("Error opening maps:", err);
    }
  };

  const rows: { key: string; render: (idx: number) => React.ReactNode }[] = [];

  if (cadence) {
    rows.push({
      key: "schedule",
      render: (idx) => (
        <View
          key="schedule"
          style={[
            styles.row,
            idx > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            },
          ]}
        >
          <Ionicons
            name="calendar-outline"
            size={20}
            color={colors.icon}
          />
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>
              Schedule
            </Text>
            <Text
              style={[styles.rowValue, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {cadence}
            </Text>
          </View>
        </View>
      ),
    });
  }

  if (address && address.trim() !== "") {
    rows.push({
      key: "address",
      render: (idx) => (
        <Pressable
          key="address"
          onPress={handleOpenMaps}
          style={({ pressed }) => [
            styles.row,
            idx > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            },
            pressed && { backgroundColor: colors.selectedBackground },
          ]}
        >
          <Ionicons name="location-outline" size={20} color={colors.icon} />
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>
              Address
            </Text>
            <Text
              style={[styles.rowValue, { color: colors.textSecondary }]}
              numberOfLines={2}
            >
              {address}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textTertiary}
          />
        </Pressable>
      ),
    });
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
        DETAILS
      </Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {rows.map((row, idx) => row.render(idx))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  card: {
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 15,
  },
});
