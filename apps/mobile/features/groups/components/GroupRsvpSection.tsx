import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { format, parseISO } from "date-fns";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

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
  const { colors } = useTheme();

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
      return [styles.rsvpButton, { borderColor: colors.textTertiary, backgroundColor: colors.surface }];
    }
    return [styles.rsvpButton, { borderColor: colors.border, backgroundColor: colors.surface }];
  };

  const getRsvpTextStyle = (rsvpMode: number) => {
    if (rsvpMode === 1) {
      return [styles.rsvpButtonText, { color: colors.textInverse }];
    } else if (rsvpMode === 0) {
      return [styles.rsvpButtonText, { color: colors.textSecondary }];
    }
    return [styles.rsvpButtonText, { color: colors.text }];
  };

  const displayGroups = viewAll ? groups : groups.slice(0, 2);

  if (groups.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.text }]}>GROUP RSVPS</Text>
      <View style={styles.rsvpList}>
        {displayGroups.map((item) => (
          <View key={item.id} style={[styles.rsvpItem, { borderBottomColor: colors.borderLight }]}>
            <View style={styles.rsvpContent}>
              <Text style={[styles.groupName, { color: colors.text }]}>{item.group.title}</Text>
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
              <Text style={[styles.groupDate, { color: colors.textSecondary }]}>
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
          style={[styles.viewAllButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={() => setViewAll(!viewAll)}
        >
          <Text style={[styles.viewAllText, { color: colors.text }]}>
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
    marginTop: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
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
  },
  rsvpContent: {
    flex: 1,
    marginRight: 16,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
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
    // borderColor/backgroundColor set dynamically
  },
  rsvpButtonGoing: {
    // Dynamic styles applied inline
  },
  rsvpButtonNotGoing: {
    // borderColor/backgroundColor set dynamically
  },
  rsvpButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  rsvpButtonTextDefault: {
    // color set dynamically
  },
  rsvpButtonTextGoing: {
    // color set dynamically
  },
  rsvpButtonTextNotGoing: {
    // color set dynamically
  },
  viewAllButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
