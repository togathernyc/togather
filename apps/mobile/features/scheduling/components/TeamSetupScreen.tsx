/**
 * TeamSetupScreen
 *
 * Reached from a channel's "Set up as serving team" affordance. On first
 * setup it marks the channel as a team and offers a starter role set
 * inferred from the channel name — the leader accepts/edits/dismisses each
 * suggestion before it is written. Once roles exist, this is the roles
 * editor for the team.
 *
 * Route: /rostering/[group_id]/team/[channel_id]
 * Params: channel_id, plus `channelName` for the header (the channel doc
 * itself is not re-fetched — `suggestStarterRoles` already returns the name).
 *
 * Backend: scheduling.teams.markChannelAsTeam,
 * scheduling.roles.suggestStarterRoles / listRoles / createRole.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { RolesEditor } from "./RolesEditor";
import { ROLE_COLORS } from "../utils/format";

type StarterRole = { name: string; defaultNeeded: number };
type Role = { _id: Id<"teamRoles">; name: string };

type PermanentMember = {
  userId: Id<"users">;
  displayName: string;
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

export function TeamSetupScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    channel_id,
    group_id,
    channelName: channelNameParam,
  } = useLocalSearchParams<{
    channel_id: string;
    group_id: string;
    channelName?: string;
  }>();
  const channelId = channel_id as Id<"chatChannels">;
  const groupId = group_id as Id<"groups"> | undefined;

  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    channelId ? { channelId } : "skip",
  ) as Role[] | undefined;

  const suggestion = useAuthenticatedQuery(
    api.functions.scheduling.roles.suggestStarterRoles,
    channelId ? { channelId } : "skip",
  ) as { channelName: string | null; roles: StarterRole[] } | undefined;

  const markChannelAsTeam = useAuthenticatedMutation(
    api.functions.scheduling.teams.markChannelAsTeam,
  );
  const createRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.createRole,
  );

  const [setupState, setSetupState] = useState<"pending" | "ready" | "error">(
    "pending",
  );
  const [seeding, setSeeding] = useState(false);
  // Starter suggestions the leader has dismissed (by index in the list).
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const channelName = suggestion?.channelName ?? channelNameParam ?? "this team";
  const hasRoles = (roles?.length ?? 0) > 0;

  // Mark the channel as a serving team on first visit. `markChannelAsTeam`
  // is idempotent — re-marking an existing team is a no-op patch.
  useEffect(() => {
    let cancelled = false;
    markChannelAsTeam({ channelId })
      .then(() => {
        if (!cancelled) setSetupState("ready");
      })
      .catch((e: any) => {
        if (!cancelled) {
          setSetupState("error");
          Alert.alert(
            "Couldn't set up team",
            e?.message ?? "Please try again.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const handleAcceptStarters = useCallback(async () => {
    if (!suggestion) return;
    const accepted = suggestion.roles.filter((_, i) => !dismissed.has(i));
    if (accepted.length === 0) return;
    setSeeding(true);
    try {
      for (let i = 0; i < accepted.length; i++) {
        await createRole({
          channelId,
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
  }, [suggestion, dismissed, createRole, channelId]);

  const showStarters =
    setupState === "ready" &&
    !hasRoles &&
    (suggestion?.roles.length ?? 0) > 0;

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Serving team
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {setupState === "pending" ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : setupState === "error" ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            Couldn't set up this serving team.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            {`#${channelName} is set up as a serving team. Define the roles `}
            this team fills — each event plan can need a different number of
            each.
          </Text>

          {showStarters && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                SUGGESTED ROLES
              </Text>
              <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                Based on the channel name. Tap to remove any you don't need.
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
            <RolesEditor channelId={channelId} />
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              PERMANENT MEMBERS
            </Text>
            <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
              These people are always in the channel, on top of whoever is
              auto-added from event plans.
            </Text>
            <PermanentMembersSection channelId={channelId} groupId={groupId} />
          </View>
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
  channelId,
  groupId,
}: {
  channelId: Id<"chatChannels">;
  groupId?: Id<"groups">;
}) {
  const { colors } = useTheme();

  const members = useAuthenticatedQuery(
    api.functions.scheduling.teams.listPermanentMembers,
    { channelId },
  ) as PermanentMember[] | undefined;

  const removeMember = useAuthenticatedMutation(
    api.functions.scheduling.teams.removePermanentMember,
  );

  const [pickerVisible, setPickerVisible] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRemove = useCallback(
    (member: PermanentMember) => {
      Alert.alert(
        "Remove member?",
        `${member.displayName} will be removed from this channel.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              setRemoving(member.userId as string);
              try {
                await removeMember({ channelId, userId: member.userId });
              } catch (e: any) {
                Alert.alert(
                  "Couldn't remove",
                  e?.message ?? "Please try again.",
                );
              } finally {
                setRemoving(null);
              }
            },
          },
        ],
      );
    },
    [removeMember, channelId],
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
          channelId={channelId}
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
  channelId,
  groupId,
  existingUserIds,
  onClose,
}: {
  visible: boolean;
  channelId: Id<"chatChannels">;
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
        userId: row.odUserId,
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
        await addMember({ channelId, userId: member.userId });
        onClose();
      } catch (e: any) {
        Alert.alert("Couldn't add", e?.message ?? "Please try again.");
      } finally {
        setAdding(null);
      }
    },
    [addMember, channelId, onClose],
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
  errorText: {
    fontSize: 14,
  },
  scrollContent: {
    padding: 16,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
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
