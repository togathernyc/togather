/**
 * HowToViewer
 *
 * A read-only, full-screen viewer for a serving task's "How-To" guidance. Short
 * `text` guidance is shown inline on the task row itself, so this viewer only
 * ever presents the heavier kinds that don't belong inline:
 *
 *   - doc   → the Markdown How-To document, padded + scrollable.
 *   - media → a full-bleed image (via `AppImage`), or — for a video path — a
 *             centered "Play video" affordance that opens the resolved URL.
 *   - link  → the URL plus an "Open link" button (opened via the OS).
 *
 * Presented as a slide-up `Modal` (matching `EventTasksHowToDocEditor`). The
 * header carries the task title and a close button. Nothing here mutates state.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Markdown } from "@components/ui/Markdown";
import { AppImage } from "@components/ui/AppImage";
import { getMediaUrl } from "@/utils/media";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";

/** How-to guidance kind (mirrors the backend `howToType` validator). */
export type HowToType = "none" | "text" | "link" | "media" | "doc";

/** The how-to fields the viewer renders (a subset of a serving task). */
export type HowToViewerContent = {
  /** The `eventTasks` id — keys the per-user checklist state for a `doc`. */
  taskId: string;
  title: string;
  howToType: HowToType;
  howToUrl?: string | null;
  howToMediaPath?: string | null;
  howToDoc?: string | null;
};

/** Extensions we treat as video when deciding how to present a media path. */
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|qt)(\?|$)/i;

export function HowToViewer({
  visible,
  content,
  onClose,
}: {
  visible: boolean;
  content: HowToViewerContent | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.background },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text
            style={[styles.headerTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {content?.title || "How-To"}
          </Text>
          {/* Spacer to keep the title optically centered against the close btn. */}
          <View style={styles.headerBtn} />
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.bodyContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          {content ? (
            <HowToBody
              content={content}
              colors={colors}
              primaryColor={primaryColor}
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

type ThemeColors = ReturnType<typeof useTheme>["colors"];

function HowToBody({
  content,
  colors,
  primaryColor,
}: {
  content: HowToViewerContent;
  colors: ThemeColors;
  primaryColor: string;
}) {
  switch (content.howToType) {
    case "doc":
      return content.howToDoc && content.howToDoc.trim().length > 0 ? (
        <InteractiveDoc
          taskId={content.taskId}
          source={content.howToDoc}
          colors={colors}
          primaryColor={primaryColor}
        />
      ) : (
        <EmptyState colors={colors} label="No details yet." />
      );

    case "link": {
      const url = content.howToUrl?.trim();
      if (!url) return <EmptyState colors={colors} label="No link." />;
      return (
        <View style={styles.linkWrap}>
          <Text style={[styles.linkUrl, { color: colors.textSecondary }]}>
            {url}
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(url).catch(() => {})}
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
            accessibilityRole="button"
            accessibilityLabel="Open link"
          >
            <Ionicons name="open-outline" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Open link</Text>
          </Pressable>
        </View>
      );
    }

    case "media": {
      const path = content.howToMediaPath?.trim();
      if (!path) return <EmptyState colors={colors} label="No attachment." />;
      if (VIDEO_EXT_RE.test(path)) {
        return (
          <Pressable
            onPress={() => {
              const url = getMediaUrl(path);
              if (url) void Linking.openURL(url).catch(() => {});
            }}
            style={[styles.videoTile, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Play video"
          >
            <View
              style={[styles.playCircle, { backgroundColor: primaryColor }]}
            >
              <Ionicons name="play" size={26} color="#fff" />
            </View>
            <Text style={[styles.videoLabel, { color: colors.textSecondary }]}>
              Play video
            </Text>
          </Pressable>
        );
      }
      return (
        <AppImage
          source={path}
          style={styles.image}
          resizeMode="contain"
        />
      );
    }

    default:
      return <EmptyState colors={colors} label="No details." />;
  }
}

/**
 * A markdown task-list line, e.g. `- [ ] Step 1` or `* [x] Done`.
 * Capture 1 is the box state (` `, `x`, or `X`); capture 2 is the label text.
 */
const TASK_ITEM_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;

/** A parsed doc segment: either a run of plain markdown, or a checklist item. */
type DocSegment =
  | { kind: "md"; text: string }
  | { kind: "item"; key: string; label: string };

/**
 * Split a How-To doc into ordered segments: contiguous non-checklist lines
 * become `md` blocks (rendered through the shared `Markdown`), and each
 * `- [ ] …` line becomes an `item` with a CONTENT-BASED `key`.
 *
 * The key is `${occurrence}:${normalized label}` — so a saved check follows its
 * item when the doc is reordered, and only detaches if the item's text is
 * edited. The occurrence prefix disambiguates two identical checklist lines.
 */
function parseDoc(source: string): DocSegment[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const segments: DocSegment[] = [];
  let buffer: string[] = [];
  const seen = new Map<string, number>();

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n");
    if (text.trim().length > 0) segments.push({ kind: "md", text });
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(TASK_ITEM_RE);
    if (match) {
      flushBuffer();
      const label = match[2].trim();
      const normalized = label.replace(/\s+/g, " ").toLowerCase();
      const occ = seen.get(normalized) ?? 0;
      seen.set(normalized, occ + 1);
      segments.push({ kind: "item", key: `${occ}:${normalized}`, label });
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();
  return segments;
}

/**
 * Renders a `doc` How-To as an interactive checklist. Non-checklist prose is
 * rendered via the shared `Markdown`; each `- [ ]` line is a tappable row whose
 * checked state is per-user (from `getHowToDocChecks`) and OVERRIDES the doc's
 * literal `[x]`. Toggling updates optimistically, then the reactive query
 * confirms.
 *
 * NOTE (content keys): a user's saved checks map to checklist items by their
 * text (see `parseDoc`). Reordering the doc keeps checks attached; editing an
 * item's text detaches its check (it becomes a new item).
 */
function InteractiveDoc({
  taskId,
  source,
  colors,
  primaryColor,
}: {
  taskId: string;
  source: string;
  colors: ThemeColors;
  primaryColor: string;
}) {
  const segments = useMemo(() => parseDoc(source), [source]);
  const hasItems = segments.some((s) => s.kind === "item");

  const serverChecks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getHowToDocChecks,
    taskId ? { taskId: taskId as Id<"eventTasks"> } : "skip",
  ) as string[] | undefined;

  const setCheck = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.setHowToDocCheck,
  );

  const checkedSet = useMemo(
    () => new Set(serverChecks ?? []),
    [serverChecks],
  );

  // Pending optimistic overrides, keyed by item key. An entry wins over the
  // server value until the reactive query catches up (then it's reconciled).
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Drop optimistic entries the server now agrees with.
    setPending((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (checkedSet.has(key) === next[key]) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [checkedSet]);

  const isChecked = useCallback(
    (key: string) => (key in pending ? pending[key] : checkedSet.has(key)),
    [pending, checkedSet],
  );

  const onToggle = useCallback(
    async (key: string) => {
      if (!taskId) return;
      const next = !isChecked(key);
      setPending((prev) => ({ ...prev, [key]: next }));
      try {
        await setCheck({
          taskId: taskId as Id<"eventTasks">,
          itemKey: key,
          checked: next,
        });
      } catch {
        // Revert the optimistic flip on failure.
        setPending((prev) => {
          const revert = { ...prev };
          delete revert[key];
          return revert;
        });
      }
    },
    [taskId, isChecked, setCheck],
  );

  // No checklist items → nothing interactive to do; render the doc as-is.
  if (!hasItems) return <Markdown source={source} />;

  return (
    <View>
      {segments.map((segment, i) => {
        if (segment.kind === "md") {
          return <Markdown key={`md-${i}`} source={segment.text} />;
        }
        const checked = isChecked(segment.key);
        return (
          <TouchableOpacity
            key={`item-${segment.key}`}
            activeOpacity={0.6}
            onPress={() => void onToggle(segment.key)}
            style={styles.checkRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={segment.label}
          >
            <View
              style={[
                styles.checkbox,
                checked
                  ? { backgroundColor: primaryColor, borderColor: primaryColor }
                  : { borderColor: colors.border },
              ]}
            >
              {checked ? (
                <Ionicons name="checkmark" size={16} color="#fff" />
              ) : null}
            </View>
            <Text style={[styles.checkLabel, { color: colors.text }]}>
              {segment.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function EmptyState({
  colors,
  label,
}: {
  colors: ThemeColors;
  label: string;
}) {
  return (
    <Text style={[styles.empty, { color: colors.textTertiary }]}>{label}</Text>
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
  body: { flex: 1 },
  bodyContent: { padding: 20 },
  empty: { fontSize: 15, fontStyle: "italic" },
  // Interactive checklist
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkLabel: { flex: 1, fontSize: 16, lineHeight: 24 },
  // Link
  linkWrap: { gap: 16 },
  linkUrl: { fontSize: 15, lineHeight: 22 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  // Media
  image: { width: "100%", height: 360, borderRadius: 12 },
  videoTile: {
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 48,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 4,
  },
  videoLabel: { fontSize: 15, fontWeight: "600" },
});
