/**
 * ItemEditorModal
 *
 * Add or edit a single run sheet item (ADR-026): its type, title, duration,
 * description, role-categorized notes, song metadata, and links to the roles
 * rostered on the plan. Used by `RunSheetScreen`.
 *
 * `onSave` receives a normalized `ItemDraft` plus the item id (null when
 * creating); the screen routes it to `createItem` / `updateItem`.
 */
import React, { useMemo, useState } from "react";
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
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR } from "../utils/format";

/** The normalized payload sent to createItem / updateItem. */
export type ItemDraft = {
  type: string;
  title: string;
  durationSec: number;
  description?: string;
  notes: Array<{ category: string; content: string }>;
  songDetails?: { key?: string; bpm?: number; author?: string };
  assignments: Array<{ roleId: Id<"teamRoles"> }>;
};

type EditableItem = {
  _id: Id<"eventItems">;
  type: string;
  title: string;
  description: string | null;
  durationSec: number;
  notes: Array<{ category: string; content: string }>;
  songDetails: { key?: string; bpm?: number; author?: string } | null;
  assignments: Array<{ roleId: Id<"teamRoles"> }>;
};

type RoleOption = {
  roleId: Id<"teamRoles">;
  roleName: string;
  roleColor?: string;
  /** Currently-assigned people on this role (for "Lead Vocal: Sarah" display). */
  people: string[];
};

const TYPES: Array<{ value: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: "item", label: "Item", icon: "ellipse-outline" },
  { value: "song", label: "Song", icon: "musical-notes" },
  { value: "header", label: "Header", icon: "bookmark" },
  { value: "media", label: "Media", icon: "videocam" },
];

export function ItemEditorModal({
  item,
  roleOptions,
  onSave,
  onClose,
}: {
  /** The item to edit, or null to create a new one. */
  item: EditableItem | null;
  roleOptions: RoleOption[];
  onSave: (draft: ItemDraft, itemId: Id<"eventItems"> | null) => Promise<void>;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  const [type, setType] = useState(item?.type ?? "item");
  const [title, setTitle] = useState(item?.title ?? "");
  const [minutes, setMinutes] = useState(
    item ? String(Math.floor(item.durationSec / 60)) : "",
  );
  const [seconds, setSeconds] = useState(
    item && item.durationSec % 60 ? String(item.durationSec % 60) : "",
  );
  const [description, setDescription] = useState(item?.description ?? "");
  const [notes, setNotes] = useState<Array<{ category: string; content: string }>>(
    item?.notes ?? [],
  );
  const [songKey, setSongKey] = useState(item?.songDetails?.key ?? "");
  const [songBpm, setSongBpm] = useState(
    item?.songDetails?.bpm ? String(item.songDetails.bpm) : "",
  );
  const [linkedRoleIds, setLinkedRoleIds] = useState<Set<string>>(
    new Set((item?.assignments ?? []).map((a) => a.roleId as string)),
  );
  const [saving, setSaving] = useState(false);

  const isHeader = type === "header";
  const isSong = type === "song";

  const toggleRole = (roleId: string) => {
    setLinkedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert("Title required", "Give this item a title.");
      return;
    }
    const mins = parseInt(minutes, 10) || 0;
    const secs = parseInt(seconds, 10) || 0;
    const durationSec = isHeader ? 0 : Math.max(0, mins * 60 + secs);

    const songDetails =
      isSong && (songKey.trim() || songBpm.trim())
        ? {
            key: songKey.trim() || undefined,
            bpm: parseInt(songBpm, 10) || undefined,
          }
        : undefined;

    const draft: ItemDraft = {
      type,
      title: trimmed,
      durationSec,
      description: description.trim() || undefined,
      notes: notes
        .map((n) => ({ category: n.category.trim(), content: n.content.trim() }))
        .filter((n) => n.content.length > 0),
      songDetails,
      assignments: [...linkedRoleIds].map((roleId) => ({
        roleId: roleId as Id<"teamRoles">,
      })),
    };

    setSaving(true);
    try {
      await onSave(draft, item?._id ?? null);
      onClose();
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.data?.message ?? e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = useMemo(
    () => [
      styles.input,
      {
        color: colors.text,
        borderColor: colors.inputBorder,
        backgroundColor: colors.inputBackground,
      },
    ],
    [colors],
  );

  return (
    <Modal
      visible
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
            {item ? "Edit item" : "Add item"}
          </Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={12}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={[styles.save, { color: colors.buttonPrimary }]}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          >
            {/* Type selector */}
            <Text style={[styles.label, { color: colors.text }]}>Type</Text>
            <View style={styles.typeRow}>
              {TYPES.map((t) => {
                const selected = t.value === type;
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => setType(t.value)}
                    style={styles.typePressable}
                  >
                    <View
                      style={[
                        styles.typeChip,
                        {
                          backgroundColor: selected
                            ? colors.buttonPrimary
                            : colors.surfaceSecondary,
                        },
                      ]}
                    >
                      <Ionicons
                        name={t.icon}
                        size={14}
                        color={selected ? "#fff" : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.typeChipText,
                          { color: selected ? "#fff" : colors.textSecondary },
                        ]}
                      >
                        {t.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Title */}
            <Text style={[styles.label, { color: colors.text }]}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={isHeader ? "Section name" : "Item title"}
              placeholderTextColor={colors.inputPlaceholder}
              maxLength={120}
              autoFocus={!item}
              style={inputStyle}
            />

            {/* Duration (hidden for headers) */}
            {!isHeader ? (
              <>
                <Text style={[styles.label, { color: colors.text }]}>
                  Duration
                </Text>
                <View style={styles.durationRow}>
                  <TextInput
                    value={minutes}
                    onChangeText={setMinutes}
                    placeholder="0"
                    placeholderTextColor={colors.inputPlaceholder}
                    keyboardType="number-pad"
                    maxLength={3}
                    style={[inputStyle, styles.durationInput]}
                  />
                  <Text style={[styles.durationUnit, { color: colors.textSecondary }]}>
                    min
                  </Text>
                  <TextInput
                    value={seconds}
                    onChangeText={setSeconds}
                    placeholder="0"
                    placeholderTextColor={colors.inputPlaceholder}
                    keyboardType="number-pad"
                    maxLength={2}
                    style={[inputStyle, styles.durationInput]}
                  />
                  <Text style={[styles.durationUnit, { color: colors.textSecondary }]}>
                    sec
                  </Text>
                </View>
              </>
            ) : null}

            {/* Song details */}
            {isSong ? (
              <>
                <Text style={[styles.label, { color: colors.text }]}>
                  Song details
                </Text>
                <View style={styles.durationRow}>
                  <TextInput
                    value={songKey}
                    onChangeText={setSongKey}
                    placeholder="Key (e.g. G)"
                    placeholderTextColor={colors.inputPlaceholder}
                    maxLength={8}
                    style={[inputStyle, styles.flex]}
                  />
                  <TextInput
                    value={songBpm}
                    onChangeText={setSongBpm}
                    placeholder="BPM"
                    placeholderTextColor={colors.inputPlaceholder}
                    keyboardType="number-pad"
                    maxLength={3}
                    style={[inputStyle, styles.flex]}
                  />
                </View>
              </>
            ) : null}

            {/* Description */}
            <Text style={[styles.label, { color: colors.text }]}>
              Description
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Optional details for this moment"
              placeholderTextColor={colors.inputPlaceholder}
              multiline
              style={[inputStyle, styles.multiline]}
            />

            {/* Role links */}
            {roleOptions.length > 0 ? (
              <>
                <Text style={[styles.label, { color: colors.text }]}>
                  Who's involved
                </Text>
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  Link this item to roles on the plan.
                </Text>
                <View style={styles.roleWrap}>
                  {roleOptions.map((r) => {
                    const selected = linkedRoleIds.has(r.roleId as string);
                    const swatch = r.roleColor ?? DEFAULT_ROLE_COLOR;
                    return (
                      <Pressable
                        key={r.roleId}
                        onPress={() => toggleRole(r.roleId as string)}
                        style={styles.rolePressable}
                      >
                        <View
                          style={[
                            styles.roleChip,
                            {
                              backgroundColor: selected
                                ? swatch + "22"
                                : colors.surfaceSecondary,
                              borderColor: selected ? swatch : colors.border,
                            },
                          ]}
                        >
                          <View
                            style={[styles.roleSwatch, { backgroundColor: swatch }]}
                          />
                          <Text
                            style={[styles.roleChipText, { color: colors.text }]}
                            numberOfLines={1}
                          >
                            {r.roleName}
                            {r.people.length > 0 ? `: ${r.people.join(", ")}` : ""}
                          </Text>
                          {selected ? (
                            <Ionicons
                              name="checkmark-circle"
                              size={16}
                              color={swatch}
                            />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {/* Notes */}
            <Text style={[styles.label, { color: colors.text }]}>Notes</Text>
            {notes.map((note, idx) => (
              <View key={idx} style={styles.noteRow}>
                <TextInput
                  value={note.category}
                  onChangeText={(v) =>
                    setNotes((prev) =>
                      prev.map((n, i) => (i === idx ? { ...n, category: v } : n)),
                    )
                  }
                  placeholder="Role"
                  placeholderTextColor={colors.inputPlaceholder}
                  maxLength={30}
                  style={[inputStyle, styles.noteCategory]}
                />
                <TextInput
                  value={note.content}
                  onChangeText={(v) =>
                    setNotes((prev) =>
                      prev.map((n, i) => (i === idx ? { ...n, content: v } : n)),
                    )
                  }
                  placeholder="Cue or instruction"
                  placeholderTextColor={colors.inputPlaceholder}
                  style={[inputStyle, styles.flex]}
                />
                <Pressable
                  onPress={() =>
                    setNotes((prev) => prev.filter((_, i) => i !== idx))
                  }
                  hitSlop={8}
                  style={styles.noteRemove}
                >
                  <Ionicons name="close" size={18} color={colors.textTertiary} />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() =>
                setNotes((prev) => [...prev, { category: "", content: "" }])
              }
              style={styles.addNotePressable}
            >
              <View style={styles.addNoteRow}>
                <Ionicons name="add" size={16} color={colors.buttonPrimary} />
                <Text style={[styles.addNoteText, { color: colors.buttonPrimary }]}>
                  Add a note
                </Text>
              </View>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  cancel: { fontSize: 16 },
  save: { fontSize: 16, fontWeight: "600" },
  scrollContent: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  hint: { fontSize: 12, marginTop: -4, marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typePressable: { borderRadius: 999 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  typeChipText: { fontSize: 14, fontWeight: "600" },
  durationRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  durationInput: { width: 64, textAlign: "center" },
  durationUnit: { fontSize: 14 },
  roleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rolePressable: { borderRadius: 999, maxWidth: "100%" },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleSwatch: { width: 10, height: 10, borderRadius: 5 },
  roleChipText: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  noteCategory: { width: 96 },
  noteRemove: { padding: 4 },
  addNotePressable: { marginTop: 4 },
  addNoteRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  addNoteText: { fontSize: 14, fontWeight: "600" },
});
