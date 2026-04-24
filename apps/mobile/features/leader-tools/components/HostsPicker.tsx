/**
 * HostsPicker — multi-select hosts for an event.
 *
 * Empty list is valid and means "delegated to group leaders" on the backend
 * (see `resolveEventAdmins` / `getHostUserIds` in apps/convex/lib/
 * meetingPermissions.ts). When the viewer removes themselves and isn't a
 * leader, we confirm — they'd lose edit rights on save.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api, type Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";

type Props = {
  groupId: Id<"groups"> | null | undefined;
  token: string | null;
  hostUserIds: Id<"users">[];
  onChange: (next: Id<"users">[]) => void;
  currentUserId: Id<"users"> | null | undefined;
  viewerIsLeader: boolean;
  disabled?: boolean;
};

type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  profileImage: string | null;
};

export function HostsPicker({
  groupId,
  token,
  hostUserIds,
  onChange,
  currentUserId,
  viewerIsLeader,
  disabled,
}: Props) {
  const { colors } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Paginated list — 200 is plenty for selection; we don't need to stream.
  const membersData = useQuery(
    api.functions.groupMembers.list,
    groupId && token ? { groupId, limit: 200, token } : "skip",
  );

  const members: MemberRow[] = useMemo(() => {
    const items = membersData?.items ?? [];
    return items
      .filter((item: any) => item.user != null)
      .map((item: any) => ({
        id: String(item.user.id),
        firstName: item.user.firstName ?? "",
        lastName: item.user.lastName ?? "",
        profileImage: item.user.profileImage ?? null,
      }));
  }, [membersData]);

  const membersById = useMemo(() => {
    const map = new Map<string, MemberRow>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const hostIdKeys = useMemo(
    () => new Set(hostUserIds.map((id) => String(id))),
    [hostUserIds],
  );

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) =>
      `${m.firstName} ${m.lastName}`.toLowerCase().includes(needle),
    );
  }, [members, search]);

  const toggleMember = (memberId: string) => {
    const asUserId = memberId as Id<"users">;
    if (hostIdKeys.has(memberId)) {
      confirmAndRemove(asUserId);
    } else {
      onChange([...hostUserIds, asUserId]);
    }
  };

  const confirmAndRemove = (userId: Id<"users">) => {
    const isSelf = currentUserId && String(userId) === String(currentUserId);
    // Removing yourself when you're not a group leader means losing edit
    // permissions on save (canEditMeeting checks host membership OR leader
    // status). Confirm so the user doesn't accidentally lock themselves out.
    if (isSelf && !viewerIsLeader) {
      Alert.alert(
        "Remove yourself as host?",
        "You won't be able to edit this event after saving. Group leaders will manage it instead.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () =>
              onChange(
                hostUserIds.filter((id) => String(id) !== String(userId)),
              ),
          },
        ],
      );
      return;
    }
    onChange(hostUserIds.filter((id) => String(id) !== String(userId)));
  };

  const hostChips = hostUserIds.map((id) => {
    const idStr = String(id);
    const m = membersById.get(idStr);
    const name = m
      ? `${m.firstName} ${m.lastName}`.trim() || "Unknown"
      : "…";
    const isSelf = currentUserId && idStr === String(currentUserId);
    return { id: idStr, label: isSelf ? `${name} (you)` : name };
  });

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>Host{hostUserIds.length === 1 ? "" : "s"}</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {hostUserIds.length === 0
          ? "No host set — group leaders will receive RSVP notifications and manage the event chat."
          : "Hosts receive RSVP notifications and manage the event chat. Group leaders aren't auto-added."}
      </Text>

      <View style={styles.chipsRow}>
        {hostChips.map((chip) => (
          <View
            key={chip.id}
            style={[
              styles.chip,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.chipText, { color: colors.text }]} numberOfLines={1}>
              {chip.label}
            </Text>
            {!disabled && (
              <Pressable
                onPress={() => confirmAndRemove(chip.id as Id<"users">)}
                hitSlop={8}
                style={styles.chipRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove host ${chip.label}`}
              >
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
        ))}
        {!disabled && (
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={[
              styles.addButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add host"
          >
            <Ionicons name="add" size={16} color={colors.text} />
            <Text style={[styles.addButtonText, { color: colors.text }]}>
              {hostUserIds.length === 0 ? "Add host" : "Add"}
            </Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={[styles.modalHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
              <Text style={[styles.modalClose, { color: colors.buttonPrimary }]}>Done</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Hosts</Text>
            <View style={{ width: 48 }} />
          </View>

          <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search members"
              placeholderTextColor={colors.textSecondary}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {membersData === undefined ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : (
            <FlatList
              data={filteredMembers}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = hostIdKeys.has(item.id);
                const name = `${item.firstName} ${item.lastName}`.trim() || "Unknown";
                const isSelf =
                  currentUserId && item.id === String(currentUserId);
                return (
                  <Pressable
                    onPress={() => toggleMember(item.id)}
                    style={[
                      styles.memberRow,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.memberName, { color: colors.text }]}>
                        {isSelf ? `${name} (you)` : name}
                      </Text>
                    </View>
                    {selected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={colors.buttonPrimary}
                      />
                    ) : (
                      <Ionicons
                        name="ellipse-outline"
                        size={22}
                        color={colors.textSecondary}
                      />
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={{ color: colors.textSecondary }}>
                    No members match "{search}"
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 4 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  hint: { fontSize: 12, marginBottom: 10, lineHeight: 16 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
  },
  chipText: { fontSize: 14, marginRight: 6, maxWidth: 180 },
  chipRemove: { padding: 2 },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  addButtonText: { fontSize: 14, fontWeight: "500" },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 16, fontWeight: "600" },
  modalClose: { fontSize: 16 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 2 },
  loading: { paddingVertical: 40, alignItems: "center" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberName: { fontSize: 15 },
  empty: { paddingVertical: 32, alignItems: "center" },
});
