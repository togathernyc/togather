import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Avatar } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { GroupMember } from "../types";

interface MembersListProps {
  members: GroupMember[];
  showAll?: boolean;
  onViewAll?: () => void;
}

export function MembersList({
  members,
  showAll = false,
  onViewAll,
}: MembersListProps) {
  const { primaryColor } = useCommunityTheme();

  if (!members || members.length === 0) return null;

  const displayMembers = showAll ? members : members.slice(0, 10);

  return (
    <Card style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          Members ({members.length})
        </Text>
      </View>
      {displayMembers.map((member, index) => (
        <View
          key={member.id || index}
          style={[
            styles.memberItem,
            index === displayMembers.length - 1 && styles.memberItemLast,
          ]}
        >
          <Avatar
            name={`${member.first_name || ""} ${member.last_name || ""}`.trim()}
            imageUrl={member.profile_photo}
            size={48}
          />
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>
              {member.first_name} {member.last_name}
            </Text>
          </View>
        </View>
      ))}
      {!showAll && members.length > 10 && (
        <TouchableOpacity style={styles.moreMembersButton} onPress={onViewAll}>
          <Text style={[styles.moreMembers, { color: primaryColor }]}>
            View all {members.length} members
          </Text>
          <Ionicons name="chevron-forward" size={20} color={primaryColor} />
        </TouchableOpacity>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    marginHorizontal: 12,
    padding: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  memberItemLast: {
    borderBottomWidth: 0,
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  moreMembersButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 8,
    gap: 8,
  },
  moreMembers: {
    fontSize: 14,
    fontWeight: "600",
  },
});

