import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
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
} from "date-fns";

interface CalendarGridProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  minimumDate?: Date;
}

export function CalendarGrid({
  selectedDate,
  onDateSelect,
  minimumDate = new Date(),
}: CalendarGridProps) {
  const { colors, isDark } = useTheme();
  const [currentMonth, setCurrentMonth] = useState(selectedDate);

  useEffect(() => {
    setCurrentMonth(selectedDate);
  }, [selectedDate]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get first day of week (0 = Sunday, 1 = Monday, etc.)
  const firstDayOfWeek = getDay(monthStart);
  
  // Create calendar grid
  const calendarDays: (Date | null)[] = [];
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null);
  }
  
  // Add all days of the month
  daysInMonth.forEach((day) => {
    calendarDays.push(day);
  });

  // Group into weeks (7 days per week)
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
    if (!date) return true;
    if (minimumDate) {
      const minDate = new Date(minimumDate);
      minDate.setHours(0, 0, 0, 0);
      const checkDate = new Date(date);
      checkDate.setHours(0, 0, 0, 0);
      return checkDate < minDate;
    }
    return false;
  };

  const weekDays = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <View style={styles.container}>
      {/* Month Navigation */}
      <View style={styles.monthNavigation}>
        <TouchableOpacity
          style={[styles.monthNavButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={handlePreviousMonth}
        >
          <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={[styles.monthText, { color: colors.textSecondary }]}>
          {format(currentMonth, "MMM yyyy")}
        </Text>
        <TouchableOpacity
          style={[styles.monthNavButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={handleNextMonth}
        >
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Week Day Headers */}
      <View style={styles.weekDayHeaders}>
        {weekDays.map((day, index) => (
          <View key={index} style={styles.weekDayHeader}>
            <Text style={[styles.weekDayText, { color: colors.textSecondary }]}>{day}</Text>
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

              const isSelected = isSameDay(day, selectedDate);
              const isDisabled = isDateDisabled(day);
              const isCurrentMonth = isSameMonth(day, currentMonth);

              return (
                <TouchableOpacity
                  key={dayIndex}
                  style={[
                    styles.dayCell,
                    isSelected && [styles.dayCellSelected, { backgroundColor: isDark ? colors.textInverse : colors.text }],
                    !isCurrentMonth && styles.dayCellOtherMonth,
                  ]}
                  onPress={() => !isDisabled && onDateSelect(day)}
                  disabled={isDisabled}
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: colors.text },
                      isSelected && { color: isDark ? colors.text : colors.textInverse },
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
});

