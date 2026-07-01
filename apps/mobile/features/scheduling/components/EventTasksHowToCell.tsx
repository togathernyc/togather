/**
 * EventTasksHowToCell
 *
 * The "How-To" column of the leader Event Tasks grid — the key column that lets
 * a leader attach guidance to a task. The leader first picks a `howToType`:
 *
 *   - none  → nothing attached.
 *   - text  → a short inline instruction (edited in place).
 *   - link  → a URL (edited in place, opened via the OS on tap).
 *   - media → a media reference. We accept an `r2:` storage path typed/pasted
 *             in place (there is no shared scheduling media picker to reuse yet
 *             — see the screen's header comment). The value is stored verbatim
 *             in `howToMediaPath`.
 *   - doc   → a full Markdown How-To document. Editing opens the full-screen
 *             `EventTasksHowToDocEditor` (rendered by the parent) which saves
 *             back to `howToDoc`.
 *
 * All edits are surfaced through `onPatch`, which the parent wires to
 * `updateTask`. Only the changed fields are sent.
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { InlineText } from "./InlineText";

/** The kind of "how to" guidance attached to a task (mirrors the backend). */
export type HowToType = "none" | "text" | "link" | "media" | "doc";

export const HOW_TO_TYPES: Array<{ key: HowToType; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "none", label: "None", icon: "remove-circle-outline" },
  { key: "text", label: "Text", icon: "text-outline" },
  { key: "link", label: "Link", icon: "link-outline" },
  { key: "media", label: "Media", icon: "image-outline" },
  { key: "doc", label: "Doc", icon: "document-text-outline" },
];

/** The subset of task fields this cell reads + patches. */
export type HowToPatch = {
  howToType?: HowToType;
  howToText?: string;
  howToUrl?: string;
  howToMediaPath?: string;
  howToDoc?: string;
};

export function EventTasksHowToCell({
  howToType,
  howToText,
  howToUrl,
  howToMediaPath,
  howToDoc,
  onPatch,
  onOpenDoc,
}: {
  howToType: HowToType;
  howToText?: string;
  howToUrl?: string;
  howToMediaPath?: string;
  howToDoc?: string;
  onPatch: (patch: HowToPatch) => void;
  /** Open the full-screen Markdown editor for the `doc` type. */
  onOpenDoc: () => void;
}) {
  const { colors } = useTheme();
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);

  const current = HOW_TO_TYPES.find((t) => t.key === howToType) ?? HOW_TO_TYPES[0];

  return (
    <View style={styles.wrap}>
      {/* Type selector — a compact chip that expands to a small inline menu. */}
      <Pressable
        onPress={() => setTypeMenuOpen((v) => !v)}
        style={[styles.typeChip, { borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={`How-to type: ${current.label}. Tap to change.`}
      >
        <Ionicons name={current.icon} size={14} color={colors.textSecondary} />
        <Text style={[styles.typeChipText, { color: colors.textSecondary }]}>
          {current.label}
        </Text>
        <Ionicons
          name={typeMenuOpen ? "chevron-up" : "chevron-down"}
          size={12}
          color={colors.textTertiary}
        />
      </Pressable>

      {typeMenuOpen ? (
        <View style={[styles.typeMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {HOW_TO_TYPES.map((t) => {
            const active = t.key === howToType;
            return (
              <Pressable
                key={t.key}
                onPress={() => {
                  setTypeMenuOpen(false);
                  if (t.key !== howToType) onPatch({ howToType: t.key });
                }}
                style={[styles.typeMenuRow, active && { backgroundColor: colors.surfaceSecondary }]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Ionicons name={t.icon} size={15} color={colors.textSecondary} />
                <Text style={[styles.typeMenuText, { color: colors.text }]}>{t.label}</Text>
                {active ? (
                  <Ionicons name="checkmark" size={15} color={colors.buttonPrimary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Type-specific value editor. */}
      {howToType === "text" ? (
        <InlineText
          value={howToText ?? ""}
          onSave={(t) => onPatch({ howToText: t })}
          placeholder="Short instruction…"
          multiline
          accessibilityLabel="How-to text"
          style={[styles.valueInput, { color: colors.text, borderColor: colors.border }]}
        />
      ) : null}

      {howToType === "link" ? (
        <View style={styles.linkRow}>
          <InlineText
            value={howToUrl ?? ""}
            onSave={(t) => onPatch({ howToUrl: t.trim() })}
            placeholder="https://…"
            accessibilityLabel="How-to link URL"
            style={[styles.valueInput, styles.linkInput, { color: colors.text, borderColor: colors.border }]}
          />
          {howToUrl ? (
            <Pressable
              onPress={() => void Linking.openURL(howToUrl).catch(() => {})}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Open link"
              style={styles.linkOpenBtn}
            >
              <Ionicons name="open-outline" size={16} color={colors.buttonPrimary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {howToType === "media" ? (
        <View>
          <InlineText
            value={howToMediaPath ?? ""}
            onSave={(t) => onPatch({ howToMediaPath: t.trim() })}
            placeholder="r2:path/to/media"
            accessibilityLabel="How-to media reference"
            style={[styles.valueInput, { color: colors.text, borderColor: colors.border }]}
          />
          {howToMediaPath ? (
            <Text style={[styles.mediaHint, { color: colors.textTertiary }]} numberOfLines={1}>
              {howToMediaPath}
            </Text>
          ) : null}
        </View>
      ) : null}

      {howToType === "doc" ? (
        <Pressable
          onPress={onOpenDoc}
          style={[styles.docBtn, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Edit how-to document"
        >
          <Ionicons name="document-text-outline" size={15} color={colors.buttonPrimary} />
          <Text style={[styles.docBtnText, { color: colors.buttonPrimary }]} numberOfLines={1}>
            {howToDoc && howToDoc.trim().length > 0 ? "Edit document" : "Write document"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  typeChipText: { fontSize: 12, fontWeight: "600" },
  typeMenu: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    alignSelf: "flex-start",
    minWidth: 140,
  },
  typeMenuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  typeMenuText: { flex: 1, fontSize: 13, fontWeight: "500" },
  valueInput: {
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    minHeight: 32,
    textAlignVertical: "top",
  },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkInput: { flex: 1 },
  linkOpenBtn: { padding: 4 },
  mediaHint: { fontSize: 11, marginTop: 3 },
  docBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  docBtnText: { fontSize: 13, fontWeight: "600" },
});
