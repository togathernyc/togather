/**
 * NeededRolesModal
 *
 * Declares how many of each role an event needs ("2 Drums, 4 Vocals"),
 * grouped per serving-team channel. Counts pre-fill from each role's
 * `defaultNeeded`; the scheduler tweaks them per event. Saving replaces
 * the event's full needed-roles set.
 *
 * Backend: scheduling.teams.listTeamChannels, scheduling.roles.listRoles,
 * scheduling.events.setNeededRoles.
 */
import React, { useEffect, useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR } from "../utils/format";

type TeamChannel = { _id: Id<"chatChannels">; name: string };
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

  const teamChannels = useAuthenticatedQuery(
    api.functions.scheduling.teams.listTeamChannels,
    visible ? { groupId } : "skip",
  ) as TeamChannel[] | undefined;

  const setNeededRoles = useAuthenticatedMutation(
    api.functions.scheduling.events.setNeededRoles,
  );

  const [counts, setCounts] = useState<CountMap>({});
  const [saving, setSaving] = useState(false);

  // Seed the edit map from the event's existing needed roles whenever the
  // modal opens.
  useEffect(() => {
    if (visible) setCounts({ ...currentCounts });
  }, [visible, currentCounts]);

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
                    const [channelId, roleId] = key.split("|");
                    return {
                      channelId: channelId as Id<"chatChannels">,
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

        {teamChannels === undefined ? (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.text} />
          </View>
        ) : teamChannels.length === 0 ? (
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No serving teams in this group yet. Set up a team channel as a
              serving team first.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {teamChannels.map((channel) => (
              <TeamSection
                key={channel._id}
                channel={channel}
                counts={counts}
                setCounts={setCounts}
                groupId={groupId}
                onClose={onClose}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/** Per-team-channel section listing its roles with steppers. */
function TeamSection({
  channel,
  counts,
  setCounts,
  groupId,
  onClose,
}: {
  channel: TeamChannel;
  counts: CountMap;
  setCounts: React.Dispatch<React.SetStateAction<CountMap>>;
  groupId: Id<"groups">;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    { channelId: channel._id },
  ) as Role[] | undefined;

  // First time a role is touched, fall back to its defaultNeeded.
  const defaults = useMemo(() => {
    const map: CountMap = {};
    for (const role of roles ?? []) {
      map[`${channel._id}|${role._id}`] = role.defaultNeeded ?? 0;
    }
    return map;
  }, [roles, channel._id]);

  // Seed the parent edit map with each role's default once the roles load,
  // so Save (which serializes `counts`) writes the defaults the UI shows
  // even when the scheduler never touches a stepper.
  useEffect(() => {
    if (!roles) return;
    setCounts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const role of roles) {
        const key = `${channel._id}|${role._id}`;
        if (next[key] === undefined) {
          next[key] = role.defaultNeeded ?? 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [roles, channel._id, setCounts]);

  const countFor = (roleId: string) => {
    const key = `${channel._id}|${roleId}`;
    return counts[key] ?? defaults[key] ?? 0;
  };

  const setCount = (roleId: string, value: number) => {
    const key = `${channel._id}|${roleId}`;
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, value) }));
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          {channel.name.toUpperCase()}
        </Text>
        <TouchableOpacity
          hitSlop={8}
          onPress={() => {
            onClose();
            router.push(
              `/rostering/${groupId}/team/${channel._id}`,
            );
          }}
        >
          <Text style={[styles.editRolesLink, { color: colors.buttonPrimary }]}>
            Edit roles
          </Text>
        </TouchableOpacity>
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
        ) : roles.length === 0 ? (
          <Text style={[styles.emptyRow, { color: colors.textSecondary }]}>
            No roles defined for this team.
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
        style={[
          styles.stepBtn,
          { borderColor: colors.border },
          value <= 0 && { opacity: 0.4 },
        ]}
      >
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text style={[styles.stepValue, { color: colors.text }]}>{value}</Text>
      <Pressable
        onPress={() => onChange(value + 1)}
        hitSlop={6}
        style={[styles.stepBtn, { borderColor: colors.border }]}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  editRolesLink: {
    fontSize: 13,
    fontWeight: "600",
  },
  group: {
    borderRadius: 12,
    overflow: "hidden",
  },
  emptyRow: {
    fontSize: 14,
    padding: 16,
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
});
