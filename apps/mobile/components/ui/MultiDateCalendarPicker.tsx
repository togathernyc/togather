import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  getDay,
  startOfDay,
} from "date-fns";

interface MultiDateCalendarPickerProps {
  selectedDates: Date[];
  onDatesChange: (dates: Date[]) => void;
  minimumDate?: Date;
  disabled?: boolean;
}

export function MultiDateCalendarPicker({
  selectedDates,
  onDatesChange,
  minimumDate = new Date(),
  disabled = false,
}: MultiDateCalendarPickerProps) {
  const { colors, isDark } = useTheme();
  const [currentMonth, setCurrentMonth] = useState(
    selectedDates.length > 0 ? selectedDates[0] : new Date()
  );

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const firstDayOfWeek = getDay(monthStart);

  // Create calendar grid
  const calendarDays: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null);
  }
  daysInMonth.forEach((day) => {
    calendarDays.push(day);
  });

  // Group into weeks
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  const handlePreviousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const isDateDisabled = (date: Date | null) => {
    if (!date || disabled) return true;
    if (minimumDate) {
      const minDate = startOfDay(minimumDate);
      const checkDate = startOfDay(date);
      return checkDate < minDate;
    }
    return false;
  };

  const isDateSelected = (date: Date) => {
    return selectedDates.some((d) => isSameDay(d, date));
  };

  const handleDateToggle = (date: Date) => {
    if (isDateSelected(date)) {
      onDatesChange(selectedDates.filter((d) => !isSameDay(d, date)));
    } else {
      const newDates = [...selectedDates, date].sort(
        (a, b) => a.getTime() - b.getTime()
      );
      onDatesChange(newDates);
    }
  };

  const handleRemoveDate = (date: Date) => {
    onDatesChange(selectedDates.filter((d) => !isSameDay(d, date)));
  };

  const weekDays = ["S", "M", "T", "W", "T", "F", "S"];

  const sortedDates = [...selectedDates].sort(
    (a, b) => a.getTime() - b.getTime()
  );

  return (
    <View style={styles.container}>
      {/* Month Navigation */}
      <View style={styles.monthNavigation}>
        <TouchableOpacity
          style={[
            styles.monthNavButton,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={handlePreviousMonth}
          disabled={disabled}
        >
          <Ionicons
            name="chevron-back"
            size={16}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        <Text style={[styles.monthText, { color: colors.textSecondary }]}>
          {format(currentMonth, "MMM yyyy")}
        </Text>
        <TouchableOpacity
          style={[
            styles.monthNavButton,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={handleNextMonth}
          disabled={disabled}
        >
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Week Day Headers */}
      <View style={styles.weekDayHeaders}>
        {weekDays.map((day, index) => (
          <View key={index} style={styles.weekDayHeader}>
            <Text
              style={[styles.weekDayText, { color: colors.textSecondary }]}
            >
              {day}
            </Text>
          </View>
        ))}
      </View>

      {/* Calendar Grid */}
      <View style={styles.calendarGrid}>
        {weeks.map((week, weekIndex) => (
          <View key={weekIndex} style={styles.weekRow}>
            {week.map((day, dayIndex) => {
              if (!day) {
                return <View key={dayIndex} style={styles.dayCell} />;
              }

              const selected = isDateSelected(day);
              const isDisabled = isDateDisabled(day);
              const isCurrentMonth = isSameMonth(day, currentMonth);

              return (
                <TouchableOpacity
                  key={dayIndex}
                  style={[
                    styles.dayCell,
                    selected && [
                      styles.dayCellSelected,
                      {
                        backgroundColor: isDark
                          ? colors.textInverse
                          : colors.text,
                      },
                    ],
                    !isCurrentMonth && styles.dayCellOtherMonth,
                  ]}
                  onPress={() => !isDisabled && handleDateToggle(day)}
                  disabled={isDisabled}
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: colors.text },
                      selected && {
                        color: isDark ? colors.text : colors.textInverse,
                      },
                      isDisabled && { color: colors.textTertiary },
                      !isCurrentMonth && { color: colors.textTertiary },
                    ]}
                  >
                    {format(day, "d")}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Selected Dates Count */}
      {selectedDates.length > 0 && (
        <Text
          style={[styles.selectedCount, { color: colors.textSecondary }]}
        >
          {selectedDates.length} date{selectedDates.length !== 1 ? "s" : ""}{" "}
          selected
        </Text>
      )}

      {/* Selected Date Chips */}
      {sortedDates.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsContainer}
          contentContainerStyle={styles.chipsContent}
        >
          {sortedDates.map((date) => (
            <View
              key={date.toISOString()}
              style={[
                styles.chip,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.chipText, { color: colors.text }]}>
                {format(date, "EEE, MMM d")}
              </Text>
              {!disabled && (
                <TouchableOpacity
                  onPress={() => handleRemoveDate(date)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="close-circle"
                    size={16}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  monthNavigation: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  monthNavButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  monthText: {
    fontSize: 18,
    fontWeight: "600",
  },
  weekDayHeaders: {
    flexDirection: "row",
    marginBottom: 8,
  },
  weekDayHeader: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
  },
  weekDayText: {
    fontSize: 14,
    fontWeight: "600",
  },
  calendarGrid: {
    marginTop: 8,
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  dayCellSelected: {
    borderRadius: 15,
  },
  dayCellOtherMonth: {
    opacity: 0.3,
  },
  dayText: {
    fontSize: 16,
    fontWeight: "600",
  },
  selectedCount: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  chipsContainer: {
    marginTop: 8,
  },
  chipsContent: {
    paddingHorizontal: 8,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
});
