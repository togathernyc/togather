import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format, isSameDay } from "date-fns";

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
              isToday && styles.dayCardToday,
              hasEvent && styles.dayCardWithEvent,
            ]}
            onPress={() => onDayPress(day, hasEvent)}
          >
            <Text style={styles.dayName}>{format(day, "EEE").toUpperCase()}</Text>
            <Text style={[styles.dayNumber, isToday && styles.dayNumberToday]}>
              {format(day, "d")}
            </Text>
            {hasEvent && (
              <View style={styles.eventIndicator}>
                <Ionicons name="checkmark-circle" size={16} color="#66D440" />
              </View>
            )}
            {!hasEvent && (
              <TouchableOpacity
                style={styles.createButton}
                onPress={() => onDayPress(day, false)}
              >
                <Text style={styles.createButtonText}>+</Text>
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
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    marginHorizontal: 4,
    minHeight: 100,
    justifyContent: "center",
  },
  dayCardToday: {
    borderColor: "#333",
    borderWidth: 2,
  },
  dayCardWithEvent: {
    borderColor: "#66D440",
    borderWidth: 2,
  },
  dayName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  dayNumber: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  dayNumberToday: {
    color: "#333",
  },
  eventIndicator: {
    marginTop: 4,
  },
  createButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  createButtonText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "bold",
  },
});

