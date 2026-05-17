/**
 * RolesEditor
 *
 * Add / rename / reorder / archive the roles on a serving-team channel.
 * Each role carries a name, a color swatch, and a "usually need" default
 * count that seeds `neededRoles` on new events.
 *
 * Backend: scheduling.roles.listRoles / createRole / updateRole /
 * archiveRole / reorderRoles.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@components/ui/Modal";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { ROLE_COLORS, DEFAULT_ROLE_COLOR } from "../utils/format";

type Role = {
  _id: Id<"teamRoles">;
  name: string;
  color?: string;
  sortOrder: number;
  defaultNeeded?: number;
  isArchived: boolean;
};

export function RolesEditor({ channelId }: { channelId: Id<"chatChannels"> }) {
  const { colors } = useTheme();
  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    { channelId },
  ) as Role[] | undefined;

  const createRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.createRole,
  );
  const updateRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.updateRole,
  );
  const archiveRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.archiveRole,
  );
  const reorderRoles = useAuthenticatedMutation(
    api.functions.scheduling.roles.reorderRoles,
  );

  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  const openCreate = useCallback(() => {
    setEditing(null);
    setEditorVisible(true);
  }, []);

  const openEdit = useCallback((role: Role) => {
    setEditing(role);
    setEditorVisible(true);
  }, []);

  const handleSave = useCallback(
    async (name: string, color: string, defaultNeeded: number) => {
      setBusy(true);
      try {
        if (editing) {
          await updateRole({
            roleId: editing._id,
            name,
            color,
            defaultNeeded,
          });
        } else {
          await createRole({ channelId, name, color, defaultNeeded });
        }
        setEditorVisible(false);
        setEditing(null);
      } catch (e: any) {
        Alert.alert("Couldn't save role", e?.message ?? "Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [editing, updateRole, createRole, channelId],
  );

  const handleArchive = useCallback(
    (role: Role) => {
      Alert.alert(
        "Archive role?",
        `"${role.name}" stays on past events but won't appear on new ones.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Archive",
            style: "destructive",
            onPress: async () => {
              try {
                await archiveRole({ roleId: role._id });
              } catch (e: any) {
                Alert.alert(
                  "Couldn't archive",
                  e?.message ?? "Please try again.",
                );
              }
            },
          },
        ],
      );
    },
    [archiveRole],
  );

  const handleMove = useCallback(
    async (index: number, direction: -1 | 1) => {
      if (!roles) return;
      const target = index + direction;
      if (target < 0 || target >= roles.length) return;
      const ordered = roles.map((r) => r._id);
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      try {
        await reorderRoles({ channelId, orderedRoleIds: ordered });
      } catch (e: any) {
        Alert.alert("Couldn't reorder", e?.message ?? "Please try again.");
      }
    },
    [roles, reorderRoles, channelId],
  );

  if (roles === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.group, { backgroundColor: colors.surfaceSecondary }]}>
        {roles.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No roles yet. Add the roles this team fills each event.
          </Text>
        ) : (
          roles.map((role, idx) => (
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
              <Pressable
                onPress={() => openEdit(role)}
                style={styles.roleTextWrap}
              >
                <Text style={[styles.roleName, { color: colors.text }]}>
                  {role.name}
                </Text>
                <Text
                  style={[styles.roleMeta, { color: colors.textSecondary }]}
                >
                  Usually need {role.defaultNeeded ?? 0}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleMove(idx, -1)}
                disabled={idx === 0}
                hitSlop={8}
                style={styles.iconBtn}
              >
                <Ionicons
                  name="chevron-up"
                  size={20}
                  color={idx === 0 ? colors.border : colors.textSecondary}
                />
              </Pressable>
              <Pressable
                onPress={() => handleMove(idx, 1)}
                disabled={idx === roles.length - 1}
                hitSlop={8}
                style={styles.iconBtn}
              >
                <Ionicons
                  name="chevron-down"
                  size={20}
                  color={
                    idx === roles.length - 1
                      ? colors.border
                      : colors.textSecondary
                  }
                />
              </Pressable>
              <Pressable
                onPress={() => handleArchive(role)}
                hitSlop={8}
                style={styles.iconBtn}
              >
                <Ionicons
                  name="archive-outline"
                  size={18}
                  color={colors.destructive}
                />
              </Pressable>
            </View>
          ))
        )}
      </View>

      <Pressable
        onPress={openCreate}
        style={({ pressed }) => [
          styles.addRow,
          { backgroundColor: colors.surfaceSecondary },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Ionicons name="add-circle-outline" size={20} color={colors.text} />
        <Text style={[styles.addLabel, { color: colors.text }]}>Add role</Text>
      </Pressable>

      <RoleEditorModal
        visible={editorVisible}
        role={editing}
        busy={busy}
        onClose={() => {
          setEditorVisible(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />
    </View>
  );
}

/** Add / edit modal for a single role. */
function RoleEditorModal({
  visible,
  role,
  busy,
  onClose,
  onSave,
}: {
  visible: boolean;
  role: Role | null;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, color: string, defaultNeeded: number) => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState("");
  const [color, setColor] = useState(ROLE_COLORS[0]);
  const [count, setCount] = useState("1");

  // Reset form whenever the modal opens for a different role.
  React.useEffect(() => {
    if (visible) {
      setName(role?.name ?? "");
      setColor(role?.color ?? ROLE_COLORS[0]);
      setCount(String(role?.defaultNeeded ?? 1));
    }
  }, [visible, role]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsed = parseInt(count, 10);
    onSave(trimmed, color, Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
  };

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      title={role ? "Edit role" : "Add role"}
    >
      <View>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          Name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Drums"
          placeholderTextColor={colors.textSecondary}
          autoFocus
          maxLength={60}
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
            },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          Color
        </Text>
        <View style={styles.swatchRow}>
          {ROLE_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={[
                styles.swatchOption,
                { backgroundColor: c },
                color === c && styles.swatchSelected,
              ]}
            >
              {color === c && (
                <Ionicons name="checkmark" size={16} color="#fff" />
              )}
            </Pressable>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          Usually need
        </Text>
        <TextInput
          value={count}
          onChangeText={setCount}
          keyboardType="number-pad"
          maxLength={2}
          style={[
            styles.input,
            styles.countInput,
            {
              color: colors.text,
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
            },
          ]}
        />

        <View style={styles.modalButtons}>
          <Pressable
            onPress={onClose}
            disabled={busy}
            style={[
              styles.modalBtn,
              { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <Text style={[styles.modalBtnText, { color: colors.text }]}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={busy || !name.trim()}
            style={[
              styles.modalBtn,
              { backgroundColor: colors.buttonPrimary },
              (busy || !name.trim()) && { opacity: 0.6 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={[styles.modalBtnText, { color: colors.textInverse }]}>
                Save
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  loading: {
    paddingVertical: 24,
    alignItems: "center",
  },
  group: {
    borderRadius: 12,
    overflow: "hidden",
  },
  emptyText: {
    fontSize: 14,
    padding: 16,
    lineHeight: 20,
  },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  roleTextWrap: {
    flex: 1,
  },
  roleName: {
    fontSize: 16,
    fontWeight: "500",
  },
  roleMeta: {
    fontSize: 12,
    marginTop: 2,
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
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 44,
  },
  countInput: {
    width: 80,
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  swatchOption: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: "#fff",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 22,
  },
  modalBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
