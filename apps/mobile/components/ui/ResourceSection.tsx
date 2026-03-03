/**
 * ResourceSection - Displays a single resource section with optional link preview
 *
 * Shared component used by both the authenticated resource page and the
 * public tool short link page.
 */
import { View, Text, StyleSheet, Pressable, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLinkPreview } from "@features/chat/hooks/useLinkPreview";
import { LinkPreviewCard } from "@features/chat/components/LinkPreviewCard";
import { AppImage } from "./AppImage";

// ============================================================================
// Types
// ============================================================================

export interface ResourceSectionData {
  id: string;
  title: string;
  description?: string;
  imageUrls?: string[];
  linkUrl?: string;
  order: number;
}

// ============================================================================
// Component
// ============================================================================

export function ResourceSection({ section }: { section: ResourceSectionData }) {
  const { preview, loading } = useLinkPreview(section.linkUrl || null);

  const handleLinkPress = () => {
    if (section.linkUrl) {
      Linking.openURL(section.linkUrl).catch((err) => {
        console.error("[ResourceSection] Failed to open URL:", err);
      });
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{section.title}</Text>

      {section.description && (
        <Text style={styles.sectionDescription}>{section.description}</Text>
      )}

      {section.imageUrls?.map((url, index) => (
        <AppImage
          key={`${section.id}-img-${index}`}
          source={url}
          style={[
            styles.sectionImage,
            index < (section.imageUrls?.length ?? 0) - 1 && { marginBottom: 8 },
          ]}
          resizeMode="cover"
          placeholder={{ type: "color", backgroundColor: "#f0f0f0" }}
        />
      ))}

      {section.linkUrl && (
        <Pressable onPress={handleLinkPress}>
          {loading ? (
            <LinkPreviewCard
              preview={{ url: section.linkUrl }}
              loading
              embedded
            />
          ) : preview ? (
            <LinkPreviewCard preview={preview} embedded />
          ) : (
            <View style={styles.linkFallback}>
              <Ionicons name="link-outline" size={16} color="#007AFF" />
              <Text style={styles.linkText} numberOfLines={1}>
                {section.linkUrl}
              </Text>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 12,
  },
  sectionImage: {
    width: "100%",
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  linkFallback: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    color: "#007AFF",
    textDecorationLine: "underline",
    flex: 1,
  },
});
