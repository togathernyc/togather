import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";

interface MemberItemProps {
  member: any;
  isAttended: boolean;
  isCurrentUser?: boolean;
  onToggleAttendance?: (memberId: string) => void;
  showCheckbox?: boolean;
}

function MemberItemInner({
  member,
  isAttended,
  isCurrentUser = false,
  onToggleAttendance,
  showCheckbox = true,
}: MemberItemProps) {
  return (
    <View style={styles.memberItem}>
      {showCheckbox && onToggleAttendance && (
        <TouchableOpacity
          style={styles.attendanceToggle}
          onPress={() => onToggleAttendance(member.id)}
          testID="attendance-toggle"
        >
          <Ionicons
            name={isAttended ? "checkmark-circle" : "ellipse-outline"}
            size={24}
            color={isAttended ? "#66D440" : "#ccc"}
          />
        </TouchableOpacity>
      )}
      <View style={styles.memberInfo}>
        <Avatar
          name={`${member.first_name} ${member.last_name}`}
          imageUrl={member.profile_photo}
          size={40}
        />
        <View style={styles.memberDetails}>
          <Text style={styles.memberName}>
            {member.first_name} {member.last_name}
            {isCurrentUser && " (You)"}
          </Text>
          <Text style={styles.memberRole}>{member.role}</Text>
        </View>
      </View>
    </View>
  );
}

export const MemberItem = React.memo(MemberItemInner);

const styles = StyleSheet.create({
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  attendanceToggle: {
    padding: 4,
  },
  memberInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  memberDetails: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 2,
  },
  memberRole: {
    fontSize: 14,
    color: "#666",
  },
});

