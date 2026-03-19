import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format, isSameDay } from "date-fns";
import { useTheme } from "@hooks/useTheme";

interface MeetingSummary {
  id?: number;
  dateOfMeeting: string;
  dinner?: number;
  stats?: {
    id: number;
    totalUserCount: number;
    completionCount: number;
    presentCount?: number;
  };
  logDetails?: Array<{
    id: number;
    updatedBy: {
      first_name: string;
      last_name: string;
    };
    attendance: number;
    createdAt: string;
  }>;
}

interface WeekCalendarProps {
  weekDays: Date[];
  meetingDates: MeetingSummary[];
  onDayPress: (day: Date, hasEvent: boolean) => void;
}

export function WeekCalendar({
  weekDays,
  meetingDates,
  onDayPress,
}: WeekCalendarProps) {
  const { colors } = useTheme();
  const getEventForDate = (date: Date): MeetingSummary | undefined => {
    return meetingDates.find((meeting) => {
      const meetingDate = new Date(meeting.dateOfMeeting);
      return isSameDay(meetingDate, date);
    });
  };

  return (
    <View style={styles.weekContainer}>
      {weekDays.map((day, index) => {
        const event = getEventForDate(day);
        const isToday = isSameDay(day, new Date());
        const hasEvent = !!event;

        return (
          <TouchableOpacity
            key={index}
            testID={`day-card-${index}`}
            style={[
              styles.dayCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
              isToday && { borderColor: colors.text, borderWidth: 2 },
              hasEvent && styles.dayCardWithEvent,
            ]}
            onPress={() => onDayPress(day, hasEvent)}
          >
            <Text style={[styles.dayName, { color: colors.textSecondary }]}>{format(day, "EEE").toUpperCase()}</Text>
            <Text style={[styles.dayNumber, { color: colors.text }]}>
              {format(day, "d")}
            </Text>
            {hasEvent && (
              <View style={styles.eventIndicator}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              </View>
            )}
            {!hasEvent && (
              <TouchableOpacity
                style={[styles.createButton, { backgroundColor: colors.surfaceSecondary }]}
                onPress={() => onDayPress(day, false)}
              >
                <Text style={[styles.createButtonText, { color: colors.textSecondary }]}>+</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  weekContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  dayCard: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 4,
    minHeight: 100,
    justifyContent: "center",
  },
  dayCardWithEvent: {
    borderColor: "#66D440",
    borderWidth: 2,
  },
  dayName: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  dayNumber: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
  },
  eventIndicator: {
    marginTop: 4,
  },
  createButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: "bold",
  },
});

