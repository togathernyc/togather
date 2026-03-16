import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { CustomModal } from "@/components/ui/Modal";

// ============================================================================
// Types
// ============================================================================

interface SaveViewModalProps {
  visible: boolean;
  onClose: () => void;
  communityId: Id<"communities">;
  // Current table state to capture
  currentSortBy?: string;
  currentSortDirection?: "asc" | "desc";
  currentColumnOrder?: string[];
  currentHiddenColumns?: string[];
  currentFilters?: {
    groupId?: Id<"groups">;
    statusFilter?: string;
    assigneeFilter?: string;
    scoreField?: string;
    scoreMin?: number;
    scoreMax?: number;
  };
  // Edit mode (if editing existing view)
  editingView?: {
    _id: Id<"peopleSavedViews">;
    name: string;
    visibility: "personal" | "shared";
  } | null;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_VIEW_NAME_LENGTH = 30;

// ============================================================================
// Component
// ============================================================================

export function SaveViewModal({
  visible,
  onClose,
  communityId,
  currentSortBy,
  currentSortDirection,
  currentColumnOrder,
  currentHiddenColumns,
  currentFilters,
  editingView,
}: SaveViewModalProps) {
  const { primaryColor } = useCommunityTheme();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"personal" | "shared">("personal");
  const [isSaving, setIsSaving] = useState(false);

  const createView = useAuthenticatedMutation(api.functions.peopleSavedViews.create);
  const updateView = useAuthenticatedMutation(api.functions.peopleSavedViews.update);

  const isEditMode = !!editingView;

  // Reset state when modal opens or editingView changes
  useEffect(() => {
    if (visible) {
      if (editingView) {
        setName(editingView.name);
        setVisibility(editingView.visibility);
      } else {
        setName("");
        setVisibility("personal");
      }
      setIsSaving(false);
    }
  }, [visible, editingView]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      Alert.alert("Error", "View name cannot be empty.");
      return;
    }
    if (trimmedName.length > MAX_VIEW_NAME_LENGTH) {
      Alert.alert(
        "Error",
        `View name must be ${MAX_VIEW_NAME_LENGTH} characters or fewer.`,
      );
      return;
    }

    setIsSaving(true);

    try {
      if (isEditMode && editingView) {
        await updateView({
          viewId: editingView._id,
          name: trimmedName,
          visibility,
        });
      } else {
        await createView({
          communityId,
          name: trimmedName,
          visibility,
          sortBy: currentSortBy,
          sortDirection: currentSortDirection,
          columnOrder: currentColumnOrder,
          hiddenColumns: currentHiddenColumns,
          filters: currentFilters,
        });
      }
      onClose();
    } catch (error: any) {
      const message =
        error?.data?.message ?? error?.message ?? "Failed to save view.";
      Alert.alert("Error", message);
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = name.trim().length > 0 && !isSaving;
  const charCount = name.length;

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      title={isEditMode ? "Edit View" : "Save View"}
      width={420}
    >
      <View style={styles.container}>
        {/* View name input */}
        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(text) => setName(text.slice(0, MAX_VIEW_NAME_LENGTH))}
            placeholder="e.g. New Members, Active Leaders..."
            placeholderTextColor="#9CA3AF"
            autoFocus
            maxLength={MAX_VIEW_NAME_LENGTH}
          />
          <Text
            style={[
              styles.charCount,
              charCount >= MAX_VIEW_NAME_LENGTH && styles.charCountLimit,
            ]}
          >
            {charCount}/{MAX_VIEW_NAME_LENGTH}
          </Text>
        </View>

        {/* Visibility toggle */}
        <View style={styles.field}>
          <Text style={styles.label}>Who can see this view?</Text>
          <View style={styles.visibilityRow}>
            <TouchableOpacity
              style={[
                styles.visibilityOption,
                visibility === "personal" && {
                  borderColor: primaryColor,
                  backgroundColor: primaryColor + "10",
                },
              ]}
              onPress={() => setVisibility("personal")}
            >
              <Ionicons
                name="person-outline"
                size={16}
                color={visibility === "personal" ? primaryColor : "#6B7280"}
              />
              <Text
                style={[
                  styles.visibilityText,
                  visibility === "personal" && { color: primaryColor, fontWeight: "600" as const },
                ]}
              >
                Just me
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.visibilityOption,
                visibility === "shared" && {
                  borderColor: primaryColor,
                  backgroundColor: primaryColor + "10",
                },
              ]}
              onPress={() => setVisibility("shared")}
            >
              <Ionicons
                name="people-outline"
                size={16}
                color={visibility === "shared" ? primaryColor : "#6B7280"}
              />
              <Text
                style={[
                  styles.visibilityText,
                  visibility === "shared" && { color: primaryColor, fontWeight: "600" as const },
                ]}
              >
                Everyone
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer actions */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.cancelBtn}
            disabled={isSaving}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            style={[
              styles.saveBtn,
              { backgroundColor: primaryColor },
              !canSave && styles.btnDisabled,
            ]}
            disabled={!canSave}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveText}>
                {isEditMode ? "Update" : "Save"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </CustomModal>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#374151",
  },
  input: {
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    color: "#111827",
  },
  charCount: {
    fontSize: 11,
    color: "#9CA3AF",
    textAlign: "right" as const,
  },
  charCountLimit: {
    color: "#EF4444",
  },
  visibilityRow: {
    flexDirection: "row" as const,
    gap: 10,
  },
  visibilityOption: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  visibilityText: {
    fontSize: 14,
    color: "#6B7280",
  },
  footer: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 16,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  cancelText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500" as const,
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center" as const,
  },
  saveText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "600" as const,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
