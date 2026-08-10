/**
 * EventTasksHowToCell
 *
 * The "How-To" column of the leader Event Tasks grid — the key column that lets
 * a leader attach guidance to a task. The leader first picks a `howToType`:
 *
 *   - none  → nothing attached.
 *   - text  → a short inline instruction (edited in place).
 *   - link  → a URL (edited in place, opened via the OS on tap).
 *   - media → an image or video. The leader picks from their library (native
 *             `expo-image-picker`) or a file dialog (web `<input type=file>`);
 *             images upload via `useImageUpload`, videos via `useFileUpload`
 *             (its presigned-URL path accepts video content types). Either way
 *             the returned `r2:` storage path is stored in `howToMediaPath` and
 *             previewed as a thumbnail (image) or a compact chip (video).
 *   - doc   → a full Markdown How-To document. Editing opens the full-screen
 *             `EventTasksHowToDocEditor` (rendered by the parent) which saves
 *             back to `howToDoc`.
 *
 * All edits are surfaced through `onPatch`, which the parent wires to
 * `updateTask`. Only the changed fields are sent.
 */
import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Image, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@hooks/useTheme";
import { useImageUpload } from "@features/chat/hooks/useImageUpload";
import { useFileUpload } from "@features/chat/hooks/useFileUpload";
import { getMediaUrl } from "@utils/media";
import { InlineText } from "./InlineText";
import { AnchoredMenu, measureAnchor, type AnchorRect } from "./AnchoredMenu";

/** Extensions we treat as video when deciding how to preview a stored media path. */
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|qt)(\?|$)/i;

/**
 * Cap for inline `text` how-to guidance. Short instructions belong inline; once
 * a leader needs more room they should switch to a `doc` (which the hint nudges
 * toward as they approach the limit).
 */
const HOW_TO_TEXT_MAX = 140;

/** Whether a stored `howToMediaPath` points at a video (vs an image). */
function isVideoPath(path: string): boolean {
  return VIDEO_EXT_RE.test(path);
}

/**
 * Derive a short human label for a stored video path. Uploaded R2 keys look
 * like `chat/<uuidv4>-<original-filename>`, so we strip the leading UUID to
 * surface the original filename; falls back to "Video" when it can't.
 */
function mediaLabelFromPath(path: string): string {
  const segment = (path.split("/").pop() ?? "").trim();
  const withoutUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i.test(segment)
    ? segment.slice(37)
    : segment;
  return withoutUuid || "Video";
}

/**
 * Web-only: open a native file dialog and resolve the picked File (or null if
 * cancelled/none). Mirrors the DOM `<input type=file>` picking pattern used
 * elsewhere for web (react-native-web can't render a raw <input> from JSX).
 */
function pickMediaFileWeb(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    // Off-screen rather than display:none — Safari refuses to open the file
    // dialog for a `display:none` input clicked programmatically, which read as
    // "clicking does nothing". Keep it rendered but invisible.
    input.style.position = "fixed";
    input.style.left = "-10000px";
    input.style.top = "0";
    input.style.opacity = "0";
    input.setAttribute("aria-hidden", "true");
    const cleanup = () => input.remove();
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    };
    // Resolve (and clean up) if the dialog is dismissed without a selection so
    // the hidden input doesn't linger in the DOM.
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

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
  // Anchored dropdown for the type selector — an inline menu would be clipped by
  // the grid card's `overflow: "hidden"`, so it renders in an overlay instead.
  const [typeMenuAnchor, setTypeMenuAnchor] = useState<AnchorRect | null>(null);
  const chipRef = useRef<View>(null);

  const current = HOW_TO_TYPES.find((t) => t.key === howToType) ?? HOW_TO_TYPES[0];
  const openTypeMenu = () => measureAnchor(chipRef.current, setTypeMenuAnchor);

  // Media upload: images go through the R2 image path, videos through the file
  // path (which accepts video content types). Both resolve to an `r2:` storage
  // path stored verbatim in `howToMediaPath`.
  const { uploadImage, uploading: imageUploading, progress: imageProgress } = useImageUpload();
  const { uploadFile, uploading: fileUploading, progress: fileProgress } = useFileUpload();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const mediaUploading = imageUploading || fileUploading;
  const mediaProgress = imageUploading ? imageProgress : fileProgress;

  const pickAndUploadMedia = useCallback(async () => {
    setUploadError(null);
    try {
      // Pick a URI + metadata, then route image vs video to the right uploader.
      let source: { uri: string; name: string; size: number; mimeType: string; isVideo: boolean } | null = null;

      if (Platform.OS === "web") {
        const file = await pickMediaFileWeb();
        if (!file) return;
        source = {
          uri: URL.createObjectURL(file),
          name: file.name || `media-${Date.now()}`,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
          isVideo: file.type.startsWith("video/"),
        };
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images", "videos"],
          quality: 0.8,
        });
        if (result.canceled || !result.assets[0]) return;
        const asset = result.assets[0];
        source = {
          uri: asset.uri,
          name: asset.fileName || `media-${Date.now()}`,
          size: asset.fileSize ?? 0,
          mimeType: asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg"),
          isVideo: asset.type === "video",
        };
      }

      if (source.isVideo) {
        const res = await uploadFile({
          uri: source.uri,
          name: /\.\w+$/.test(source.name) ? source.name : `${source.name}.mp4`,
          size: source.size,
          mimeType: source.mimeType,
        });
        if (res.error) {
          setUploadError(res.error);
          return;
        }
        onPatch({ howToMediaPath: res.storagePath });
      } else {
        const res = await uploadImage(source.uri);
        if (res.error) {
          setUploadError(res.error);
          return;
        }
        onPatch({ howToMediaPath: res.url });
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  }, [onPatch, uploadFile, uploadImage]);

  const menu = typeMenuAnchor ? (
    <AnchoredMenu
      anchor={typeMenuAnchor}
      options={HOW_TO_TYPES.map((t) => ({ id: t.key, name: t.label, icon: t.icon }))}
      selectedId={howToType}
      onSelect={(id) => {
        if (id && id !== howToType) onPatch({ howToType: id as HowToType });
        setTypeMenuAnchor(null);
      }}
      onClose={() => setTypeMenuAnchor(null)}
    />
  ) : null;

  // A small trailing chevron button that (re)opens the type dropdown. Sits on
  // the same line as the value so the cell stays a single compact row.
  const typeChevron = (
    <Pressable
      ref={chipRef}
      onPress={openTypeMenu}
      hitSlop={8}
      style={styles.typeChevron}
      accessibilityRole="button"
      accessibilityLabel={`How-to type: ${current.label}. Tap to change.`}
    >
      <Ionicons
        name={typeMenuAnchor ? "chevron-up" : "chevron-down"}
        size={13}
        color={colors.textTertiary}
      />
    </Pressable>
  );

  // Empty state: one compact "＋ How-To" chip that opens the type menu.
  if (howToType === "none") {
    return (
      <View style={styles.row}>
        <Pressable
          ref={chipRef}
          onPress={openTypeMenu}
          style={styles.addChip}
          accessibilityRole="button"
          accessibilityLabel="Add how-to"
        >
          <Ionicons name="add" size={14} color={colors.textTertiary} />
          <Text style={[styles.addChipText, { color: colors.textTertiary }]}>How-To</Text>
          <Ionicons
            name={typeMenuAnchor ? "chevron-up" : "chevron-down"}
            size={12}
            color={colors.textTertiary}
          />
        </Pressable>
        {menu}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {howToType === "text" ? (
        <View style={styles.textWrap}>
          <InlineText
            value={howToText ?? ""}
            onSave={(t) => onPatch({ howToText: t })}
            placeholder="Short instruction…"
            multiline
            maxLength={HOW_TO_TEXT_MAX}
            accessibilityLabel="How-to text"
            style={[styles.valueInput, { color: colors.text, borderColor: colors.border }]}
          />
          {(howToText?.length ?? 0) >= HOW_TO_TEXT_MAX * 0.8 ? (
            <Text style={[styles.textHint, { color: colors.textTertiary }]}>
              Getting long — consider a Doc instead.
            </Text>
          ) : null}
        </View>
      ) : null}

      {howToType === "link" ? (
        <>
          <InlineText
            value={howToUrl ?? ""}
            onSave={(t) => onPatch({ howToUrl: t.trim() })}
            placeholder="https://…"
            accessibilityLabel="How-to link URL"
            style={[styles.valueInput, { color: colors.text, borderColor: colors.border }]}
          />
          {howToUrl ? (
            <Pressable
              onPress={() => void Linking.openURL(howToUrl).catch(() => {})}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Open link"
              style={styles.linkOpenBtn}
            >
              <Ionicons name="open-outline" size={15} color={colors.buttonPrimary} />
            </Pressable>
          ) : null}
        </>
      ) : null}

      {howToType === "media" ? (
        <View style={styles.mediaWrap}>
          {mediaUploading ? (
            <View style={styles.mediaUploading}>
              <ActivityIndicator size="small" color={colors.buttonPrimary} />
              <Text style={[styles.mediaUploadingText, { color: colors.textTertiary }]}>
                Uploading… {Math.round(mediaProgress)}%
              </Text>
            </View>
          ) : howToMediaPath && howToMediaPath.trim().length > 0 ? (
            <View style={styles.mediaSetRow}>
              {isVideoPath(howToMediaPath) ? (
                <Pressable
                  onPress={() => {
                    const url = getMediaUrl(howToMediaPath);
                    if (url) void Linking.openURL(url).catch(() => {});
                  }}
                  style={[styles.videoChip, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Open video"
                >
                  <Ionicons name="film-outline" size={14} color={colors.buttonPrimary} />
                  <Text style={[styles.videoChipText, { color: colors.text }]} numberOfLines={1}>
                    {mediaLabelFromPath(howToMediaPath)}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={pickAndUploadMedia}
                  accessibilityRole="button"
                  accessibilityLabel="Replace image"
                >
                  <Image source={{ uri: getMediaUrl(howToMediaPath) }} style={styles.mediaThumb} />
                </Pressable>
              )}
              <Pressable
                onPress={pickAndUploadMedia}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Replace media"
              >
                <Text style={[styles.mediaReplaceText, { color: colors.buttonPrimary }]}>Replace</Text>
              </Pressable>
              <Pressable
                onPress={() => onPatch({ howToMediaPath: "" })}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Remove media"
              >
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={pickAndUploadMedia}
              style={[styles.uploadBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Upload media"
            >
              <Ionicons name="cloud-upload-outline" size={14} color={colors.buttonPrimary} />
              <Text style={[styles.uploadBtnText, { color: colors.buttonPrimary }]}>Upload media</Text>
            </Pressable>
          )}
          {uploadError ? (
            <Text style={[styles.mediaError, { color: colors.error }]} numberOfLines={1}>
              {uploadError}
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
          <Ionicons name="document-text-outline" size={14} color={colors.buttonPrimary} />
          <Text style={[styles.docBtnText, { color: colors.buttonPrimary }]} numberOfLines={1}>
            {howToDoc && howToDoc.trim().length > 0 ? "Edit doc" : "Write doc"}
          </Text>
        </Pressable>
      ) : null}

      {typeChevron}
      {menu}
    </View>
  );
}

const styles = StyleSheet.create({
  // Single compact row: value control + trailing type chevron.
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  addChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    alignSelf: "flex-start",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  addChipText: { fontSize: 13, fontWeight: "600" },
  textWrap: { flex: 1, gap: 2 },
  textHint: { fontSize: 11, fontStyle: "italic" },
  valueInput: {
    flex: 1,
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    minHeight: 30,
    textAlignVertical: "top",
  },
  linkOpenBtn: { padding: 3 },
  docBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  docBtnText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  typeChevron: { paddingHorizontal: 2, paddingVertical: 4 },
  // Media control — kept compact so it shares the single row with the chevron.
  mediaWrap: { flex: 1 },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  uploadBtnText: { fontSize: 13, fontWeight: "600" },
  mediaUploading: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  mediaUploadingText: { fontSize: 12 },
  mediaSetRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  mediaThumb: { width: 36, height: 36, borderRadius: 6 },
  videoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  videoChipText: { fontSize: 13, flexShrink: 1 },
  mediaReplaceText: { fontSize: 12, fontWeight: "600" },
  mediaError: { fontSize: 11, marginTop: 2 },
});
