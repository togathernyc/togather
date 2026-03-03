import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { format, parseISO } from "date-fns";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface GroupData {
  id: number;
  title: string;
  type: number;
  date: string;
  next_meeting_date_created_at?: string;
}

interface GroupMembership {
  id: number;
  group: GroupData;
  rsvpMode: number; // 0: Not Going, 1: Going, 2: Maybe/Not Set
}

interface GroupRsvpSectionProps {
  groups: GroupMembership[];
  onRsvpPress: (group: GroupData) => void;
}

export function GroupRsvpSection({
  groups,
  onRsvpPress,
}: GroupRsvpSectionProps) {
  const [viewAll, setViewAll] = useState(false);
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const formatDate = (dateString: string, createdAt?: string) => {
    try {
      const date = parseISO(dateString);
      return format(date, "EEEE, MMM d 'at' h:mm a");
    } catch {
      return "Date TBD";
    }
  };

  const getRsvpText = (rsvpMode: number) => {
    switch (rsvpMode) {
      case 1:
        return "Going";
      case 0:
        return "Not Going";
      default:
        return "RSVP";
    }
  };

  const getRsvpButtonStyle = (rsvpMode: number) => {
    if (rsvpMode === 1) {
      return [styles.rsvpButton, { borderColor: primaryColor, backgroundColor: primaryColor }];
    } else if (rsvpMode === 0) {
      return [styles.rsvpButton, styles.rsvpButtonNotGoing];
    }
    return [styles.rsvpButton, styles.rsvpButtonDefault];
  };

  const getRsvpTextStyle = (rsvpMode: number) => {
    if (rsvpMode === 1) {
      return [styles.rsvpButtonText, styles.rsvpButtonTextGoing];
    } else if (rsvpMode === 0) {
      return [styles.rsvpButtonText, styles.rsvpButtonTextNotGoing];
    }
    return [styles.rsvpButtonText, styles.rsvpButtonTextDefault];
  };

  const displayGroups = viewAll ? groups : groups.slice(0, 2);

  if (groups.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>GROUP RSVPS</Text>
      <View style={styles.rsvpList}>
        {displayGroups.map((item) => (
          <View key={item.id} style={styles.rsvpItem}>
            <View style={styles.rsvpContent}>
              <Text style={styles.groupName}>{item.group.title}</Text>
              <View style={styles.tagsContainer}>
                {item.group.type === 1 && (
                  <View style={[styles.tag, { backgroundColor: primaryColor }]}>
                    <Text style={styles.tagText}>Dinner</Text>
                  </View>
                )}
                <View style={[styles.tag, { backgroundColor: primaryColor }]}>
                  <Text style={styles.tagText}>Party</Text>
                </View>
              </View>
              <Text style={styles.groupDate}>
                {formatDate(
                  item.group.date,
                  item.group.next_meeting_date_created_at
                )}
              </Text>
            </View>
            <TouchableOpacity
              style={getRsvpButtonStyle(item.rsvpMode)}
              onPress={() => onRsvpPress(item.group)}
            >
              <Text style={getRsvpTextStyle(item.rsvpMode)}>
                {getRsvpText(item.rsvpMode)}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {groups.length > 2 && (
        <TouchableOpacity
          style={styles.viewAllButton}
          onPress={() => setViewAll(!viewAll)}
        >
          <Text style={styles.viewAllText}>
            {viewAll ? "Show Less" : "View All"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#fff",
    marginTop: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rsvpList: {
    gap: 16,
  },
  rsvpItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  rsvpContent: {
    flex: 1,
    marginRight: 16,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  tagsContainer: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "500",
  },
  groupDate: {
    fontSize: 14,
    color: "#666",
  },
  rsvpButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 80,
    alignItems: "center",
  },
  rsvpButtonDefault: {
    borderColor: "#ddd",
    backgroundColor: "#fff",
  },
  rsvpButtonGoing: {
    // Dynamic styles applied inline
  },
  rsvpButtonNotGoing: {
    borderColor: "#999",
    backgroundColor: "#fff",
  },
  rsvpButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  rsvpButtonTextDefault: {
    color: "#333",
  },
  rsvpButtonTextGoing: {
    color: "#fff",
  },
  rsvpButtonTextNotGoing: {
    color: "#666",
  },
  viewAllButton: {
    marginTop: 16,
    paddingVertical: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    alignItems: "center",
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
});
