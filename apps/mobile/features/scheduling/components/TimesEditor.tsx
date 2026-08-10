/**
 * TimesEditor
 *
 * The "When" section of the event-plan editor: the event date plus one or
 * more service times (e.g. a 9 AM and an 11 AM service). Date and times read
 * as a single cohesive grouped card with hairline-separated rows, matching
 * the RolesEditor pattern used elsewhere in scheduling.
 *
 * Each row is a tappable trigger that opens the shared DatePicker. A time row
 * only shows a remove control when there is more than one time — a single
 * time looks intentional, not removable. An "Add time" footer row sits inside
 * the same card so the section reads as one unit.
 *
 * All edits auto-save via the handlers passed in by EventEditorScreen.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DatePicker } from "@components/ui/DatePicker";
import { formatEventDateLong } from "../utils/format";

type EventTime = { label: string; startsAt: number };

interface TimesEditorProps {
  eventDate: number;
  times: EventTime[];
  onChangeDate: (date: Date | null) => void;
  onChangeTimeAt: (index: number, date: Date | null) => void;
  onRemoveTime: (index: number) => void;
  onAddTime: () => void;
}

/**
 * A single row inside the "When" card. The whole row is the tap target — it
 * hosts a hidden DatePicker trigger so tapping anywhere on the row opens the
 * picker. The row keeps a >=44pt height for accessibility.
 */
function WhenRow({
  icon,
  primaryText,
  secondaryText,
  value,
  mode,
  onChange,
  onRemove,
  topBorder,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  primaryText: string;
  secondaryText: string;
  value: Date;
  mode: "date" | "time";
  onChange: (date: Date | null) => void;
  onRemove?: () => void;
  topBorder: boolean;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.row,
        topBorder && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      <View
        style={[styles.iconBadge, { backgroundColor: colors.surface }]}
      >
        <Ionicons name={icon} size={18} color={colors.icon} />
      </View>

      {/* The DatePicker renders its own trigger; we wrap the label area so the
          row's text and the picker line up. The picker's trigger fills the
          remaining width and is the tappable surface. */}
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>
          {secondaryText}
        </Text>
        <DatePicker
          value={value}
          onChange={onChange}
          mode={mode}
          style={styles.pickerReset}
        />
      </View>

      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${primaryText}`}
          style={({ pressed }) => [
            styles.removeBtn,
            pressed && { opacity: 0.5 },
          ]}
        >
          <Ionicons
            name="remove-circle"
            size={22}
            color={colors.textTertiary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export function TimesEditor({
  eventDate,
  times,
  onChangeDate,
  onChangeTimeAt,
  onRemoveTime,
  onAddTime,
}: TimesEditorProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  // A single time shouldn't look removable — only offer remove with 2+.
  const canRemove = times.length > 1;

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
        When
      </Text>

      <View
        style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}
      >
        {/* Date — always the first row of the group. */}
        <WhenRow
          icon="calendar-outline"
          primaryText="date"
          secondaryText={formatEventDateLong(eventDate)}
          value={new Date(eventDate)}
          mode="date"
          onChange={onChangeDate}
          topBorder={false}
        />

        {/* Times — one or more services on that date. */}
        {times.map((t, index) => (
          <WhenRow
            key={`${t.startsAt}-${index}`}
            icon="time-outline"
            primaryText={t.label}
            secondaryText={times.length > 1 ? `Time ${index + 1}` : "Time"}
            value={new Date(t.startsAt)}
            mode="time"
            onChange={(d) => onChangeTimeAt(index, d)}
            onRemove={canRemove ? () => onRemoveTime(index) : undefined}
            topBorder
          />
        ))}

        {/* Add time — a footer row inside the same card. */}
        <Pressable
          onPress={onAddTime}
          accessibilityRole="button"
          accessibilityLabel="Add time"
          style={({ pressed }) => [
            styles.addRow,
            {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            },
            pressed && { opacity: 0.6 },
          ]}
        >
          <View style={[styles.iconBadge, { backgroundColor: colors.surface }]}>
            <Ionicons name="add" size={18} color={primaryColor} />
          </View>
          <Text style={[styles.addLabel, { color: primaryColor }]}>
            Add another time
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
    minHeight: 56,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  // The shared DatePicker ships with a 16pt bottom margin and a bordered box.
  // Inside this grouped card we want the trigger to read as a plain inline
  // value, so we zero the margin; the DatePicker's own box stays as the
  // tappable affordance, consistent with the app's other inputs.
  pickerReset: {
    marginBottom: 0,
  },
  removeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
    minHeight: 48,
  },
  addLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
});
