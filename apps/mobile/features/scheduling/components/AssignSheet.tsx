/**
 * AssignSheet
 *
 * A bottom sheet for assigning a person to a role slot. Lists the event's
 * group members as the assignable pool — team-channel membership is now
 * auto-derived from assignments (see scheduling/teamChannelSync), so listing
 * the channel's members here would be circular. People who have previously
 * filled this role are floated to the top under a "Previously filled by"
 * header. After an assignment, a soft double-booking warning surfaces if the
 * backend reports a same-day conflict — it never hard-blocks.
 *
 * Backend: groupMembers.list,
 * scheduling.assignments.previousFillers / assignRole.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";

/** A normalized assignable person (sourced from the event's group roster). */
type AssignablePerson = {
  id: string;
  userId: Id<"users">;
  displayName?: string;
  profilePhoto?: string;
};

/** Raw row shape returned by `groupMembers.list`. */
type GroupMemberRow = {
  id: string;
  odUserId: Id<"users">;
  user: {
    firstName: string;
    lastName: string;
    profileImage?: string;
  } | null;
};

type PreviousFiller = {
  userId: Id<"users">;
  userName: string;
  lastServedDate: number;
};

export function AssignSheet({
  visible,
  planId,
  groupId,
  channelId,
  roleId,
  roleName,
  timeLabel,
  assignedUserIds,
  onClose,
}: {
  visible: boolean;
  planId: Id<"eventPlans">;
  /** The event plan's owning group — its members are the assignable pool. */
  groupId: Id<"groups">;
  channelId: Id<"chatChannels">;
  roleId: Id<"teamRoles">;
  roleName: string;
  /** A single event-time label, when the event has exactly one time. */
  timeLabel?: string;
  /** Users already on this role — shown as disabled. */
  assignedUserIds: Set<string>;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  const memberData = useAuthenticatedQuery(
    api.functions.groupMembers.list,
    visible ? { groupId, limit: 200 } : "skip",
  ) as { items: GroupMemberRow[] } | undefined;

  // Normalize the group roster into the assignable-person shape.
  const members = useMemo<AssignablePerson[]>(() => {
    return (memberData?.items ?? [])
      .filter((row): row is GroupMemberRow & { user: NonNullable<GroupMemberRow["user"]> } => row.user !== null)
      .map((row) => ({
        id: row.id,
        userId: row.odUserId,
        displayName:
          `${row.user.firstName} ${row.user.lastName}`.trim() || "Member",
        profilePhoto: row.user.profileImage,
      }));
  }, [memberData?.items]);

  const previous = useAuthenticatedQuery(
    api.functions.scheduling.assignments.previousFillers,
    visible ? { roleId, limit: 8 } : "skip",
  ) as PreviousFiller[] | undefined;

  const assignRole = useAuthenticatedMutation(
    api.functions.scheduling.assignments.assignRole,
  );
  const [assigning, setAssigning] = useState<string | null>(null);

  // Float previously-confirmed fillers to the top, de-duplicated against
  // the rest of the roster.
  const { topMembers, restMembers } = useMemo(() => {
    const byUser = new Map(members.map((m) => [m.userId as string, m]));
    const prevIds = new Set((previous ?? []).map((p) => p.userId as string));
    const top = (previous ?? [])
      .map((p) => byUser.get(p.userId as string))
      .filter((m): m is AssignablePerson => !!m);
    const rest = members.filter((m) => !prevIds.has(m.userId as string));
    return { topMembers: top, restMembers: rest };
  }, [members, previous]);

  const handleAssign = useCallback(
    async (member: AssignablePerson) => {
      if (assignedUserIds.has(member.userId as string)) return;
      setAssigning(member.userId as string);
      try {
        const result = await assignRole({
          planId,
          channelId,
          roleId,
          userId: member.userId,
          timeLabel,
        });
        if (result.doubleBooked) {
          Alert.alert(
            "Heads up — double-booked",
            `${member.displayName ?? "This person"} is already scheduled somewhere else this day. They've still been assigned — they can sort it out when they respond.`,
          );
        }
        onClose();
      } catch (e: any) {
        Alert.alert("Couldn't assign", e?.message ?? "Please try again.");
      } finally {
        setAssigning(null);
      }
    },
    [assignedUserIds, assignRole, planId, channelId, roleId, timeLabel, onClose],
  );

  const renderMember = (member: AssignablePerson, prior: boolean) => {
    const already = assignedUserIds.has(member.userId as string);
    const busy = assigning === (member.userId as string);
    return (
      <Pressable
        key={member.id}
        onPress={() => handleAssign(member)}
        disabled={already || !!assigning}
        style={({ pressed }) => [
          styles.memberRow,
          pressed && !already && { backgroundColor: colors.selectedBackground },
          already && { opacity: 0.5 },
        ]}
      >
        <Avatar
          name={member.displayName ?? "Member"}
          imageUrl={member.profilePhoto}
          size={40}
        />
        <Text
          style={[styles.memberName, { color: colors.text }]}
          numberOfLines={1}
        >
          {member.displayName ?? "Member"}
        </Text>
        {busy ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : already ? (
          <Text style={[styles.alreadyText, { color: colors.textSecondary }]}>
            Assigned
          </Text>
        ) : prior ? (
          <Ionicons name="star" size={16} color={colors.warning} />
        ) : (
          <Ionicons name="add" size={20} color={colors.textSecondary} />
        )}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View
          style={[styles.header, { borderBottomColor: colors.border }]}
        >
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Assign {roleName}
            </Text>
            {timeLabel ? (
              <Text
                style={[styles.headerSub, { color: colors.textSecondary }]}
              >
                {timeLabel}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
        </View>

        {memberData === undefined ? (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.text} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {topMembers.length > 0 && (
              <>
                <Text
                  style={[styles.sectionLabel, { color: colors.textSecondary }]}
                >
                  PREVIOUSLY FILLED BY
                </Text>
                <View
                  style={[
                    styles.group,
                    { backgroundColor: colors.surfaceSecondary },
                  ]}
                >
                  {topMembers.map((m) => renderMember(m, true))}
                </View>
              </>
            )}
            <Text
              style={[styles.sectionLabel, { color: colors.textSecondary }]}
            >
              GROUP MEMBERS
            </Text>
            <View
              style={[
                styles.group,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              {restMembers.length === 0 ? (
                <Text
                  style={[styles.emptyText, { color: colors.textSecondary }]}
                >
                  {topMembers.length > 0
                    ? "Everyone in this group is already an option above."
                    : "No group members to assign yet."}
                </Text>
              ) : (
                restMembers.map((m) => renderMember(m, false))
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  headerSub: {
    fontSize: 13,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  group: {
    borderRadius: 12,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
  },
  memberName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  alreadyText: {
    fontSize: 13,
  },
  emptyText: {
    fontSize: 14,
    padding: 16,
    lineHeight: 20,
  },
});
