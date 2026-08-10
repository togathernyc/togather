/**
 * RunSheetItemEditors
 *
 * The presentational, plan-agnostic building blocks of the run sheet editor —
 * extracted from RunSheetScreen so BOTH the per-plan run sheet
 * (`RunSheetScreen`) and the per-group run-sheet TEMPLATE editor
 * (`RunSheetTemplateEditorScreen`) render identical row/cell UI (ADR-026 /
 * event templates Phase 2).
 *
 * These components read only from a minimal `RunSheetItemLike` shape and write
 * through an `ItemPatch` callback, so they are unaware of whether the row is a
 * plan `eventItems` row or a `runSheetTemplateItems` row. Anything genuinely
 * plan-specific (clock times, service ranges, event roster) stays in the
 * containers.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ActivityIndicator,
  type TextStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR } from "../utils/format";
import { InlineText } from "./InlineText";
import { OptionTag } from "./GridScrollList";
import { measureAnchor, type AnchorRect } from "./AnchoredMenu";
import { SongPicker } from "./SongPicker";
import type { Song } from "@features/songs/types";

/** When an item happens relative to the event's service times. */
export type Segment = "before" | "during" | "after";

export const SEGMENT_OPTIONS: Array<{
  key: Segment;
  label: string;
  short: string;
}> = [
  { key: "before", label: "Before event", short: "Before" },
  { key: "during", label: "During event", short: "During" },
  { key: "after", label: "After event", short: "After" },
];

export type ItemAssignment = {
  roleId: Id<"teamRoles">;
  roleName: string;
  roleColor: string | null;
};

export type RoleOption = {
  roleId: Id<"teamRoles">;
  roleName: string;
  roleColor?: string;
  people: string[];
};

/** Item field patch shape sent to the container's update mutation. */
export type ItemPatch = {
  type?: string;
  title?: string;
  segment?: Segment;
  durationSec?: number;
  description?: string;
  notes?: Array<{ category: string; content: string }>;
  assignments?: Array<{ roleId: Id<"teamRoles"> }>;
  songDetails?: { key?: string; bpm?: number };
  // Link / unlink a library song. `null` clears the link (ADR-027).
  songId?: Id<"songs"> | null;
};

/**
 * The minimal read surface the row editors need. Both `RunSheetItem` (plan) and
 * a mapped `runSheetTemplateItems` row satisfy this structurally.
 */
export type RunSheetItemLike = {
  segment: string;
  description: string | null;
  durationSec: number;
  notes: Array<{ category: string; content: string }>;
  songDetails: { key?: string; bpm?: number; author?: string } | null;
  songId: Id<"songs"> | null;
  song: Song | null;
  assignments: ItemAssignment[];
};

/**
 * The "When" phase pill. Measures its own window rect on press so the parent can
 * anchor the dropdown next to it (the pill can't hold the menu itself — the
 * table card clips overflow).
 */
export function WhenPill({
  label,
  colors,
  primaryColor,
  onOpen,
}: {
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onOpen: (anchor: AnchorRect) => void;
}) {
  const ref = React.useRef<View>(null);
  return (
    <Pressable
      ref={ref}
      onPress={() => measureAnchor(ref.current, onOpen)}
      style={styles.tagPressable}
      accessibilityRole="button"
      accessibilityLabel={`When: ${label}. Tap to change.`}
    >
      <OptionTag
        label={label}
        colors={colors}
        primaryColor={primaryColor}
        tinted
        chevron
      />
    </Pressable>
  );
}

export function AddButton({
  label,
  icon,
  onPress,
  primaryColor,
  colors,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  primaryColor: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <Pressable onPress={onPress} style={styles.addPressable}>
      <View style={[styles.addRow, { borderColor: colors.border }]}>
        <Ionicons name={icon} size={18} color={primaryColor} />
        <Text style={[styles.addText, { color: primaryColor }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

// Monospace + tabular figures give the numeric run-sheet cells a "broadcast
// rundown" feel (aligned digits). The repo already uses this Menlo/monospace
// Platform.select idiom elsewhere.
const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

// RN-Web draws a browser focus ring on the underlying <input> that visually
// bleeds past this tiny cell; suppress it so the input stays fully contained.
const webNoOutline: TextStyle | undefined =
  Platform.OS === "web"
    ? ({ outlineStyle: "none" } as unknown as TextStyle)
    : undefined;

/** Inline m:ss duration cell. Parses "5", "5:30", or "330s"-style minute input. */
export function DurationCell({
  durationSec,
  onSave,
  colors,
}: {
  durationSec: number;
  onSave: (sec: number) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const mm = Math.floor(durationSec / 60);
  const ss = durationSec % 60;
  const display = `${mm}:${String(ss).padStart(2, "0")}`;
  return (
    <InlineText
      value={display}
      onSave={(text) => onSave(parseDuration(text))}
      placeholder="0:00"
      keyboardType="numbers-and-punctuation"
      maxLength={6}
      accessibilityLabel="Duration (minutes:seconds)"
      borderless
      style={[styles.durationInput, { color: colors.text }, webNoOutline]}
    />
  );
}

/** Parse "m:ss" or plain minutes into seconds. */
export function parseDuration(text: string): number {
  const trimmed = text.trim();
  if (trimmed.includes(":")) {
    const [m, s] = trimmed.split(":");
    return Math.max(0, (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0));
  }
  return Math.max(0, Math.round((parseFloat(trimmed) || 0) * 60));
}

/**
 * Who's-involved editor body (roles multi-select).
 *
 * Seeds a local Set from the item's current assignments so rapid toggles
 * compound instead of each restarting from the last server-synced value (which
 * lags a mutation round-trip). Remounted per item via a `key` at the call site,
 * so it re-seeds whenever a different row's modal opens.
 */
export function WhoModalBody({
  item,
  roleOptions,
  onPatch,
  emptyStateText = "No roles are defined yet.",
  loading = false,
}: {
  item: RunSheetItemLike;
  roleOptions: RoleOption[];
  onPatch: (patch: ItemPatch) => void;
  /** Message shown when there are no roles to pick — worded per surface. */
  emptyStateText?: string;
  /** While the role sources are still loading, show a spinner instead of the
   *  empty message so it doesn't flash "no roles" before they resolve. */
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const [linked, setLinked] = useState<Set<string>>(
    () => new Set(item.assignments.map((a) => a.roleId as string)),
  );

  const toggle = (roleId: string) => {
    const next = new Set(linked);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    setLinked(next);
    onPatch({
      assignments: [...next].map((id) => ({ roleId: id as Id<"teamRoles"> })),
    });
  };

  if (roleOptions.length === 0) {
    if (loading) {
      return (
        <View style={styles.rolesLoading}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      );
    }
    return (
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        {emptyStateText}
      </Text>
    );
  }

  return (
    <View style={styles.roleWrap}>
      {roleOptions.map((r) => {
        const selected = linked.has(r.roleId as string);
        const swatch = r.roleColor ?? DEFAULT_ROLE_COLOR;
        return (
          <Pressable
            key={r.roleId}
            onPress={() => toggle(r.roleId as string)}
            style={styles.rolePressable}
          >
            <View
              style={[
                styles.roleChip,
                {
                  backgroundColor: selected ? swatch + "22" : colors.surface,
                  borderColor: selected ? swatch : colors.border,
                },
              ]}
            >
              <View style={[styles.roleSwatch, { backgroundColor: swatch }]} />
              <Text
                style={[styles.roleChipText, { color: colors.text }]}
                numberOfLines={1}
              >
                {r.roleName}
                {r.people.length > 0 ? `: ${r.people.join(", ")}` : ""}
              </Text>
              {selected ? (
                <Ionicons name="checkmark-circle" size={15} color={swatch} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Notes editor body — the item's timing phase, free-text description, and the
 * role-categorized cue notes.
 */
export function NotesModalBody({
  item,
  onPatch,
}: {
  item: RunSheetItemLike;
  onPatch: (patch: ItemPatch) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.modalStack}>
      {/* Timing phase — before / during / after the event (PCO's position). */}
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        Timing
      </Text>
      <View style={styles.timingToggle}>
        {SEGMENT_OPTIONS.map((seg) => {
          const active = (item.segment as Segment) === seg.key;
          return (
            <Pressable
              key={seg.key}
              onPress={() => onPatch({ segment: seg.key })}
              style={styles.timingPressable}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View
                style={[
                  styles.timingChip,
                  {
                    borderColor: active ? colors.buttonPrimary : colors.border,
                    backgroundColor: active
                      ? colors.buttonPrimary + "1F"
                      : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.timingChipText,
                    {
                      color: active
                        ? colors.buttonPrimary
                        : colors.textSecondary,
                    },
                  ]}
                >
                  {seg.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        Description
      </Text>
      <InlineText
        value={item.description ?? ""}
        onSave={(d) => onPatch({ description: d })}
        placeholder="Optional details for this moment"
        multiline
        accessibilityLabel="Item description"
        style={[
          styles.descInput,
          { color: colors.text, borderColor: colors.border },
        ]}
      />

      <NotesEditor
        notes={item.notes}
        onChange={(notes) => onPatch({ notes })}
        colors={colors}
      />
    </View>
  );
}

/**
 * Song editor body — links the row to a library song (ADR-027) and edits the
 * per-service Key / BPM overrides. When a song is linked, Key/BPM show only the
 * override (blank if none), placeholder is the song's default.
 */
export function SongModalBody({
  item,
  communityId,
  groupId,
  onPatch,
}: {
  item: RunSheetItemLike;
  communityId: string;
  groupId: string;
  onPatch: (patch: ItemPatch) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.modalStack}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        Song
      </Text>
      <SongPicker
        communityId={communityId}
        groupId={groupId}
        songId={item.songId}
        song={item.song}
        onSelect={(songId) => onPatch({ songId: songId as Id<"songs"> | null })}
      />

      <View style={styles.songRow}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          Key
        </Text>
        <InlineText
          value={item.songDetails?.key ?? ""}
          onSave={(key) =>
            onPatch({
              songDetails: {
                key: key.trim() || undefined,
                bpm: item.songDetails?.bpm,
              },
            })
          }
          placeholder={item.song?.defaultKey ?? "—"}
          maxLength={8}
          accessibilityLabel="Song key"
          style={[
            styles.songInput,
            { color: colors.text, borderColor: colors.border },
          ]}
        />
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          BPM
        </Text>
        <InlineText
          value={item.songDetails?.bpm ? String(item.songDetails.bpm) : ""}
          onSave={(bpm) =>
            onPatch({
              songDetails: {
                key: item.songDetails?.key,
                bpm: parseInt(bpm, 10) || undefined,
              },
            })
          }
          placeholder={item.song?.bpm ? String(item.song.bpm) : "—"}
          keyboardType="number-pad"
          maxLength={3}
          accessibilityLabel="Song BPM"
          style={[
            styles.songInput,
            { color: colors.text, borderColor: colors.border },
          ]}
        />
      </View>
    </View>
  );
}

/** Inline role-categorized notes editor. */
export function NotesEditor({
  notes,
  onChange,
  colors,
}: {
  notes: Array<{ category: string; content: string }>;
  onChange: (notes: Array<{ category: string; content: string }>) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const setNote = (
    idx: number,
    patch: Partial<{ category: string; content: string }>,
  ) => onChange(notes.map((n, i) => (i === idx ? { ...n, ...patch } : n)));
  const removeNote = (idx: number) =>
    onChange(notes.filter((_, i) => i !== idx));

  return (
    <>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        Notes
      </Text>
      {notes.map((note, idx) => (
        <View key={idx} style={styles.noteRow}>
          <InlineText
            value={note.category}
            onSave={(v) => setNote(idx, { category: v })}
            placeholder="Role"
            maxLength={30}
            accessibilityLabel="Note role"
            style={[
              styles.noteCategory,
              { color: colors.text, borderColor: colors.border },
            ]}
          />
          <InlineText
            value={note.content}
            onSave={(v) => setNote(idx, { content: v })}
            placeholder="Cue or instruction"
            accessibilityLabel="Note content"
            style={[
              styles.noteContent,
              { color: colors.text, borderColor: colors.border },
            ]}
          />
          <Pressable
            onPress={() => removeNote(idx)}
            hitSlop={8}
            style={styles.actionBtn}
            accessibilityLabel="Remove note"
          >
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() => onChange([...notes, { category: "", content: "" }])}
        style={styles.addNotePressable}
      >
        <View style={styles.addNoteRow}>
          <Ionicons name="add" size={16} color={colors.buttonPrimary} />
          <Text style={[styles.addNoteText, { color: colors.buttonPrimary }]}>
            Add a note
          </Text>
        </View>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  rolesLoading: { paddingVertical: 24, alignItems: "center" },
  timingToggle: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  timingPressable: { borderRadius: 999 },
  timingChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  timingChipText: { fontSize: 12, fontWeight: "600" },
  // Reads as plain text at rest (InlineText `borderless` supplies the border /
  // fill on focus); monospace + tabular figures keep durations digit-aligned.
  durationInput: {
    width: 60,
    alignSelf: "center",
    fontSize: 13,
    textAlign: "center",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontFamily: MONO_FONT,
    fontVariant: ["tabular-nums"],
  },
  actionBtn: { padding: 4 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  songRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  songInput: {
    minWidth: 52,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  descInput: {
    fontSize: 14,
    minHeight: 40,
    textAlignVertical: "top",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  roleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rolePressable: { borderRadius: 999, maxWidth: "100%" },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleSwatch: { width: 9, height: 9, borderRadius: 5 },
  roleChipText: { fontSize: 12, fontWeight: "500", flexShrink: 1 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  noteCategory: {
    width: 88,
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  noteContent: {
    flex: 1,
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  addNotePressable: { marginTop: 6 },
  addNoteRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  addNoteText: { fontSize: 13, fontWeight: "600" },
  addPressable: { flexGrow: 1, borderRadius: 12 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  addText: { fontSize: 14, fontWeight: "600" },
  modalStack: { gap: 4 },
  tagPressable: { alignSelf: "flex-start", maxWidth: "100%" },
});
