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
import React from "react";
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

/** How-to guidance kind (mirrors the backend `howToType` validator). */
export type HowToType = "none" | "text" | "link" | "media" | "doc";

/** The how-to fields the viewer renders (a subset of a serving task). */
export type HowToViewerContent = {
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
        <Markdown source={content.howToDoc} />
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
