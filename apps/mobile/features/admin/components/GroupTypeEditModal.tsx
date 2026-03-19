/**
 * GroupTypeEditModal - Modal for editing or creating group types
 *
 * Features:
 * - Edit mode: Shows name, description, and warning about affected groups
 * - Create mode: Empty form for new group type
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GroupType } from "../hooks";
import { DEFAULT_PRIMARY_COLOR } from "../../../utils/styles";
import { useTheme } from "@hooks/useTheme";

interface GroupTypeEditModalProps {
  visible: boolean;
  groupType: GroupType | null; // null = create mode
  onClose: () => void;
  onSave: (data: { name: string; description: string }) => Promise<void>;
  isSaving: boolean;
}

export function GroupTypeEditModal({
  visible,
  groupType,
  onClose,
  onSave,
  isSaving,
}: GroupTypeEditModalProps) {
  const { colors } = useTheme();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const isEditMode = !!groupType;
  const hasGroups = groupType && groupType.groupCount > 0;

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setName(groupType?.name || "");
      setDescription(groupType?.description || "");
    }
  }, [visible, groupType]);

  const handleSave = async () => {
    if (!name.trim()) return;
    await onSave({ name: name.trim(), description: description.trim() });
  };

  const isValid = name.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardView}
        >
          <Pressable style={[styles.container, { backgroundColor: colors.surface }]} onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]}>
                {isEditMode ? "Edit Group Type" : "New Group Type"}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Warning for edit mode */}
            {isEditMode && hasGroups && (
              <View style={styles.warningBanner}>
                <Ionicons name="warning" size={20} color="#FF9800" />
                <Text style={styles.warningText}>
                  Changes will affect {groupType.groupCount}{" "}
                  {groupType.groupCount === 1 ? "group" : "groups"} using this type
                </Text>
              </View>
            )}

            {/* Form */}
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Name *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surfaceSecondary, color: colors.text, borderColor: colors.border }]}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g., Small Group, Bible Study"
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.surfaceSecondary, color: colors.text, borderColor: colors.border }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Brief description of this group type..."
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.cancelButton, { backgroundColor: colors.surfaceSecondary }]} onPress={onClose}>
                <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  (!isValid || isSaving) && styles.saveButtonDisabled,
                ]}
                onPress={handleSave}
                disabled={!isValid || isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>
                    {isEditMode ? "Save Changes" : "Create"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  keyboardView: {
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF3E0",
    padding: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: "#E65100",
  },
  form: {
    padding: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 8,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  saveButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
