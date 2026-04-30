import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";
import { useTheme } from "@hooks/useTheme";

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
  const { colors } = useTheme();
  return (
    <View style={[styles.memberItem, { borderBottomColor: colors.border }]}>
      {showCheckbox && onToggleAttendance && (
        <TouchableOpacity
          style={styles.attendanceToggle}
          onPress={() => onToggleAttendance(member.id)}
          testID="attendance-toggle"
        >
          <Ionicons
            name={isAttended ? "checkmark-circle" : "ellipse-outline"}
            size={24}
            color={isAttended ? colors.success : colors.iconSecondary}
          />
        </TouchableOpacity>
      )}
      <View style={styles.memberInfo}>
        <Avatar
          name={`${member.first_name} ${member.last_name}`}
          imageUrl={member.profile_photo}
          size={40}
          notificationsDisabled={!!member.notifications_disabled}
        />
        <View style={styles.memberDetails}>
          <Text style={[styles.memberName, { color: colors.text }]}>
            {member.first_name} {member.last_name}
            {isCurrentUser && " (You)"}
          </Text>
          <Text style={[styles.memberRole, { color: colors.textSecondary }]}>{member.role}</Text>
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
    marginBottom: 2,
  },
  memberRole: {
    fontSize: 14,
  },
});

