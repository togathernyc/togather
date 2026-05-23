/**
 * NeededRolesModal
 *
 * Declares how many of each role an event needs ("2 Drums, 4 Vocals"),
 * grouped per serving team. Counts pre-fill from each role's
 * `defaultNeeded`; the scheduler tweaks them per event. Saving replaces
 * the event's full needed-roles set.
 *
 * The modal is self-contained: leaders can add a new role to a team or
 * create a brand-new team inline, without leaving the sheet (per the
 * approved ASCII sketch).
 *
 * Backend: scheduling.teams.listTeams / createServingTeam,
 * scheduling.roles.listRoles / createRole,
 * scheduling.events.setNeededRoles.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR } from "../utils/format";
import { TeamChannelToggle } from "./TeamChannelToggle";

type Team = {
  _id: Id<"teams">;
  name: string;
  hasChannel: boolean;
  memberCount: number;
};
type Role = {
  _id: Id<"teamRoles">;
  name: string;
  color?: string;
  defaultNeeded?: number;
};

/** A role's needed count keyed for the local edit map. */
type CountMap = Record<string, number>;

export function NeededRolesModal({
  visible,
  planId,
  groupId,
  /** roleId -> current count, from the event's existing needed roles. */
  currentCounts,
  onClose,
}: {
  visible: boolean;
  planId: Id<"eventPlans">;
  groupId: Id<"groups">;
  currentCounts: Record<string, number>;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  const teams = useAuthenticatedQuery(
    api.functions.scheduling.teams.listTeams,
    visible ? { groupId } : "skip",
  ) as Team[] | undefined;

  const setNeededRoles = useAuthenticatedMutation(
    api.functions.scheduling.events.setNeededRoles,
  );
  const createServingTeam = useAuthenticatedMutation(
    api.functions.scheduling.teams.createServingTeam,
  );

  const [counts, setCounts] = useState<CountMap>({});
  const [saving, setSaving] = useState(false);

  // The id of the team that should auto-expand and focus its "+ Add a role"
  // input — used right after creating a team inline.
  const [focusedTeamId, setFocusedTeamId] = useState<Id<"teams"> | null>(null);

  // Inline "create a new team" form state.
  const [creatingTeamFormOpen, setCreatingTeamFormOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamWithChannel, setNewTeamWithChannel] = useState(true);
  const [creatingTeam, setCreatingTeam] = useState(false);

  // Seed the edit map from the event's existing needed roles whenever the
  // modal opens.
  useEffect(() => {
    if (visible) {
      setCounts({ ...currentCounts });
      // Reset inline forms each time the modal opens.
      setCreatingTeamFormOpen(false);
      setNewTeamName("");
      setNewTeamWithChannel(true);
      setFocusedTeamId(null);
    }
  }, [visible, currentCounts]);

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name || creatingTeam) return;
    setCreatingTeam(true);
    try {
      const result = await createServingTeam({
        groupId,
        name,
        withChannel: newTeamWithChannel,
      });
      // listTeams will refetch reactively. Focus the new team so its role
      // input auto-opens once it appears in the list.
      setFocusedTeamId(result.teamId as Id<"teams">);
      setCreatingTeamFormOpen(false);
      setNewTeamName("");
      setNewTeamWithChannel(true);
    } catch (e: any) {
      Alert.alert(
        "Couldn't create team",
        e?.data?.message ?? e?.message ?? "Please try again.",
      );
    } finally {
      setCreatingTeam(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={[styles.cancel, { color: colors.textSecondary }]}>
              Cancel
            </Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Needed roles
          </Text>
          <TouchableOpacity
            hitSlop={12}
            disabled={saving}
            onPress={async () => {
              setSaving(true);
              try {
                const roles = Object.entries(counts)
                  .filter(([, count]) => count > 0)
                  .map(([key, count]) => {
                    const [teamId, roleId] = key.split("|");
                    return {
                      teamId: teamId as Id<"teams">,
                      roleId: roleId as Id<"teamRoles">,
                      count,
                    };
                  });
                await setNeededRoles({ planId, roles });
                onClose();
              } catch (e: any) {
                Alert.alert(
                  "Couldn't save",
                  e?.message ?? "Please try again.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={[styles.save, { color: colors.buttonPrimary }]}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {teams === undefined ? (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.text} />
          </View>
        ) : (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          >
            {teams.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No serving teams in this group yet. Create one below.
              </Text>
            ) : (
              teams.map((team) => (
                <TeamSection
                  key={team._id}
                  team={team}
                  counts={counts}
                  setCounts={setCounts}
                  autoFocusAddRole={team._id === focusedTeamId}
                />
              ))
            )}

            {/* Inline "Create a new team" affordance */}
            {creatingTeamFormOpen ? (
              <View
                style={[
                  styles.newTeamCard,
                  { backgroundColor: colors.surfaceSecondary },
                ]}
              >
                <Text style={[styles.label, { color: colors.text }]}>
                  New team name
                </Text>
                <TextInput
                  value={newTeamName}
                  onChangeText={setNewTeamName}
                  placeholder="e.g. Hospitality"
                  placeholderTextColor={colors.inputPlaceholder}
                  maxLength={50}
                  autoFocus
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      borderColor: colors.inputBorder,
                      backgroundColor: colors.inputBackground,
                    },
                  ]}
                />
                <View style={styles.switchRow}>
                  <Ionicons
                    name="chatbubbles-outline"
                    size={18}
                    color={colors.text}
                  />
                  <Text style={[styles.switchLabel, { color: colors.text }]}>
                    Give this team a chat channel
                  </Text>
                  <Switch
                    value={newTeamWithChannel}
                    onValueChange={setNewTeamWithChannel}
                  />
                </View>
                <View style={styles.newTeamActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setCreatingTeamFormOpen(false);
                      setNewTeamName("");
                      setNewTeamWithChannel(true);
                    }}
                    disabled={creatingTeam}
                    hitSlop={8}
                    style={[
                      styles.newTeamCancelBtn,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.newTeamCancelText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCreateTeam}
                    disabled={creatingTeam || newTeamName.trim().length === 0}
                    hitSlop={8}
                    style={[
                      styles.newTeamCreateBtn,
                      {
                        backgroundColor:
                          creatingTeam || newTeamName.trim().length === 0
                            ? colors.border
                            : colors.buttonPrimary,
                      },
                    ]}
                  >
                    {creatingTeam ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.newTeamCreateText}>Create team</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => setCreatingTeamFormOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Create a new team"
              >
                <View
                  style={[
                    styles.createTeamRow,
                    { borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="add"
                    size={18}
                    color={colors.buttonPrimary}
                  />
                  <Text
                    style={[
                      styles.createTeamText,
                      { color: colors.buttonPrimary },
                    ]}
                  >
                    Create a new team
                  </Text>
                </View>
              </Pressable>
            )}
          </ScrollView>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

/** Per-team section listing its roles with steppers + inline "add role". */
function TeamSection({
  team,
  counts,
  setCounts,
  autoFocusAddRole,
}: {
  team: Team;
  counts: CountMap;
  setCounts: React.Dispatch<React.SetStateAction<CountMap>>;
  autoFocusAddRole: boolean;
}) {
  const { colors } = useTheme();
  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    { teamId: team._id },
  ) as Role[] | undefined;

  const createRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.createRole,
  );

  const [newRoleName, setNewRoleName] = useState("");
  const [addingRole, setAddingRole] = useState(false);
  const newRoleInputRef = useRef<TextInput | null>(null);
  const focusedOnceRef = useRef(false);

  // Focus the add-role input the first time the team should be "focused"
  // (e.g. right after the leader created the team inline).
  useEffect(() => {
    if (autoFocusAddRole && !focusedOnceRef.current && roles !== undefined) {
      focusedOnceRef.current = true;
      // Defer to next tick so layout has settled.
      const t = setTimeout(() => newRoleInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [autoFocusAddRole, roles]);

  // First time a role is touched, fall back to its defaultNeeded.
  const defaults = useMemo(() => {
    const map: CountMap = {};
    for (const role of roles ?? []) {
      map[`${team._id}|${role._id}`] = role.defaultNeeded ?? 0;
    }
    return map;
  }, [roles, team._id]);

  // Seed the parent edit map with each role's default once the roles load,
  // so Save (which serializes `counts`) writes the defaults the UI shows
  // even when the scheduler never touches a stepper.
  useEffect(() => {
    if (!roles) return;
    setCounts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const role of roles) {
        const key = `${team._id}|${role._id}`;
        if (next[key] === undefined) {
          next[key] = role.defaultNeeded ?? 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [roles, team._id, setCounts]);

  const countFor = (roleId: string) => {
    const key = `${team._id}|${roleId}`;
    return counts[key] ?? defaults[key] ?? 0;
  };

  const setCount = (roleId: string, value: number) => {
    const key = `${team._id}|${roleId}`;
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, value) }));
  };

  const totalNeeded = useMemo(() => {
    if (!roles) return 0;
    let sum = 0;
    for (const role of roles) sum += countFor(role._id as string);
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, counts]);

  const handleAddRole = async () => {
    const name = newRoleName.trim();
    if (!name || addingRole) return;
    setAddingRole(true);
    try {
      const result = await createRole({ teamId: team._id, name });
      // Immediately mark the new role as needed on this event (count = 1).
      setCounts((prev) => ({
        ...prev,
        [`${team._id}|${result.roleId}`]: 1,
      }));
      setNewRoleName("");
      // Keep focus in the input so the leader can add more roles quickly.
      newRoleInputRef.current?.focus();
    } catch (e: any) {
      Alert.alert(
        "Couldn't add role",
        e?.data?.message ?? e?.message ?? "Please try again.",
      );
    } finally {
      setAddingRole(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionLabel, { color: colors.text }]} numberOfLines={1}>
          {team.name}
        </Text>
        <View style={styles.sectionHeaderRight}>
          <TeamChannelToggle
            teamId={team._id}
            teamName={team.name}
            hasChannel={team.hasChannel}
            channelMemberCount={team.memberCount}
          />
          {totalNeeded > 0 ? (
            <Text
              style={[styles.neededCount, { color: colors.textSecondary }]}
            >
              {totalNeeded} needed
            </Text>
          ) : null}
        </View>
      </View>
      <View
        style={[styles.group, { backgroundColor: colors.surfaceSecondary }]}
      >
        {roles === undefined ? (
          <ActivityIndicator
            size="small"
            color={colors.text}
            style={{ padding: 16 }}
          />
        ) : (
          <>
            {roles.length === 0 ? (
              <Text style={[styles.emptyRow, { color: colors.textSecondary }]}>
                No roles defined yet — add one below.
              </Text>
            ) : (
              roles.map((role, idx) => {
                const count = countFor(role._id as string);
                return (
                  <View
                    key={role._id}
                    style={[
                      styles.roleRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: role.color ?? DEFAULT_ROLE_COLOR },
                      ]}
                    />
                    <Text
                      style={[styles.roleName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {role.name}
                    </Text>
                    <Stepper
                      value={count}
                      onChange={(v) => setCount(role._id as string, v)}
                    />
                  </View>
                );
              })
            )}

            {/* Inline "+ Add a role to {team}" */}
            <View
              style={[
                styles.addRoleRow,
                roles.length > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Ionicons name="add" size={18} color={colors.buttonPrimary} />
              <TextInput
                ref={(r) => {
                  newRoleInputRef.current = r;
                }}
                value={newRoleName}
                onChangeText={setNewRoleName}
                placeholder={`Add a role to ${team.name}`}
                placeholderTextColor={colors.inputPlaceholder}
                onSubmitEditing={handleAddRole}
                returnKeyType="done"
                maxLength={50}
                editable={!addingRole}
                style={[styles.addRoleInput, { color: colors.text }]}
              />
              <TouchableOpacity
                onPress={handleAddRole}
                disabled={addingRole || newRoleName.trim().length === 0}
                hitSlop={8}
                style={[
                  styles.addRoleBtn,
                  {
                    backgroundColor:
                      addingRole || newRoleName.trim().length === 0
                        ? colors.border
                        : colors.buttonPrimary,
                  },
                ]}
              >
                {addingRole ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addRoleBtnText}>Add</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** A simple -/+ count stepper. */
function Stepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(value - 1)}
        disabled={value <= 0}
        hitSlop={6}
      >
        <View
          style={[
            styles.stepBtn,
            { borderColor: colors.border },
            value <= 0 && { opacity: 0.4 },
          ]}
        >
          <Ionicons name="remove" size={18} color={colors.text} />
        </View>
      </Pressable>
      <Text style={[styles.stepValue, { color: colors.text }]}>{value}</Text>
      <Pressable onPress={() => onChange(value + 1)} hitSlop={6}>
        <View style={[styles.stepBtn, { borderColor: colors.border }]}>
          <Ionicons name="add" size={18} color={colors.text} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  cancel: {
    fontSize: 16,
  },
  save: {
    fontSize: 16,
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    paddingVertical: 12,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 8,
    gap: 8,
  },
  sectionHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionLabel: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  neededCount: {
    fontSize: 12,
    fontWeight: "600",
  },
  group: {
    borderRadius: 12,
    overflow: "hidden",
  },
  emptyRow: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  roleName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: {
    fontSize: 16,
    fontWeight: "600",
    minWidth: 20,
    textAlign: "center",
  },
  addRoleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addRoleInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
  },
  addRoleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  addRoleBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  createTeamRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    marginTop: 4,
  },
  createTeamText: {
    fontSize: 15,
    fontWeight: "600",
  },
  newTeamCard: {
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  newTeamActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  newTeamCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  newTeamCancelText: {
    fontSize: 14,
    fontWeight: "600",
  },
  newTeamCreateBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    minWidth: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  newTeamCreateText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
