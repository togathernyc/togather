/**
 * MusicianRehearsalScreen
 *
 * A read-only, per-person view of ONE event plan's run sheet songs (ADR-027),
 * so an assigned volunteer/musician can rehearse ahead of time. It reuses the
 * existing `getEvent` / `listItems` queries (ADR-026) — each `song`-type item
 * now carries an optional joined `item.song` (the library song) and may have a
 * per-occurrence `item.songDetails` override.
 *
 * For each song it shows: title, effective key/BPM (override → song default),
 * meter, arrangement, and structure. Each chart opens its file externally; the
 * multitracks link opens the provider (MultiTracks / Loop Community) — we never
 * host audio or stems, only link out to where the musician's own subscription
 * and RehearsalMix live.
 *
 * Read-only: no editing affordances. Items without a linked song still render
 * their free-typed title (backwards compatible with ADR-026 song rows).
 *
 * Route: /rostering/[group_id]/run-sheet/rehearse/[plan_id]
 */
import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatEventDateLong } from "../utils/format";
import {
  effectiveBpm,
  effectiveKey,
  type Song,
  type SongChart,
} from "../utils/songRehearsal";

// The joined `item.song` shape (returned by `getEvent` / `listItems` per
// ADR-027) is typed via `Song` re-exported from `features/songs/types`.

type RehearsalItem = {
  _id: Id<"eventItems">;
  type: string;
  title: string;
  songDetails?: { key?: string; bpm?: number; author?: string } | null;
  song?: Song | null;
};

type EventDoc = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
};

/** Open a URL externally, surfacing a friendly error if the device can't. */
async function openExternal(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    const message = "Couldn't open the link. Please try again.";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.alert(message);
      return;
    }
    Alert.alert("Couldn't open", message);
  }
}

export function MusicianRehearsalScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { plan_id } = useLocalSearchParams<{ plan_id: string }>();
  const planId = plan_id as Id<"eventPlans">;

  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    planId ? { planId } : "skip",
  ) as EventDoc | null | undefined;

  const items = useAuthenticatedQuery(
    api.functions.scheduling.eventItems.listItems,
    planId ? { planId } : "skip",
  ) as RehearsalItem[] | null | undefined;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // Only song rows are relevant to a musician rehearsing — headers, media, and
  // generic items are part of the run flow, not the song set.
  const songs = useMemo(
    () => (items ?? []).filter((it) => it.type === "song"),
    [items],
  );

  const loading = event === undefined || items === undefined;

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Rehearse</Text>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : !event || !items ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This run sheet is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          <Text style={[styles.planTitle, { color: colors.text }]}>
            {event.title}
          </Text>
          <Text style={[styles.planDate, { color: colors.textSecondary }]}>
            {formatEventDateLong(event.eventDate)}
          </Text>

          {songs.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No songs on this run sheet yet. Check back once the worship leader
              has added them.
            </Text>
          ) : (
            <View style={styles.list}>
              {songs.map((item) => (
                <SongCard
                  key={item._id}
                  item={item}
                  colors={colors}
                  primaryColor={primaryColor}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** One read-only song card with its charts and multitracks link. */
function SongCard({
  item,
  colors,
  primaryColor,
}: {
  item: RehearsalItem;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
}) {
  const song = item.song ?? null;
  const key = effectiveKey(item);
  const bpm = effectiveBpm(item);
  const meter = song?.meter;
  const arrangement = song?.arrangementName;
  const author = song?.author ?? item.songDetails?.author;
  const structure = song?.structure ?? [];
  const charts: SongChart[] = song?.charts ?? [];
  const multitracksUrl = song?.multitracksUrl;

  // Compact metadata line: "Key A · 120 BPM · 4/4".
  const meta = [
    key ? `Key ${key}` : null,
    bpm ? `${bpm} BPM` : null,
    meter ?? null,
  ].filter(Boolean) as string[];

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <Text style={[styles.songTitle, { color: colors.text }]}>
        {song?.title ?? item.title}
      </Text>
      {author ? (
        <Text style={[styles.songAuthor, { color: colors.textSecondary }]}>
          {author}
        </Text>
      ) : null}

      {meta.length > 0 ? (
        <Text style={[styles.metaLine, { color: colors.text }]}>
          {meta.join("  ·  ")}
        </Text>
      ) : null}

      {arrangement ? (
        <Text style={[styles.arrangement, { color: colors.textSecondary }]}>
          {arrangement}
        </Text>
      ) : null}

      {structure.length > 0 ? (
        <View style={styles.structureWrap}>
          {structure.map((section, idx) => (
            <View
              key={`${section}-${idx}`}
              style={[styles.sectionChip, { backgroundColor: primaryColor + "14" }]}
            >
              <Text style={[styles.sectionText, { color: colors.text }]} numberOfLines={1}>
                {section}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {charts.length > 0 ? (
        <View style={styles.chartsWrap}>
          {charts.map((chart, idx) => {
            const label = chart.key ? `${chart.label} (${chart.key})` : chart.label;
            const disabled = !chart.url;
            return (
              <Pressable
                key={`${chart.fileKey}-${idx}`}
                onPress={() => chart.url && void openExternal(chart.url)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Open chart: ${label}`}
                style={[
                  styles.chartBtn,
                  { borderColor: colors.border, opacity: disabled ? 0.5 : 1 },
                ]}
              >
                <Ionicons name="document-text-outline" size={16} color={primaryColor} />
                <Text style={[styles.chartText, { color: colors.text }]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {multitracksUrl ? (
        <Pressable
          onPress={() => void openExternal(multitracksUrl)}
          accessibilityRole="button"
          accessibilityLabel="Rehearse multitracks"
          style={[styles.multitracksBtn, { backgroundColor: primaryColor }]}
        >
          <Ionicons name="musical-notes" size={16} color="#fff" />
          <Text style={styles.multitracksText}>Rehearse multitracks</Text>
          <Ionicons name="open-outline" size={15} color="#fff" />
        </Pressable>
      ) : null}
      {multitracksUrl ? (
        <Text style={[styles.multitracksHint, { color: colors.textTertiary }]}>
          Opens your provider (MultiTracks, etc.) — Togather doesn't host audio.
        </Text>
      ) : null}
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14 },
  scrollContent: { padding: 16 },
  planTitle: { fontSize: 22, fontWeight: "700" },
  planDate: { fontSize: 13, marginTop: 4 },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  list: { marginTop: 16, gap: 12 },
  card: {
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  songTitle: { fontSize: 17, fontWeight: "700" },
  songAuthor: { fontSize: 13, marginTop: 2 },
  metaLine: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  arrangement: { fontSize: 13, marginTop: 4, fontStyle: "italic" },
  structureWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  sectionChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sectionText: { fontSize: 12, fontWeight: "600" },
  chartsWrap: { gap: 8, marginTop: 12 },
  chartBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chartText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  multitracksBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  multitracksText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  multitracksHint: { fontSize: 11, marginTop: 6, lineHeight: 15 },
});
