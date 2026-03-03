import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { format, parseISO } from "date-fns";
import { formatNextMeeting } from "../utils";
import { Group, RSVPStatus } from "../types";

interface NextEventSectionProps {
  group: Group;
  currentRSVP?: RSVPStatus;
  onRSVPPress?: () => void;
}

export function NextEventSection({
  group,
  currentRSVP,
  onRSVPPress,
}: NextEventSectionProps) {
  // Try multiple sources for the next event date
  const nextEventDate =
    group.date ||
    group.next_meeting_date ||
    group.next_meeting_date_created_at ||
    group.group_schedule_details?.first_meeting_date ||
    group.group_schedule?.first_meeting_date;

  if (!nextEventDate) {
    return null;
  }

  // Format the date
  let formattedDate: string;
  try {
    const date = parseISO(nextEventDate);
    formattedDate = format(date, "EEE, MMM dd 'at' h:mm a");
  } catch {
    // Fallback to formatNextMeeting utility
    const formatted = formatNextMeeting(nextEventDate);
    formattedDate = formatted || nextEventDate;
  }

  const getRSVPButtonText = () => {
    if (currentRSVP === null || currentRSVP === undefined) {
      return "RSVP";
    }
    if (currentRSVP === 0) {
      return "Going";
    }
    if (currentRSVP === 1) {
      return "Maybe";
    }
    if (currentRSVP === 2) {
      return "Not Going";
    }
    return "RSVP";
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Next Event</Text>
      <View style={styles.contentRow}>
        <Text style={styles.dateText}>{formattedDate}</Text>
        {onRSVPPress && (
          <TouchableOpacity
            style={[
              styles.rsvpButton,
              currentRSVP === 2 && styles.rsvpButtonNotGoing,
            ]}
            onPress={onRSVPPress}
          >
            <Text
              style={[
                styles.rsvpButtonText,
                currentRSVP === 2 && styles.rsvpButtonTextNotGoing,
              ]}
            >
              {getRSVPButtonText()}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 0,
  },
  header: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "500",
    flex: 1,
  },
  rsvpButton: {
    backgroundColor: "#E0E0E0",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 100,
    alignItems: "center",
  },
  rsvpButtonNotGoing: {
    backgroundColor: "#FFE5E5",
  },
  rsvpButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  rsvpButtonTextNotGoing: {
    color: "#FF3B30",
  },
});

