/**
 * ResourceSectionEditor - Inline editor for resource sections
 *
 * Displays a section in collapsed view, expands on tap for editing.
 * Features:
 * - Title, description, and link URL editing
 * - Multi-image upload with horizontal scroll thumbnails
 * - Link preview when URL is entered
 * - Save/Cancel/Delete actions
 */
import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useMutation } from "convex/react";
import { api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLinkPreview } from "@features/chat/hooks/useLinkPreview";
import { LinkPreviewCard } from "@features/chat/components/LinkPreviewCard";
import { useImageUpload } from "@features/chat/hooks/useImageUpload";
import { AppImage } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";

// ============================================================================
// Types
// ============================================================================

interface Section {
  id: string;
  title: string;
  description?: string;
  imageUrls?: string[];
  linkUrl?: string;
  order: number;
}

interface ResourceSectionEditorProps {
  section: Section;
  resourceId: Id<"groupResources">;
  token: string;
}

// ============================================================================
// Component
// ============================================================================

export function ResourceSectionEditor({
  section,
  resourceId,
  token,
}: ResourceSectionEditorProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const themeColor = primaryColor || DEFAULT_PRIMARY_COLOR;

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [description, setDescription] = useState(section.description || "");
  const [imageUrls, setImageUrls] = useState<string[]>(
    section.imageUrls || []
  );
  const [localImageUris, setLocalImageUris] = useState<string[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [linkUrl, setLinkUrl] = useState(section.linkUrl || "");
  const [saving, setSaving] = useState(false);

  // Track upload cancellation so in-flight uploads don't modify state after cancel
  const uploadCancelledRef = useRef(false);

  // Image upload
  const { uploadImage } = useImageUpload();

  // Link preview - only fetch when editing and URL is present
  const { preview, loading: previewLoading } = useLinkPreview(
    isEditing && linkUrl ? linkUrl : null
  );

  // Mutations
  const updateMutation = useMutation(
    api.functions.groupResources.index.updateSection
  );
  const deleteMutation = useMutation(
    api.functions.groupResources.index.deleteSection
  );

  // Reset form to current section values
  const resetForm = useCallback(() => {
    // Cancel any in-flight uploads so their callbacks are ignored
    uploadCancelledRef.current = true;
    setTitle(section.title);
    setDescription(section.description || "");
    setImageUrls(section.imageUrls || []);
    setLocalImageUris([]);
    setUploadingCount(0);
    setLinkUrl(section.linkUrl || "");
  }, [section]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    resetForm();
    setIsEditing(false);
  }, [resetForm]);

  // Handle pick images (multi-select)
  const handlePickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    // Allow uploads to modify state (reset cancellation flag)
    uploadCancelledRef.current = false;

    const newUris = result.assets.map((asset) => asset.uri);
    setLocalImageUris((prev) => [...prev, ...newUris]);
    setUploadingCount((prev) => prev + newUris.length);

    // Upload all images in parallel
    const uploadResults = await Promise.all(
      newUris.map((uri) => uploadImage(uri))
    );

    // If editing was cancelled while uploads were in flight, discard results
    if (uploadCancelledRef.current) return;

    const successfulUrls: string[] = [];
    const failedUris: string[] = [];

    uploadResults.forEach((res, i) => {
      if (res.error) {
        failedUris.push(newUris[i]);
      } else {
        successfulUrls.push(res.url);
      }
    });

    if (failedUris.length > 0) {
      Alert.alert(
        "Upload Failed",
        `${failedUris.length} image(s) failed to upload`
      );
      // Remove failed local URIs
      setLocalImageUris((prev) =>
        prev.filter((uri) => !failedUris.includes(uri))
      );
    }

    setImageUrls((prev) => [...prev, ...successfulUrls]);
    // Remove uploaded local URIs (they're now in imageUrls)
    setLocalImageUris((prev) =>
      prev.filter((uri) => !newUris.includes(uri))
    );
    setUploadingCount((prev) => prev - newUris.length);
  }, [uploadImage]);

  // Handle remove image by index
  const handleRemoveImage = useCallback((index: number) => {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert("Error", "Section title is required");
      return;
    }

    setSaving(true);

    try {
      // Filter out empty strings from imageUrls
      const cleanedImageUrls = imageUrls.filter((url) => url.trim());

      await updateMutation({
        resourceId,
        sectionId: section.id,
        title: title.trim(),
        description: description.trim(),
        imageUrls: cleanedImageUrls.length > 0 ? cleanedImageUrls : [],
        linkUrl: linkUrl.trim(),
        token,
      });
      setIsEditing(false);
    } catch (error) {
      console.error("[ResourceSectionEditor] Save failed:", error);
      Alert.alert("Error", "Failed to save section");
    } finally {
      setSaving(false);
    }
  }, [
    resourceId,
    section.id,
    title,
    description,
    imageUrls,
    linkUrl,
    token,
    updateMutation,
  ]);

  // Handle delete
  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Section",
      "Are you sure you want to delete this section?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation({
                resourceId,
                sectionId: section.id,
                token,
              });
            } catch (error) {
              console.error("[ResourceSectionEditor] Delete failed:", error);
              Alert.alert("Error", "Failed to delete section");
            }
          },
        },
      ]
    );
  }, [resourceId, section.id, token, deleteMutation]);

  // Collapsed view
  if (!isEditing) {
    return (
      <Pressable style={[styles.section, { backgroundColor: colors.surfaceSecondary }]} onPress={() => setIsEditing(true)}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]} numberOfLines={1}>
            {section.title}
          </Text>
          <Ionicons name="pencil" size={16} color={colors.textSecondary} />
        </View>
        {section.description && (
          <Text style={[styles.sectionPreview, { color: colors.textSecondary }]} numberOfLines={2}>
            {section.description}
          </Text>
        )}
        {section.imageUrls?.[0] && (
          <AppImage
            source={section.imageUrls[0]}
            style={styles.collapsedThumbnail}
          />
        )}
        {section.linkUrl && (
          <Text style={[styles.sectionLink, { color: colors.link }]} numberOfLines={1}>
            {section.linkUrl}
          </Text>
        )}
      </Pressable>
    );
  }

  // All display images: uploaded URLs + local previews being uploaded
  const allDisplayImages = [
    ...imageUrls.map((url) => ({ type: "uploaded" as const, uri: url })),
    ...localImageUris.map((uri) => ({
      type: "uploading" as const,
      uri,
    })),
  ];

  // Expanded editing view
  return (
    <View style={[styles.sectionEditing, { borderColor: themeColor, backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Title</Text>
      <TextInput
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBackground, color: colors.text }]}
        value={title}
        onChangeText={setTitle}
        placeholder="Section title"
        placeholderTextColor={colors.textTertiary}
      />

      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description (optional)</Text>
      <TextInput
        style={[styles.input, styles.multilineInput, { borderColor: colors.border, backgroundColor: colors.inputBackground, color: colors.text }]}
        value={description}
        onChangeText={setDescription}
        placeholder="Add a description..."
        placeholderTextColor={colors.textTertiary}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />

      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Photos (optional)</Text>
      {allDisplayImages.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.imageScrollContainer}
          contentContainerStyle={styles.imageScrollContent}
        >
          {allDisplayImages.map((img, index) => (
            <View key={`${img.type}-${index}`} style={styles.thumbnailWrapper}>
              <AppImage source={img.uri} style={styles.thumbnail} />
              {img.type === "uploaded" && (
                <Pressable
                  style={[styles.thumbnailRemoveButton, { backgroundColor: colors.surface }]}
                  onPress={() => handleRemoveImage(index)}
                >
                  <Ionicons name="close-circle" size={22} color={colors.destructive} />
                </Pressable>
              )}
              {img.type === "uploading" && (
                <View style={styles.thumbnailUploadingOverlay}>
                  <ActivityIndicator size="small" color={colors.textInverse} />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      <Pressable style={[styles.addPhotoButton, { borderColor: colors.border, backgroundColor: colors.inputBackground }]} onPress={handlePickImages}>
        <Ionicons name="camera-outline" size={24} color={colors.textTertiary} />
        <Text style={[styles.addPhotoText, { color: colors.textTertiary }]}>
          {allDisplayImages.length > 0 ? "Add More Photos" : "Add Photos"}
        </Text>
      </Pressable>

      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Link URL (optional)</Text>
      <TextInput
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBackground, color: colors.text }]}
        value={linkUrl}
        onChangeText={setLinkUrl}
        placeholder="https://..."
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      {/* Link preview */}
      {linkUrl.trim() && (
        <View style={styles.previewContainer}>
          <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>Preview:</Text>
          {previewLoading ? (
            <View style={[styles.previewLoading, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <ActivityIndicator size="small" color={themeColor} />
              <Text style={[styles.previewLoadingText, { color: colors.textSecondary }]}>Loading preview...</Text>
            </View>
          ) : preview ? (
            <LinkPreviewCard preview={preview} embedded compact />
          ) : (
            <Text style={[styles.noPreview, { color: colors.textTertiary, backgroundColor: colors.surface, borderColor: colors.border }]}>No preview available</Text>
          )}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.buttonRow}>
        <Pressable style={styles.cancelButton} onPress={handleCancel}>
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.deleteSmallButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={20} color={colors.destructive} />
        </Pressable>
        <Pressable
          style={[
            styles.saveSmallButton,
            { backgroundColor: themeColor },
            (saving || uploadingCount > 0) && styles.buttonDisabled,
          ]}
          onPress={handleSave}
          disabled={saving || uploadingCount > 0}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.saveSmallText}>Save</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  section: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  sectionPreview: {
    fontSize: 14,
    marginTop: 4,
  },
  sectionLink: {
    fontSize: 12,
    marginTop: 4,
  },
  collapsedThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginTop: 8,
  },
  sectionEditing: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 2,
  },
  fieldLabel: {
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
    fontWeight: "500",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  imageScrollContainer: {
    marginBottom: 8,
  },
  imageScrollContent: {
    gap: 8,
    paddingVertical: 4,
  },
  thumbnailWrapper: {
    position: "relative",
    width: 100,
    height: 100,
  },
  thumbnail: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  thumbnailRemoveButton: {
    position: "absolute",
    top: -6,
    right: -6,
    borderRadius: 11,
  },
  thumbnailUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 8,
  },
  addPhotoText: {
    fontSize: 15,
  },
  previewContainer: {
    marginTop: 12,
  },
  previewLabel: {
    fontSize: 12,
    marginBottom: 8,
    fontWeight: "500",
  },
  previewLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  previewLoadingText: {
    fontSize: 14,
  },
  noPreview: {
    fontStyle: "italic",
    fontSize: 14,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  cancelButton: {
    padding: 10,
  },
  cancelText: {
    fontSize: 15,
  },
  deleteSmallButton: {
    padding: 10,
  },
  saveSmallButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 60,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  saveSmallText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
