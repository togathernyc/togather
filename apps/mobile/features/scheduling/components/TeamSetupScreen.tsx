/**
 * TeamSetupScreen — the Team detail screen (ADR-024 §3, ADR-025).
 *
 * Reached from the Rostering hub's Teams view. Shows a first-class serving
 * team: header (name, member count / channel state), the roles editor, an
 * "Open chat" affordance when the team has a chat channel, and permanent
 * members management. On first visit, if the team has no roles yet, it
 * offers a starter role set inferred from the team name.
 *
 * Route: /rostering/[group_id]/team/[team_id]
 *
 * Backend: scheduling.teams.getTeam,
 * scheduling.roles.suggestStarterRoles / listRoles / createRole.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@components/ui/Avatar";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { confirmAsync, notify } from "@/utils/platformAlert";
import { RolesEditor } from "./RolesEditor";
import { ROLE_COLORS } from "../utils/format";

type StarterRole = { name: string; defaultNeeded: number };
type Role = { _id: Id<"teamRoles">; name: string };

type Team = {
  _id: Id<"teams">;
  groupId: Id<"groups">;
  name: string;
  description?: string;
  channelId: Id<"chatChannels"> | null;
  channelSlug: string | null;
  hasChannel: boolean;
  isArchived: boolean;
  memberCount: number;
  createdAt: number;
};

type PermanentMember = {
  userId: Id<"users">;
  displayName: string;
  profilePhoto?: string;
};

/** Raw row shape returned by `groupMembers.list`. */
type GroupMemberRow = {
  id: string;
  user: {
    id: Id<"users">;
    firstName: string;
    lastName: string;
    profileImage?: string;
  } | null;
};

export function TeamSetupScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { team_id, group_id } = useLocalSearchParams<{
    team_id: string;
    group_id: string;
  }>();
  const teamId = team_id as Id<"teams">;
  const groupId = group_id as Id<"groups"> | undefined;

  const team = useAuthenticatedQuery(
    api.functions.scheduling.teams.getTeam,
    teamId ? { teamId } : "skip",
  ) as Team | undefined;

  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    teamId ? { teamId } : "skip",
  ) as Role[] | undefined;

  const suggestion = useAuthenticatedQuery(
    api.functions.scheduling.roles.suggestStarterRoles,
    teamId ? { teamId } : "skip",
  ) as { teamName: string; roles: StarterRole[] } | undefined;

  // The chat channel's slug arrives on the team itself (`getTeam` resolves
  // it under the team's group-member gate) — `messaging.channels.getChannel`
  // is membership-gated and the creator of a fresh team isn't a member yet.

  const createRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.createRole,
  );

  const [seeding, setSeeding] = useState(false);
  // Starter suggestions the leader has dismissed (by index in the list).
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const hasRoles = (roles?.length ?? 0) > 0;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const handleOpenChat = useCallback(() => {
    if (!team?.groupId || !team?.channelSlug) return;
    router.push(`/inbox/${team.groupId}/${team.channelSlug}` as never);
  }, [router, team?.groupId, team?.channelSlug]);

  const handleAcceptStarters = useCallback(async () => {
    if (!suggestion) return;
    const accepted = suggestion.roles.filter((_, i) => !dismissed.has(i));
    if (accepted.length === 0) return;
    setSeeding(true);
    try {
      for (let i = 0; i < accepted.length; i++) {
        await createRole({
          teamId,
          name: accepted[i].name,
          color: ROLE_COLORS[i % ROLE_COLORS.length],
          defaultNeeded: accepted[i].defaultNeeded,
        });
      }
    } catch (e: any) {
      Alert.alert("Couldn't add roles", e?.message ?? "Please try again.");
    } finally {
      setSeeding(false);
    }
  }, [suggestion, dismissed, createRole, teamId]);

  const showStarters = !hasRoles && (suggestion?.roles.length ?? 0) > 0;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {team?.name ?? "Team"}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {team === undefined || roles === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          {/* Team summary */}
          <Text style={[styles.teamName, { color: colors.text }]}>
            {team.name}
          </Text>
          {team.description ? (
            <Text style={[styles.teamDescription, { color: colors.textSecondary }]}>
              {team.description}
            </Text>
          ) : null}
          <Text style={[styles.teamMeta, { color: colors.textSecondary }]}>
            {team.hasChannel
              ? `${team.memberCount} ${
                  team.memberCount === 1 ? "member" : "members"
                }`
              : "Roster only — no chat channel"}
          </Text>

          {/* Open chat — only when the team has a channel. */}
          {team.hasChannel && team.channelId ? (
            <Pressable
              onPress={handleOpenChat}
              disabled={!team?.channelSlug}
              style={({ pressed }) => [
                styles.openChatRow,
                { backgroundColor: colors.surfaceSecondary },
                (pressed || !team?.channelSlug) && { opacity: 0.8 },
              ]}
            >
              <Ionicons
                name="chatbubbles-outline"
                size={20}
                color={colors.text}
              />
              <Text style={[styles.openChatLabel, { color: colors.text }]}>
                Open chat
              </Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textTertiary}
              />
            </Pressable>
          ) : null}

          {showStarters && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                SUGGESTED ROLES
              </Text>
              <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                Based on the team name. Tap to remove any you don't need.
              </Text>
              <View
                style={[
                  styles.starterGroup,
                  { backgroundColor: colors.surfaceSecondary },
                ]}
              >
                {suggestion!.roles.map((role, idx) => {
                  const isDismissed = dismissed.has(idx);
                  return (
                    <Pressable
                      key={`${role.name}-${idx}`}
                      onPress={() =>
                        setDismissed((prev) => {
                          const next = new Set(prev);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          return next;
                        })
                      }
                      style={[
                        styles.starterRow,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isDismissed ? "ellipse-outline" : "checkmark-circle"}
                        size={22}
                        color={isDismissed ? colors.iconSecondary : colors.success}
                      />
                      <Text
                        style={[
                          styles.starterName,
                          {
                            color: isDismissed
                              ? colors.textSecondary
                              : colors.text,
                          },
                          isDismissed && styles.starterNameDismissed,
                        ]}
                      >
                        {role.name}
                      </Text>
                      <Text
                        style={[
                          styles.starterCount,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Need {role.defaultNeeded}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={handleAcceptStarters}
                disabled={
                  seeding ||
                  dismissed.size === (suggestion?.roles.length ?? 0)
                }
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: colors.buttonPrimary },
                  (seeding ||
                    dismissed.size === (suggestion?.roles.length ?? 0)) && {
                    opacity: 0.6,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                {seeding ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text
                    style={[styles.primaryBtnText, { color: colors.textInverse }]}
                  >
                    Add{" "}
                    {(suggestion?.roles.length ?? 0) - dismissed.size} role
                    {(suggestion?.roles.length ?? 0) - dismissed.size === 1
                      ? ""
                      : "s"}
                  </Text>
                )}
              </Pressable>
              <Text style={[styles.orHint, { color: colors.textSecondary }]}>
                Or build the role list yourself below.
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              ROLES
            </Text>
            <RolesEditor teamId={teamId} />
          </View>

          {team.hasChannel && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                PERMANENT MEMBERS
              </Text>
              <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                These people are always in the channel, on top of whoever is
                auto-added from event plans.
              </Text>
              <PermanentMembersSection teamId={teamId} groupId={groupId} />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Permanent members of a serving-team channel — manually-added people the
 * rotation engine never removes. Lists them with a remove control and an
 * "Add member" affordance that picks from the campus group's roster.
 */
function PermanentMembersSection({
  teamId,
  groupId,
}: {
  teamId: Id<"teams">;
  groupId?: Id<"groups">;
}) {
  const { colors } = useTheme();

  const members = useAuthenticatedQuery(
    api.functions.scheduling.teams.listPermanentMembers,
    { teamId },
  ) as PermanentMember[] | undefined;

  const removeMember = useAuthenticatedMutation(
    api.functions.scheduling.teams.removePermanentMember,
  );

  const [pickerVisible, setPickerVisible] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRemove = useCallback(
    async (member: PermanentMember) => {
      const ok = await confirmAsync({
        title: "Remove member?",
        message: `${member.displayName} will be removed from this channel.`,
        confirmText: "Remove",
        destructive: true,
      });
      if (!ok) return;
      setRemoving(member.userId as string);
      try {
        await removeMember({ teamId, userId: member.userId });
      } catch (e: any) {
        notify("Couldn't remove", e?.message ?? "Please try again.");
      } finally {
        setRemoving(null);
      }
    },
    [removeMember, teamId],
  );

  if (members === undefined) {
    return (
      <View style={styles.permLoading}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.group, { backgroundColor: colors.surfaceSecondary }]}>
        {members.length === 0 ? (
          <Text style={[styles.permEmpty, { color: colors.textSecondary }]}>
            No permanent members yet.
          </Text>
        ) : (
          members.map((member, idx) => (
            <View
              key={member.userId}
              style={[
                styles.permRow,
                idx > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Avatar
                name={member.displayName}
                imageUrl={member.profilePhoto}
                size={36}
              />
              <Text
                style={[styles.permName, { color: colors.text }]}
                numberOfLines={1}
              >
                {member.displayName}
              </Text>
              {removing === (member.userId as string) ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Pressable
                  onPress={() => handleRemove(member)}
                  hitSlop={8}
                  style={styles.iconBtn}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={colors.destructive}
                  />
                </Pressable>
              )}
            </View>
          ))
        )}
      </View>

      <Pressable
        onPress={() => setPickerVisible(true)}
        disabled={!groupId}
        style={({ pressed }) => [
          styles.addRow,
          { backgroundColor: colors.surfaceSecondary },
          (pressed || !groupId) && { opacity: 0.7 },
        ]}
      >
        <Ionicons name="person-add-outline" size={20} color={colors.text} />
        <Text style={[styles.addLabel, { color: colors.text }]}>
          Add member
        </Text>
      </Pressable>

      {groupId && (
        <AddMemberModal
          visible={pickerVisible}
          teamId={teamId}
          groupId={groupId}
          existingUserIds={
            new Set((members ?? []).map((m) => m.userId as string))
          }
          onClose={() => setPickerVisible(false)}
        />
      )}
    </View>
  );
}

/** Picker modal: the campus group's members, minus current permanent members. */
function AddMemberModal({
  visible,
  teamId,
  groupId,
  existingUserIds,
  onClose,
}: {
  visible: boolean;
  teamId: Id<"teams">;
  groupId: Id<"groups">;
  existingUserIds: Set<string>;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  const memberData = useAuthenticatedQuery(
    api.functions.groupMembers.list,
    visible ? { groupId, limit: 200 } : "skip",
  ) as { items: GroupMemberRow[] } | undefined;

  const addMember = useAuthenticatedMutation(
    api.functions.scheduling.teams.addPermanentMember,
  );
  const [adding, setAdding] = useState<string | null>(null);

  const candidates = useMemo<PermanentMember[]>(() => {
    return (memberData?.items ?? [])
      .filter(
        (row): row is GroupMemberRow & { user: NonNullable<GroupMemberRow["user"]> } =>
          row.user !== null,
      )
      .map((row) => ({
        userId: row.user.id,
        displayName:
          `${row.user.firstName} ${row.user.lastName}`.trim() || "Member",
        profilePhoto: row.user.profileImage,
      }))
      .filter((m) => !existingUserIds.has(m.userId as string));
  }, [memberData?.items, existingUserIds]);

  const handleAdd = useCallback(
    async (member: PermanentMember) => {
      setAdding(member.userId as string);
      try {
        await addMember({ teamId, userId: member.userId });
        onClose();
      } catch (e: any) {
        Alert.alert("Couldn't add", e?.message ?? "Please try again.");
      } finally {
        setAdding(null);
      }
    },
    [addMember, teamId, onClose],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            Add permanent member
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
        </View>

        {memberData === undefined ? (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.text} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View
              style={[
                styles.group,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              {candidates.length === 0 ? (
                <Text style={[styles.permEmpty, { color: colors.textSecondary }]}>
                  Everyone in this group is already a permanent member.
                </Text>
              ) : (
                candidates.map((member, idx) => {
                  const busy = adding === (member.userId as string);
                  return (
                    <Pressable
                      key={member.userId}
                      onPress={() => handleAdd(member)}
                      disabled={!!adding}
                      style={({ pressed }) => [
                        styles.permRow,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        },
                        pressed && { backgroundColor: colors.selectedBackground },
                      ]}
                    >
                      <Avatar
                        name={member.displayName}
                        imageUrl={member.profilePhoto}
                        size={36}
                      />
                      <Text
                        style={[styles.permName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {member.displayName}
                      </Text>
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Ionicons
                          name="add"
                          size={20}
                          color={colors.textSecondary}
                        />
                      )}
                    </Pressable>
                  );
                })
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
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
  },
  teamName: {
    fontSize: 24,
    fontWeight: "700",
  },
  teamDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  teamMeta: {
    fontSize: 13,
    marginTop: 6,
  },
  openChatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
  },
  openChatLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  section: {
    marginTop: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  starterGroup: {
    borderRadius: 12,
    overflow: "hidden",
  },
  starterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  starterName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  starterNameDismissed: {
    textDecorationLine: "line-through",
  },
  starterCount: {
    fontSize: 13,
  },
  primaryBtn: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  orHint: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 12,
  },
  group: {
    borderRadius: 12,
    overflow: "hidden",
  },
  permLoading: {
    paddingVertical: 24,
    alignItems: "center",
  },
  permEmpty: {
    fontSize: 14,
    padding: 16,
    lineHeight: 20,
  },
  permRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
  },
  permName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  iconBtn: {
    padding: 4,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  modalScroll: {
    padding: 16,
  },
});
