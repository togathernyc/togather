/**
 * Run sheet link rendering (shared).
 *
 * Run sheet item descriptions and notes are plain text that may contain URLs.
 * These helpers detect those URLs and render them as rich previews (or an
 * inline Dropbox video card) instead of raw text, plus expose `SelectableText`
 * for iOS-reliable text selection.
 *
 * Extracted from the PCO `RunSheetScreen` so the native `NativeRunSheetView`
 * can share the exact same treatment (no duplicated regex/preview logic).
 */
import React, { useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Linking,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useTheme } from "@hooks/useTheme";
import { useLinkPreview } from "@features/chat/hooks/useLinkPreview";
import { LinkPreviewCard } from "@features/chat/components/LinkPreviewCard";

// URL regex pattern for detecting links
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

// Dropbox video URL pattern - use global flag to find all matches
const DROPBOX_VIDEO_REGEX =
  /https?:\/\/(?:www\.)?dropbox\.com\/[^\s<>"{}|\\^`[\]]+\.(?:mp4|mov|avi|webm|mkv)(?:\?[^\s<>"{}|\\^`[\]]*)?/gi;

// Get playable Dropbox URL
// Note: The newer /scl/fi/ format doesn't support dl=1 conversion,
// so we use the original share URL and let Dropbox's web player handle it
function getDropboxPlayableUrl(url: string): string {
  return url;
}

// Extract Dropbox video URLs from text
function extractDropboxVideos(text: string): string[] {
  // Reset regex lastIndex before matching (since it's global)
  DROPBOX_VIDEO_REGEX.lastIndex = 0;
  const matches = text.match(DROPBOX_VIDEO_REGEX);
  return matches || [];
}

// Extract all URLs from text
function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches || [];
}

// Selectable text component that works reliably on iOS
// Uses TextInput with editable={false} for native text selection
export function SelectableText({
  children,
  style,
}: {
  children: string;
  style?: object;
}) {
  return (
    <TextInput
      value={children}
      editable={false}
      multiline
      scrollEnabled={false}
      style={[
        {
          padding: 0,
          margin: 0,
          // Reset TextInput default styles
          backgroundColor: "transparent",
        },
        style,
      ]}
    />
  );
}

// Extract filename from Dropbox URL
function getFilenameFromUrl(url: string): string {
  try {
    // Try to extract filename from path
    const urlPath = url.split("?")[0];
    const parts = urlPath.split("/");
    const filename = parts[parts.length - 1];
    // Decode URI component and clean up
    return decodeURIComponent(filename) || "Video";
  } catch {
    return "Video";
  }
}

// Dropbox Video Card Component - Opens in in-app browser for playback
function DropboxVideoPlayer({ url }: { url: string }) {
  const { colors, isDark } = useTheme();
  const playableUrl = getDropboxPlayableUrl(url);
  const filename = getFilenameFromUrl(url);

  const handlePress = useCallback(async () => {
    try {
      // Open in in-app browser - Dropbox's web player will handle video playback
      await WebBrowser.openBrowserAsync(playableUrl, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });
    } catch (err) {
      console.error("Failed to open video:", err);
      // Fallback to external browser
      Linking.openURL(playableUrl).catch((linkErr) => {
        console.error("[runSheetLinks] Failed to open video URL:", linkErr);
      });
    }
  }, [playableUrl]);

  return (
    <Pressable
      style={[
        dropboxVideoStyles.container,
        { backgroundColor: isDark ? "#1a2730" : "#1a1a1a" },
      ]}
      onPress={handlePress}
    >
      <View
        style={[
          dropboxVideoStyles.iconContainer,
          { backgroundColor: isDark ? "#233138" : "#333" },
        ]}
      >
        <Ionicons name="play-circle" size={48} color={colors.textInverse} />
      </View>
      <View style={dropboxVideoStyles.textContainer}>
        <Text
          style={[dropboxVideoStyles.filename, { color: "#fff" }]}
          numberOfLines={1}
        >
          {filename}
        </Text>
        <Text style={[dropboxVideoStyles.tapText, { color: colors.textTertiary }]}>
          Tap to play video
        </Text>
      </View>
    </Pressable>
  );
}

const dropboxVideoStyles = StyleSheet.create({
  container: {
    marginTop: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
  },
  filename: {
    fontSize: 14,
    fontWeight: "500",
  },
  tapText: {
    fontSize: 12,
    marginTop: 2,
  },
});

// Remove URLs from text (for cleaner display when showing previews)
function removeUrlsFromText(text: string, urls: string[]): string {
  let result = text;
  urls.forEach((url) => {
    result = result.replace(url, "");
  });
  return result.trim();
}

// Rich link preview component for runsheet notes
function RunsheetLinkPreview({ url }: { url: string }) {
  const { colors } = useTheme();
  const { preview, loading } = useLinkPreview(url);

  if (loading) {
    return (
      <View style={linkPreviewStyles.container}>
        <LinkPreviewCard preview={{ url }} loading embedded />
      </View>
    );
  }

  if (!preview) {
    // Fall back to simple link if preview fails
    return (
      <Pressable
        onPress={() => {
          Linking.openURL(url).catch((err) => {
            console.error("Failed to open URL:", err);
          });
        }}
        style={linkPreviewStyles.fallbackLink}
      >
        <Text
          style={[linkPreviewStyles.fallbackLinkText, { color: colors.link }]}
          numberOfLines={1}
        >
          {url}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => {
        Linking.openURL(url).catch((err) => {
          console.error("Failed to open URL:", err);
        });
      }}
      style={linkPreviewStyles.container}
    >
      <LinkPreviewCard preview={preview} embedded />
    </Pressable>
  );
}

const linkPreviewStyles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  fallbackLink: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  fallbackLinkText: {
    textDecorationLine: "underline",
    fontSize: 13,
  },
});

/**
 * Render selectable text with links shown separately below. Also renders
 * Dropbox videos inline and rich link previews for other URLs.
 */
export function renderTextWithLinks(
  text: string,
  style: object,
  _linkColor: string,
): React.ReactNode {
  const urls = extractUrls(text);
  const dropboxVideos = extractDropboxVideos(text);

  // Separate URLs into categories:
  // 1. Dropbox video URLs - use DropboxVideoPlayer
  // 2. Other URLs - use RunsheetLinkPreview for rich previews
  const dropboxVideoSet = new Set(dropboxVideos);
  const previewUrls = urls.filter((url) => !dropboxVideoSet.has(url));

  // All URLs that will have visual previews (to remove from text display)
  const allPreviewUrls = [...dropboxVideos, ...previewUrls];

  // Remove URLs from text when we're showing previews
  const cleanedText =
    allPreviewUrls.length > 0 ? removeUrlsFromText(text, allPreviewUrls) : text;

  return (
    <View>
      {/* Only show text if there's content after removing URLs */}
      {cleanedText.length > 0 && (
        <SelectableText style={style}>{cleanedText}</SelectableText>
      )}

      {/* Render Dropbox videos inline */}
      {dropboxVideos.map((videoUrl, index) => (
        <DropboxVideoPlayer key={`video-${index}`} url={videoUrl} />
      ))}

      {/* Render rich link previews for other URLs */}
      {previewUrls.map((url, index) => (
        <RunsheetLinkPreview key={`link-${index}`} url={url} />
      ))}
    </View>
  );
}
