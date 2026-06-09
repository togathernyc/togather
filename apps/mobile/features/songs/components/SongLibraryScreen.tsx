/**
 * SongLibraryScreen (ADR-027)
 *
 * The per-community song library management screen. Lists the community's songs
 * (searchable), and lets leaders / community admins create, edit, and delete
 * songs, upload key-specific charts (reusing the existing R2 document-upload
 * pipeline), and paste a multitracks link.
 *
 * Songs are community-scoped; the screen resolves the community from the active
 * auth context. It is reached from the run sheet's SongPicker ("Manage song
 * library") at `/rostering/[group_id]/songs`. Editing affordances are gated to
 * community admins client-side; the backend enforces the real guard
 * (`requireGroupLeaderOrCommunityAdmin`).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import {
  useFileUpload,
  type SelectedFile,
} from "@features/chat/hooks/useFileUpload";
import type { Song, SongInput } from "../types";

/** One-button error that works on web (Alert.alert is a no-op on web here). */
function notifyError(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Confirm dialog that works on web (Alert.alert is a no-op on web here). */
function confirmDestructive(prompt: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(prompt)) onConfirm();
    return;
  }
  Alert.alert("Are you sure?", prompt, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onConfirm },
  ]);
}

export function SongLibraryScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, community } = useAuth();
  const communityId = community?.id as string | undefined;
  // Community admins manage the library; leaders are also allowed by the
  // backend guard, but `is_admin` is the signal available client-side here.
  const canEdit = !!user?.is_admin;

  const [search, setSearch] = useState("");
  // The song currently open in the editor: `null` = closed, "new" = create.
  const [editing, setEditing] = useState<Song | "new" | null>(null);

  const songs = useAuthenticatedQuery(
    api.functions.scheduling.songs.listSongs,
    communityId
      ? {
          communityId: communityId as Id<"communities">,
          ...(search.trim() ? { search: search.trim() } : {}),
        }
      : "skip",
  ) as Song[] | null | undefined;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const loading = songs === undefined;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Song library</Text>
        <View style={styles.headerBtn} />
      </View>

      {editing ? (
        <SongEditor
          song={editing === "new" ? null : editing}
          communityId={communityId ?? ""}
          onClose={() => setEditing(null)}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 96 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search songs…"
            placeholderTextColor={colors.inputPlaceholder}
            accessibilityLabel="Search songs"
            style={[
              styles.search,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
            ]}
          />

          {canEdit ? (
            <Pressable
              onPress={() => setEditing("new")}
              style={[styles.addRow, { borderColor: primaryColor }]}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={primaryColor} />
              <Text style={[styles.addText, { color: primaryColor }]}>Add song</Text>
            </Pressable>
          ) : null}

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={colors.text} />
            </View>
          ) : (songs ?? []).length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {search.trim()
                ? "No songs match your search."
                : "No songs yet. Add your worship songs here so run sheets can link to them."}
            </Text>
          ) : (
            <View style={styles.list}>
              {(songs ?? []).map((s) => (
                <View
                  key={s._id}
                  style={[
                    styles.songRow,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.songInfo}>
                    <Text style={[styles.songTitle, { color: colors.text }]} numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text style={[styles.songMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {[
                        s.author,
                        s.defaultKey ? `Key ${s.defaultKey}` : null,
                        s.bpm ? `${s.bpm} BPM` : null,
                        s.ccliNumber ? `CCLI ${s.ccliNumber}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No details yet"}
                    </Text>
                    {s.charts && s.charts.length > 0 ? (
                      <Text style={[styles.songCharts, { color: colors.textTertiary }]}>
                        {s.charts.length} chart{s.charts.length === 1 ? "" : "s"}
                      </Text>
                    ) : null}
                  </View>
                  {canEdit ? (
                    <Pressable
                      onPress={() => setEditing(s)}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.editText, { color: primaryColor }]}>Edit</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** Create / edit form for a single song. */
function SongEditor({
  song,
  communityId,
  onClose,
}: {
  song: Song | null;
  communityId: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();

  const createSong = useAuthenticatedMutation(api.functions.scheduling.songs.createSong);
  const updateSong = useAuthenticatedMutation(api.functions.scheduling.songs.updateSong);
  const deleteSong = useAuthenticatedMutation(api.functions.scheduling.songs.deleteSong);
  const attachChart = useAuthenticatedMutation(api.functions.scheduling.songs.attachChart);
  const removeChart = useAuthenticatedMutation(api.functions.scheduling.songs.removeChart);
  const { uploadFile, uploading, isAvailable: uploadAvailable } = useFileUpload();

  const [title, setTitle] = useState(song?.title ?? "");
  const [author, setAuthor] = useState(song?.author ?? "");
  const [ccliNumber, setCcliNumber] = useState(song?.ccliNumber ?? "");
  const [defaultKey, setDefaultKey] = useState(song?.defaultKey ?? "");
  const [bpm, setBpm] = useState(song?.bpm ? String(song.bpm) : "");
  const [meter, setMeter] = useState(song?.meter ?? "");
  const [arrangementName, setArrangementName] = useState(song?.arrangementName ?? "");
  const [structureText, setStructureText] = useState(
    (song?.structure ?? []).join(", "),
  );
  const [multitracksUrl, setMultitracksUrl] = useState(song?.multitracksUrl ?? "");
  const [notes, setNotes] = useState(song?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const buildInput = useCallback((): SongInput => {
    const structure = structureText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      title: title.trim(),
      author: author.trim() || undefined,
      ccliNumber: ccliNumber.trim() || undefined,
      defaultKey: defaultKey.trim() || undefined,
      bpm: bpm.trim() ? parseInt(bpm, 10) || undefined : undefined,
      meter: meter.trim() || undefined,
      arrangementName: arrangementName.trim() || undefined,
      structure: structure.length > 0 ? structure : undefined,
      multitracksUrl: multitracksUrl.trim() || undefined,
      notes: notes.trim() || undefined,
    };
  }, [
    title,
    author,
    ccliNumber,
    defaultKey,
    bpm,
    meter,
    arrangementName,
    structureText,
    multitracksUrl,
    notes,
  ]);

  const handleSave = useCallback(async () => {
    const input = buildInput();
    if (!input.title) {
      notifyError("Title required", "Give the song a title before saving.");
      return;
    }
    setSaving(true);
    try {
      if (song) {
        await updateSong({ songId: song._id as Id<"songs">, patch: input });
      } else {
        await createSong({
          communityId: communityId as Id<"communities">,
          input,
        });
      }
      onClose();
    } catch (e: any) {
      notifyError("Couldn't save", e?.data?.message ?? e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [buildInput, song, updateSong, createSong, communityId, onClose]);

  const handleDelete = useCallback(() => {
    if (!song) return;
    confirmDestructive(`Delete "${song.title}" from the library?`, () => {
      void deleteSong({ songId: song._id as Id<"songs"> })
        .then(onClose)
        .catch((e: any) =>
          notifyError("Couldn't delete", e?.message ?? "Please try again."),
        );
    });
  }, [song, deleteSong, onClose]);

  const handleUploadChart = useCallback(async () => {
    if (!song) return;
    if (!uploadAvailable) {
      notifyError(
        "Update required",
        "Chart uploads require the latest version of the app.",
      );
      return;
    }
    try {
      const DocumentPicker = require("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const file: SelectedFile = {
        uri: asset.uri,
        name: asset.name || "chart",
        size: asset.size || 0,
        mimeType: asset.mimeType || "application/octet-stream",
      };
      const upload = await uploadFile(file);
      if (upload.error || !upload.storagePath) {
        notifyError("Upload failed", upload.error ?? "Please try again.");
        return;
      }
      await attachChart({
        songId: song._id as Id<"songs">,
        chart: {
          label: defaultKey.trim()
            ? `${file.name} (${defaultKey.trim()})`
            : file.name,
          ...(defaultKey.trim() ? { key: defaultKey.trim() } : {}),
          fileKey: upload.storagePath,
          mimeType: file.mimeType,
        },
      });
    } catch (e: any) {
      notifyError("Upload failed", e?.message ?? "Please try again.");
    }
  }, [song, uploadAvailable, uploadFile, attachChart, defaultKey]);

  const handleRemoveChart = useCallback(
    (fileKey: string) => {
      if (!song) return;
      void removeChart({ songId: song._id as Id<"songs">, fileKey }).catch((e: any) =>
        notifyError("Couldn't remove chart", e?.message ?? "Please try again."),
      );
    },
    [song, removeChart],
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 48 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.editorTitle, { color: colors.text }]}>
        {song ? "Edit song" : "New song"}
      </Text>

      <Field label="Title" value={title} onChange={setTitle} colors={colors} />
      <Field label="Author" value={author} onChange={setAuthor} colors={colors} />
      <Field
        label="CCLI number"
        value={ccliNumber}
        onChange={setCcliNumber}
        keyboardType="number-pad"
        colors={colors}
      />
      <Field label="Default key" value={defaultKey} onChange={setDefaultKey} colors={colors} />
      <Field
        label="BPM"
        value={bpm}
        onChange={setBpm}
        keyboardType="number-pad"
        colors={colors}
      />
      <Field label="Meter" value={meter} onChange={setMeter} colors={colors} placeholder="e.g. 4/4" />
      <Field
        label="Arrangement name"
        value={arrangementName}
        onChange={setArrangementName}
        colors={colors}
      />
      <Field
        label="Structure"
        value={structureText}
        onChange={setStructureText}
        colors={colors}
        placeholder="Intro, Verse 1, Chorus, …"
      />
      <Field
        label="Multitracks URL"
        value={multitracksUrl}
        onChange={setMultitracksUrl}
        colors={colors}
        keyboardType="url"
        placeholder="https://…"
      />
      <Field
        label="Notes"
        value={notes}
        onChange={setNotes}
        colors={colors}
        multiline
      />

      {/* Charts — only available once the song exists (attach needs its id). */}
      {song ? (
        <View style={styles.chartsSection}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Charts</Text>
          {(song.charts ?? []).map((c) => (
            <View
              key={c.fileKey}
              style={[styles.chartRow, { borderColor: colors.border }]}
            >
              <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.chartLabel, { color: colors.text }]} numberOfLines={1}>
                {c.label}
              </Text>
              <Pressable
                onPress={() => handleRemoveChart(c.fileKey)}
                hitSlop={8}
                accessibilityLabel={`Remove chart ${c.label}`}
              >
                <Ionicons name="close" size={16} color={colors.textTertiary} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={handleUploadChart}
            disabled={uploading}
            style={[styles.uploadRow, { borderColor: primaryColor }]}
            accessibilityRole="button"
          >
            {uploading ? (
              <ActivityIndicator size="small" color={primaryColor} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={16} color={primaryColor} />
            )}
            <Text style={[styles.uploadText, { color: primaryColor }]}>Upload chart</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          Save the song first to attach charts.
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onClose}
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.primaryBtn, { backgroundColor: primaryColor, opacity: saving ? 0.6 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryBtnText}>Save</Text>
        </Pressable>
      </View>

      {song ? (
        <Pressable onPress={handleDelete} style={styles.deleteRow} accessibilityRole="button">
          <Ionicons name="trash-outline" size={16} color={colors.error ?? "#C4564A"} />
          <Text style={[styles.deleteText, { color: colors.error ?? "#C4564A" }]}>
            Delete song
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  colors,
  keyboardType,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  keyboardType?: React.ComponentProps<typeof TextInput>["keyboardType"];
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={colors.inputPlaceholder}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 36, padding: 4, alignItems: "center" },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  scrollContent: { padding: 16 },
  search: {
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
  },
  addText: { fontSize: 14, fontWeight: "600" },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  list: { marginTop: 12, gap: 8 },
  songRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  songInfo: { flex: 1 },
  songTitle: { fontSize: 15, fontWeight: "600" },
  songMeta: { fontSize: 12, marginTop: 2 },
  songCharts: { fontSize: 11, marginTop: 2 },
  editText: { fontSize: 14, fontWeight: "600" },
  editorTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  field: { marginTop: 10 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  input: {
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: "top" },
  chartsSection: { marginTop: 16 },
  chartRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  chartLabel: { flex: 1, fontSize: 13 },
  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 10,
  },
  uploadText: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12, marginTop: 16, fontStyle: "italic" },
  actions: { flexDirection: "row", gap: 10, marginTop: 24 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "600" },
  primaryBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  deleteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 20,
  },
  deleteText: { fontSize: 14, fontWeight: "600" },
});
