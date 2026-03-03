import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { format } from "date-fns";

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

interface EventListProps {
  meetingDates: MeetingSummary[];
  onEditEvent: (date: Date) => void;
}

export function EventList({ meetingDates, onEditEvent }: EventListProps) {
  if (meetingDates.length === 0) {
    return null;
  }

  return (
    <View style={styles.eventsList}>
      <Text style={styles.sectionTitle}>SCHEDULED EVENTS</Text>
      {meetingDates.map((meeting) => {
        const meetingDate = new Date(meeting.dateOfMeeting);
        return (
          <View
            key={meeting.id || meeting.dateOfMeeting}
            style={styles.eventItem}
          >
            <View style={styles.eventItemContent}>
              <Text style={styles.eventDate}>
                {format(meetingDate, "MMM dd, yyyy 'at' h:mm a")}
              </Text>
              {meeting.stats && (
                <Text style={styles.eventStats}>
                  {meeting.stats.presentCount || 0} attended
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => onEditEvent(meetingDate)}
            >
              <Text style={styles.editButtonText}>EDIT</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  eventsList: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  eventItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  eventItemContent: {
    flex: 1,
  },
  eventDate: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 4,
  },
  eventStats: {
    fontSize: 14,
    color: "#666",
  },
  editButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 6,
  },
  editButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#333",
  },
});

