/**
 * ServiceTimeSelector
 *
 * A pill row for choosing which of a plan's service times the run sheet is
 * anchored to. Only meaningful for multi-service plans, so it renders nothing
 * when there are fewer than two times.
 *
 * Selecting a pill re-bases the run sheet's derived clock times to that service
 * (no writes — see `runSheetTiming.ts`). In serving mode the caller auto-picks
 * the live service and passes `following` + `onResetToLive`, so a manual pick
 * shows a "Live" chip to hand control back to the automatic day-of tracking.
 */
import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { formatClockTime } from "@features/scheduling/utils/runSheetTiming";

export function ServiceTimeSelector({
  times,
  selectedIndex,
  onSelect,
  /** True while the selection is auto-following the live service (serving mode). */
  following,
  /** When provided (serving mode), a "Live" chip appears once the user overrides. */
  onResetToLive,
}: {
  times: Array<{ label: string; startsAt: number }>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  following?: boolean;
  onResetToLive?: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  // A single service has nothing to switch between.
  if (times.length < 2) return null;

  const showLiveChip = onResetToLive != null && following === false;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textTertiary }]}>SERVICE</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {times.map((t, i) => {
          const active = i === selectedIndex;
          // Prefer the stored label ("9:00 AM"); fall back to the formatted start.
          const text = t.label?.trim() || formatClockTime(t.startsAt);
          return (
            <TouchableOpacity
              key={`${t.startsAt}:${i}`}
              onPress={() => onSelect(i)}
              activeOpacity={0.7}
              style={[
                styles.pill,
                {
                  backgroundColor: active
                    ? primaryColor + "1F"
                    : colors.surfaceSecondary,
                  borderColor: active ? primaryColor : colors.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show ${text} service`}
            >
              {active && following ? (
                <View style={[styles.liveDot, { backgroundColor: primaryColor }]} />
              ) : null}
              <Text
                style={[
                  styles.pillText,
                  { color: active ? primaryColor : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {text}
              </Text>
            </TouchableOpacity>
          );
        })}

        {showLiveChip ? (
          <TouchableOpacity
            onPress={onResetToLive}
            activeOpacity={0.7}
            style={[styles.pill, styles.livePill, { borderColor: primaryColor }]}
            accessibilityRole="button"
            accessibilityLabel="Follow the live service"
          >
            <Ionicons name="radio-outline" size={13} color={primaryColor} />
            <Text style={[styles.pillText, { color: primaryColor }]}>Live</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, paddingVertical: 8 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  row: { flexDirection: "row", gap: 8, paddingRight: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  livePill: { gap: 4 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: "600" },
});
