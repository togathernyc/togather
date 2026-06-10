/**
 * SongPicker (ADR-027)
 *
 * Mounted in the run sheet song-item editor (RunSheetScreen). Lets a scheduler
 * link a run sheet song row to a library `Song`:
 *  - search the community library by title / author / CCLI#
 *  - tap a result to link it (calls `onSelect(songId)` → updateItem)
 *  - "Create" a new song inline from the typed query, then link it
 *  - "Clear" to unlink (`onSelect(null)`)
 *  - "Manage song library" jumps to the full library screen
 *
 * The picker stays presentational about the item itself — it owns library
 * search + create, but delegates the actual `updateItem({ songId })` write to
 * `onSelect` so RunSheetScreen keeps a single mutation wiring point.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { Song } from "@features/songs/types";
import { notify } from "@/utils/platformAlert";

export interface SongPickerProps {
  /** Community the song library belongs to. */
  communityId: string;
  /** Group context, used to route to the library screen. */
  groupId: string;
  /** Currently linked song id, if any. */
  songId: string | null | undefined;
  /** The joined song doc for the linked id, if any. */
  song: Song | null | undefined;
  /**
   * Link / unlink the item. Receives the chosen song id, or `null` to clear.
   * RunSheetScreen wires this to `updateItem({ songId })`.
   */
  onSelect: (songId: string | null) => void;
}

export function SongPicker({
  communityId,
  groupId,
  songId,
  song,
  onSelect,
}: SongPickerProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const router = useRouter();
  // Creating a library song is open to community admins and group leaders
  // (backend `requireCommunitySongEditor`). Gate the inline Create affordance on
  // the authoritative check so a scheduler who can't edit the library (e.g. a
  // team moderator who isn't a leader) links existing songs without a dead tap.
  const canCreate =
    useAuthenticatedQuery(
      api.functions.scheduling.songs.canManageSongs,
      communityId
        ? { communityId: communityId as Id<"communities"> }
        : "skip",
    ) ?? false;
  const [query, setQuery] = useState("");

  const songs = useAuthenticatedQuery(
    api.functions.scheduling.songs.listSongs,
    communityId
      ? { communityId: communityId as Id<"communities"> }
      : "skip",
  ) as Song[] | null | undefined;

  const createSong = useAuthenticatedMutation(
    api.functions.scheduling.songs.createSong,
  );

  const trimmed = query.trim();
  const results = useMemo(() => {
    const all = songs ?? [];
    if (!trimmed) return all;
    const q = trimmed.toLowerCase();
    return all.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.author ?? "").toLowerCase().includes(q) ||
        (s.ccliNumber ?? "").toLowerCase().includes(q),
    );
  }, [songs, trimmed]);

  // Offer "create" when the typed title doesn't already exist verbatim.
  const exactExists = useMemo(
    () =>
      (songs ?? []).some(
        (s) => s.title.toLowerCase() === trimmed.toLowerCase(),
      ),
    [songs, trimmed],
  );

  const handleCreate = async () => {
    if (!trimmed) return;
    try {
      const newId = await createSong({
        communityId: communityId as Id<"communities">,
        input: { title: trimmed },
      });
      setQuery("");
      onSelect(newId as unknown as string);
    } catch (e: any) {
      notify(
        "Couldn't create song",
        e?.data?.message ?? e?.message ?? "Please try again.",
      );
    }
  };

  // Linked state: show the song + clear / change controls.
  if (songId && song) {
    return (
      <View style={styles.container}>
        <View
          style={[
            styles.linkedRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="musical-notes" size={16} color={primaryColor} />
          <Text style={[styles.linkedTitle, { color: colors.text }]} numberOfLines={1}>
            {song.title}
          </Text>
          {song.defaultKey ? (
            <Text style={[styles.linkedMeta, { color: colors.textSecondary }]}>
              {song.defaultKey}
            </Text>
          ) : null}
          <Pressable
            onPress={() => onSelect(null)}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[styles.clearText, { color: colors.textSecondary }]}>
              Clear
            </Text>
          </Pressable>
        </View>
        <ManageLibraryLink
          colors={colors}
          primaryColor={primaryColor}
          onPress={() => router.push(`/rostering/${groupId}/songs`)}
        />
      </View>
    );
  }

  // Unlinked: search + pick / create.
  return (
    <View style={styles.container}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search songs…"
        placeholderTextColor={colors.inputPlaceholder}
        accessibilityLabel="Search songs"
        style={[
          styles.search,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      <View style={styles.results}>
        {results.map((s) => (
          <Pressable
            key={s._id}
            onPress={() => onSelect(s._id)}
            style={[styles.resultRow, { borderColor: colors.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.resultTitle, { color: colors.text }]} numberOfLines={1}>
              {s.title}
            </Text>
            <Text style={[styles.resultMeta, { color: colors.textSecondary }]} numberOfLines={1}>
              {[s.author, s.defaultKey].filter(Boolean).join(" · ")}
            </Text>
          </Pressable>
        ))}
        {trimmed && !exactExists && canCreate ? (
          <Pressable
            onPress={handleCreate}
            style={[styles.createRow, { borderColor: primaryColor }]}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={16} color={primaryColor} />
            <Text style={[styles.createText, { color: primaryColor }]} numberOfLines={1}>
              Create "{trimmed}"
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ManageLibraryLink
        colors={colors}
        primaryColor={primaryColor}
        onPress={() => router.push(`/rostering/${groupId}/songs`)}
      />
    </View>
  );
}

function ManageLibraryLink({
  colors,
  primaryColor,
  onPress,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.manageRow} accessibilityRole="button">
      <Ionicons name="library-outline" size={14} color={primaryColor} />
      <Text style={[styles.manageText, { color: primaryColor }]}>
        Manage song library
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  linkedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  linkedTitle: { flex: 1, fontSize: 14, fontWeight: "600" },
  linkedMeta: { fontSize: 13, fontWeight: "600" },
  clearText: { fontSize: 13, fontWeight: "600" },
  search: {
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  results: { gap: 4 },
  resultRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  resultTitle: { fontSize: 14, fontWeight: "600" },
  resultMeta: { fontSize: 12, marginTop: 1 },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  createText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  manageRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  manageText: { fontSize: 13, fontWeight: "600" },
});
