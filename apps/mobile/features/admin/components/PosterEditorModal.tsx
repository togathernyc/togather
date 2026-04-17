/**
 * PosterEditorModal — upload a new poster or edit keywords on an existing one.
 *
 * New-poster flow:
 *   1. Pick image from library (or file input on web)
 *   2. Upload to R2 via getR2UploadUrl action
 *   3. Click "Generate keywords" → OpenAI vision returns a list
 *   4. Admin edits the keyword chips
 *   5. Save → creates posters row
 *
 * Edit flow:
 *   - Same keyword editor, pre-filled from existing poster
 *   - No re-upload; image is immutable
 *   - Can soft-delete via "Deactivate"
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  api,
  useAuthenticatedMutation,
  useAuthenticatedAction,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { AppImage } from "@components/ui/AppImage";

// Lazy-require expo-image-picker (mirrors components/ui/ImagePicker.tsx pattern)
let ExpoImagePicker: any = null;
try {
  ExpoImagePicker = require("expo-image-picker");
} catch {
  // Not installed — web file picker fallback kicks in
}

interface Props {
  visible: boolean;
  posterId: Id<"posters"> | null; // null → new upload
  onClose: () => void;
}

export function PosterEditorModal({ visible, posterId, onClose }: Props) {
  const { colors } = useTheme();
  const { token } = useAuth();

  const existing = useQuery(
    api.functions.posters.getById,
    token && posterId ? { token, posterId } : "skip",
  );

  const createPoster = useAuthenticatedMutation(api.functions.posters.create);
  const updatePoster = useAuthenticatedMutation(api.functions.posters.update);
  const removePoster = useAuthenticatedMutation(api.functions.posters.remove);
  const generateKeywords = useAuthenticatedAction(
    api.functions.posters.generateKeywords,
  );
  const getR2UploadUrl = useAuthenticatedAction(
    api.functions.uploads.getR2UploadUrl,
  );

  const [imageUrl, setImageUrl] = useState<string | null>(null); // public URL (post-upload)
  const [imageStorageKey, setImageStorageKey] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null); // file:// during upload
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Reset state on open/close
  useEffect(() => {
    if (!visible) {
      setImageUrl(null);
      setImageStorageKey(null);
      setLocalPreview(null);
      setKeywords([]);
      setKeywordDraft("");
      setIsUploading(false);
      setIsGenerating(false);
      setIsSaving(false);
    }
  }, [visible]);

  // Hydrate from existing poster on edit
  useEffect(() => {
    if (existing && visible) {
      setImageUrl(existing.imageUrl);
      setImageStorageKey(existing.imageStorageKey ?? null);
      setKeywords(existing.keywords);
    }
  }, [existing, visible]);

  const pickAndUpload = useCallback(async () => {
    if (Platform.OS !== "web" && !ExpoImagePicker) {
      Alert.alert("Not available", "expo-image-picker is not installed.");
      return;
    }

    // Pick
    let uri: string | null = null;
    let fileName = "poster.jpg";
    let contentType = "image/jpeg";

    if (Platform.OS === "web") {
      // Web: use a plain file input
      uri = await pickImageOnWeb((n, ct) => {
        fileName = n;
        contentType = ct;
      });
      if (!uri) return;
    } else {
      const perm = await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission needed", "Please allow photo library access.");
        return;
      }
      const result = await ExpoImagePicker.launchImageLibraryAsync({
        mediaTypes: ExpoImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      uri = asset.uri;
      const maybeName = asset.fileName ?? asset.uri.split("/").pop();
      if (maybeName) fileName = maybeName;
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
      contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
    }

    if (!uri) return;

    setLocalPreview(uri);
    setIsUploading(true);
    try {
      const upload = await getR2UploadUrl({
        fileName,
        contentType,
        folder: "posters",
      });

      const response = await fetch(uri);
      const blob = await response.blob();
      const putRes = await fetch(upload.uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) {
        throw new Error(`R2 upload failed: ${putRes.status}`);
      }
      setImageUrl(upload.publicUrl);
      setImageStorageKey(upload.key);
    } catch (err) {
      Alert.alert(
        "Upload failed",
        err instanceof Error ? err.message : "Unknown error",
      );
      setLocalPreview(null);
    } finally {
      setIsUploading(false);
    }
  }, [getR2UploadUrl]);

  const handleGenerate = async () => {
    if (!imageUrl) {
      Alert.alert("Upload an image first");
      return;
    }
    setIsGenerating(true);
    try {
      const res = await generateKeywords({ imageUrl });
      // Merge — append any new ones not already present
      setKeywords((prev) => {
        const merged = [...prev];
        for (const k of res.keywords) {
          if (!merged.includes(k)) merged.push(k);
        }
        return merged;
      });
    } catch (err) {
      Alert.alert(
        "Generation failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const addKeywordFromDraft = () => {
    const k = keywordDraft.trim().toLowerCase();
    if (!k) return;
    if (!keywords.includes(k)) {
      setKeywords([...keywords, k]);
    }
    setKeywordDraft("");
  };

  const removeKeyword = (k: string) => {
    setKeywords(keywords.filter((x) => x !== k));
  };

  const handleSave = async () => {
    if (!posterId && !imageUrl) {
      Alert.alert("Upload an image first");
      return;
    }
    if (keywords.length === 0) {
      Alert.alert("Add at least one keyword");
      return;
    }
    setIsSaving(true);
    try {
      if (posterId) {
        await updatePoster({ posterId, keywords });
      } else {
        await createPoster({
          imageUrl: imageUrl!,
          imageStorageKey: imageStorageKey ?? undefined,
          keywords,
        });
      }
      onClose();
    } catch (err) {
      Alert.alert(
        "Save failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!posterId) return;
    const confirmed = await confirmAsync(
      "Deactivate poster?",
      "It will be hidden from the event-create picker. You can reactivate later.",
    );
    if (!confirmed) return;
    setIsSaving(true);
    try {
      await removePoster({ posterId });
      onClose();
    } catch (err) {
      Alert.alert(
        "Remove failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const previewUrl = imageUrl ?? localPreview;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View
              style={[styles.sheetHeader, { borderBottomColor: colors.border }]}
            >
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {posterId ? "Edit poster" : "New poster"}
              </Text>
              <TouchableOpacity
                onPress={handleSave}
                disabled={isSaving || isUploading}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor:
                      isSaving || isUploading ? colors.border : colors.text,
                  },
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text
                    style={[
                      styles.saveBtnText,
                      { color: colors.background },
                    ]}
                  >
                    Save
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Image slot */}
              <View
                style={[
                  styles.imageSlot,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                ]}
              >
                {previewUrl ? (
                  <AppImage
                    source={previewUrl}
                    style={styles.imagePreview}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons
                    name="image-outline"
                    size={48}
                    color={colors.textSecondary}
                  />
                )}
                {isUploading ? (
                  <View style={styles.uploadOverlay}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.uploadOverlayText}>Uploading…</Text>
                  </View>
                ) : null}
                {!posterId ? (
                  <TouchableOpacity
                    onPress={pickAndUpload}
                    style={[styles.pickBtn, { backgroundColor: colors.text }]}
                  >
                    <Ionicons
                      name={previewUrl ? "refresh" : "cloud-upload-outline"}
                      size={16}
                      color={colors.background}
                    />
                    <Text
                      style={[
                        styles.pickBtnText,
                        { color: colors.background },
                      ]}
                    >
                      {previewUrl ? "Replace" : "Pick image"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Generate keywords */}
              <TouchableOpacity
                onPress={handleGenerate}
                disabled={!imageUrl || isGenerating}
                style={[
                  styles.generateBtn,
                  {
                    backgroundColor: imageUrl ? colors.surfaceSecondary : colors.border,
                    borderColor: colors.border,
                  },
                ]}
              >
                {isGenerating ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Ionicons name="sparkles-outline" size={18} color={colors.text} />
                )}
                <Text style={[styles.generateBtnText, { color: colors.text }]}>
                  {isGenerating ? "Generating…" : "Generate keywords with AI"}
                </Text>
              </TouchableOpacity>

              {/* Keyword chips */}
              <Text style={[styles.sectionLabel, { color: colors.text }]}>
                Keywords
              </Text>
              <View style={styles.chipsWrap}>
                {keywords.map((k) => (
                  <View
                    key={k}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: colors.text }]}>
                      {k}
                    </Text>
                    <TouchableOpacity onPress={() => removeKeyword(k)} hitSlop={8}>
                      <Ionicons name="close" size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
                {keywords.length === 0 ? (
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    No keywords yet. Add your own or generate with AI.
                  </Text>
                ) : null}
              </View>

              {/* Add keyword input */}
              <View
                style={[
                  styles.addKeywordRow,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                ]}
              >
                <TextInput
                  style={[styles.addKeywordInput, { color: colors.text }]}
                  placeholder="Add a keyword…"
                  placeholderTextColor={colors.textSecondary}
                  value={keywordDraft}
                  onChangeText={setKeywordDraft}
                  onSubmitEditing={addKeywordFromDraft}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  onPress={addKeywordFromDraft}
                  disabled={!keywordDraft.trim()}
                  hitSlop={8}
                >
                  <Ionicons
                    name="add-circle"
                    size={24}
                    color={
                      keywordDraft.trim() ? colors.text : colors.textSecondary
                    }
                  />
                </TouchableOpacity>
              </View>

              {posterId ? (
                <TouchableOpacity
                  onPress={handleDeactivate}
                  style={styles.deactivateBtn}
                  disabled={isSaving}
                >
                  <Text style={styles.deactivateBtnText}>Deactivate poster</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

async function pickImageOnWeb(
  onMeta: (fileName: string, contentType: string) => void,
): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      onMeta(file.name, file.type || "image/jpeg");
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

async function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return window.confirm(`${title}\n\n${message}`);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheetWrap: {
    maxHeight: "92%",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
    maxHeight: "100%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 68,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  imageSlot: {
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  imagePreview: {
    width: "100%",
    height: "100%",
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  uploadOverlayText: {
    color: "#fff",
    fontSize: 13,
  },
  pickBtn: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pickBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  generateBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 32,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13,
  },
  addKeywordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addKeywordInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  deactivateBtn: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  deactivateBtnText: {
    color: "#e5484d",
    fontSize: 14,
    fontWeight: "600",
  },
});
