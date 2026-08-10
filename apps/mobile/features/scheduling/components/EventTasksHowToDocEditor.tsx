/**
 * EventTasksHowToDocEditor
 *
 * Full-screen editor for a task's Markdown How-To document (`howToType: "doc"`).
 * Presented as a modal over the Event Tasks grid. Editing uses the shared
 * `MarkdownEditor`; a Preview toggle renders the same source through `Markdown`.
 *
 * Saving hands the current source back to the parent via `onSave`, which wires
 * it to `updateTask({ howToDoc })`. Local draft state means typing stays smooth
 * regardless of the mutation round-trip.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { Markdown, MarkdownEditor } from "@components/ui/Markdown";

export function EventTasksHowToDocEditor({
  visible,
  taskTitle,
  initialDoc,
  onSave,
  onClose,
}: {
  visible: boolean;
  taskTitle: string;
  initialDoc: string;
  onSave: (doc: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(initialDoc);
  const [preview, setPreview] = useState(false);

  // Reseed the draft each time the editor opens for a (possibly different) task.
  React.useEffect(() => {
    if (visible) {
      setDraft(initialDoc);
      setPreview(false);
    }
  }, [visible, initialDoc]);

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            How-To
          </Text>
          <TouchableOpacity onPress={handleSave} hitSlop={12} style={styles.headerBtn}>
            <Text style={[styles.saveText, { color: colors.buttonPrimary }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {taskTitle || "Untitled task"}
        </Text>

        <View style={styles.toggleRow}>
          <ToggleBtn
            label="Write"
            active={!preview}
            onPress={() => setPreview(false)}
            colors={colors}
          />
          <ToggleBtn
            label="Preview"
            active={preview}
            onPress={() => setPreview(true)}
            colors={colors}
          />
        </View>

        {preview ? (
          <ScrollView
            style={styles.body}
            contentContainerStyle={[styles.previewContent, { paddingBottom: insets.bottom + 24 }]}
          >
            {draft.trim().length > 0 ? (
              <Markdown source={draft} />
            ) : (
              <Text style={[styles.emptyPreview, { color: colors.textTertiary }]}>
                Nothing to preview yet.
              </Text>
            )}
          </ScrollView>
        ) : (
          <View style={[styles.body, styles.editorWrap, { borderColor: colors.border }]}>
            <MarkdownEditor value={draft} onChange={setDraft} />
          </View>
        )}
      </View>
    </Modal>
  );
}

function ToggleBtn({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.toggleBtn,
        {
          backgroundColor: active ? colors.buttonPrimary + "1F" : "transparent",
          borderColor: active ? colors.buttonPrimary : colors.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        style={[
          styles.toggleText,
          { color: active ? colors.buttonPrimary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { minWidth: 52, paddingHorizontal: 8, alignItems: "center" },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  saveText: { fontSize: 16, fontWeight: "700" },
  subtitle: { fontSize: 13, paddingHorizontal: 16, paddingTop: 10 },
  toggleRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  toggleText: { fontSize: 13, fontWeight: "600" },
  body: { flex: 1, marginHorizontal: 16, marginBottom: 16 },
  editorWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
  },
  previewContent: { paddingVertical: 4 },
  emptyPreview: { fontSize: 14, fontStyle: "italic" },
});
