import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Avatar } from "@components/ui/Avatar";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface Guest {
  id: string;
  firstName: string;
  profileImage?: string | null;
}

interface Props {
  eventId: string;
  groupId: string;
  totalGoing: number;
  topGuests: Guest[];
  userHasRsvpd: boolean;
  isGroupLeader: boolean;
  onViewAll: () => void;
}

export function GuestListSection({
  eventId,
  groupId,
  totalGoing,
  topGuests,
  userHasRsvpd,
  isGroupLeader,
  onViewAll,
}: Props) {
  const { primaryColor } = useCommunityTheme();
  const displayGuests = topGuests.slice(0, 6);
  const overflowCount = totalGoing - displayGuests.length;

  if (totalGoing === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Guest List</Text>
          <Text style={styles.subtitle}>{totalGoing} Going</Text>
        </View>
        <TouchableOpacity onPress={onViewAll}>
          <Text style={[styles.viewAllButton, { color: primaryColor }]}>View all</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.avatarStack}>
        {displayGuests.map((guest, index) => (
          <View
            key={guest.id}
            style={[
              styles.avatarWrapper,
              index > 0 && { marginLeft: -12 },
            ]}
          >
            <Avatar
              name={guest.firstName}
              imageUrl={guest.profileImage}
              size={40}
              style={styles.avatar}
            />
          </View>
        ))}
        {overflowCount > 0 && (
          <View style={[styles.avatarWrapper, { marginLeft: -12 }]}>
            <View style={styles.overflowBadge}>
              <Text style={styles.overflowText}>+{overflowCount}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#6B7280",
  },
  viewAllButton: {
    fontSize: 14,
    fontWeight: "600",
    color: DEFAULT_PRIMARY_COLOR,
  },
  avatarStack: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrapper: {
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 20,
  },
  avatar: {
    // Additional styling if needed
  },
  overflowBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
  },
  overflowText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B7280",
  },
});
