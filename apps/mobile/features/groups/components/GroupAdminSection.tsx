/**
 * GroupAdminSection
 *
 * "COMMUNITY ADMIN" section on the non-member group page. Community admins
 * can edit any group and decide who approves its join requests, but before
 * this they had to join a group to reach those controls. The backend already
 * allows it (`groups.update` via `requireGroupLeaderOrCommunityAdmin`,
 * `setJoinApprovalMode` is admin-only, `reviewGroupJoinRequest` always allows
 * admins); this section is just the entry point.
 *
 * Callers render it only for community admins.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { AdminViewNote } from "@components/ui/AdminViewNote";
import { formatError } from "@/utils/error-handling";
import { sectionStyles } from "./sectionStyles";
import { Group } from "../types";

export function GroupAdminSection({ group }: { group: Group }) {
  const router = useRouter();
  const { colors } = useTheme();
  const groupId = group._id as Id<"groups">;

  const pendingRequestCount = useAuthenticatedQuery(
    api.functions.groupMembers.countGroupJoinRequests,
    { groupId },
  ) as number | undefined;

  const setJoinApprovalMode = useAuthenticatedMutation(
    api.functions.groups.index.setJoinApprovalMode,
  );
  const serverLeadersApprove =
    (group as any).join_approval_mode === "leaders";
  const [leadersApprove, setLeadersApprove] = useState(serverLeadersApprove);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    setLeadersApprove(serverLeadersApprove);
  }, [serverLeadersApprove]);

  const handleToggleLeadersApprove = async (next: boolean) => {
    const previous = leadersApprove;
    setLeadersApprove(next); // optimistic
    setIsSaving(true);
    try {
      await setJoinApprovalMode({
        groupId,
        mode: next ? "leaders" : "admins",
      });
    } catch (error) {
      setLeadersApprove(previous);
      Alert.alert(
        "Couldn't update approvals",
        formatError(error, "Failed to update who approves requests"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const requestCount = pendingRequestCount ?? 0;
  const divider = {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  };

  return (
    <View style={sectionStyles.section}>
      <Text
        style={[sectionStyles.sectionHeader, { color: colors.textSecondary }]}
      >
        COMMUNITY ADMIN
      </Text>
      <View
        style={[sectionStyles.card, { backgroundColor: colors.surfaceSecondary }]}
      >
        <TouchableOpacity
          onPress={() => router.push(`/groups/${groupId}/edit`)}
          activeOpacity={0.7}
          style={sectionStyles.detailRow}
          accessibilityRole="button"
        >
          <Ionicons name="create-outline" size={20} color={colors.icon} />
          <Text style={[sectionStyles.detailText, { color: colors.text }]}>
            Edit group
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        <View style={[sectionStyles.detailRow, divider]}>
          <Ionicons name="checkmark-circle-outline" size={20} color={colors.icon} />
          <View style={styles.flex}>
            <Text style={[sectionStyles.detailText, { color: colors.text }]}>
              Let group leaders approve requests
            </Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              When off, community admins approve join requests.
            </Text>
          </View>
          <Switch
            value={leadersApprove}
            onValueChange={handleToggleLeadersApprove}
            disabled={isSaving}
            accessibilityLabel="Let group leaders approve requests"
          />
        </View>

        <TouchableOpacity
          onPress={() => router.push(`/groups/${groupId}/requests` as any)}
          activeOpacity={0.7}
          style={[sectionStyles.detailRow, divider]}
          accessibilityRole="button"
        >
          <Ionicons name="person-add-outline" size={20} color={colors.icon} />
          <Text style={[sectionStyles.detailText, { color: colors.text }]}>
            Requests to join
          </Text>
          {requestCount > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.warning }]}>
              <Text style={[styles.badgeText, { color: colors.onAccent }]}>
                {requestCount}
              </Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
      <View style={styles.noteWrap}>
        <AdminViewNote text="Shown because you're a community admin. You're not a member, so you won't get this group's messages." />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hint: { fontSize: 12, marginTop: 2 },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 11,
    alignItems: "center",
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
  noteWrap: { marginTop: 8 },
});
