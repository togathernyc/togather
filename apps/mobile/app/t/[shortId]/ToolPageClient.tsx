"use client";

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  ActionSheetIOS,
  Platform,
  Alert,
  Share,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
import { ResourceSection } from "@components/ui";
import type { ResourceSectionData } from "@components/ui";
import { RunSheetScreen } from "@features/leader-tools/components/RunSheetScreen";
import type { RunSheet } from "@features/leader-tools/components/RunSheetScreen";

// ============================================================================
// Main Component
// ============================================================================

export default function ToolPageClient() {
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Resolve the short link
  const toolLink = useQuery(
    api.functions.toolShortLinks.index.getByShortId,
    shortId ? { shortId } : "skip"
  );

  // Fetch resource data if tool type is "resource"
  const resourceData = useQuery(
    api.functions.groupResources.index.getByIdPublic,
    toolLink?.toolType === "resource" && toolLink?.resourceId && shortId
      ? { resourceId: toolLink.resourceId as Id<"groupResources">, shortLinkId: shortId }
      : "skip"
  );

  // Fetch run sheet data if tool type is "runsheet"
  const getRunSheetPublic = useAction(
    api.functions.pcoServices.runSheet.getRunSheetPublic
  );
  const [runSheet, setRunSheet] = useState<RunSheet | null>(null);
  const [runSheetLoading, setRunSheetLoading] = useState(false);
  const [runSheetError, setRunSheetError] = useState<string | null>(null);

  useEffect(() => {
    if (toolLink?.toolType === "runsheet" && toolLink.groupId && shortId) {
      setRunSheetLoading(true);
      getRunSheetPublic({ groupId: toolLink.groupId as Id<"groups">, shortLinkId: shortId })
        .then((result) => {
          setRunSheet(result);
          setRunSheetLoading(false);
        })
        .catch((err) => {
          console.error("[ToolPageClient] Run sheet fetch error:", err);
          setRunSheetError(err.message || "Failed to load run sheet");
          setRunSheetLoading(false);
        });
    }
  }, [toolLink?.toolType, toolLink?.groupId, shortId, getRunSheetPublic]);

  // Task links should open the authenticated task detail UI.
  useEffect(() => {
    if (
      toolLink?.toolType === "task" &&
      typeof toolLink.groupId === "string" &&
      typeof toolLink.taskId === "string"
    ) {
      router.replace(`/(user)/leader-tools/${toolLink.groupId}/tasks/${toolLink.taskId}`);
    }
  }, [router, toolLink?.toolType, toolLink?.groupId, toolLink?.taskId]);

  // Share handler
  const handleShare = async () => {
    if (!shortId) return;

    const toolUrl = DOMAIN_CONFIG.toolShareUrl(shortId);
    const toolName = getToolDisplayName();

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Copy Link", "Share"],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(toolUrl);
            Alert.alert("Link Copied", "Tool link has been copied to clipboard.");
          } else if (buttonIndex === 2) {
            await Share.share({
              message: `${toolName}\n${toolUrl}`,
              url: toolUrl,
            });
          }
        }
      );
    } else {
      await Share.share({
        message: `${toolName}\n${toolUrl}`,
      });
    }
  };

  // Get display name for the tool
  const getToolDisplayName = (): string => {
    if (!toolLink) return "Tool";
    const groupName = toolLink.groupName as string;
    if (toolLink.toolType === "runsheet") {
      return `${groupName} - Run Sheet`;
    }
    if (toolLink.toolType === "resource") {
      const resourceTitle = toolLink.resourceTitle as string || "Resource";
      return `${groupName} - ${resourceTitle}`;
    }
    if (toolLink.toolType === "task") {
      const taskTitle = (toolLink.taskTitle as string) || "Task";
      return `${groupName} - ${taskTitle}`;
    }
    return groupName;
  };

  // Navigation
  const showBackButton = Platform.OS !== "web" || router.canGoBack();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/search");
    }
  };

  // Loading state
  const isLoading = toolLink === undefined;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  // Not found
  if (toolLink === null) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#999" />
        <Text style={styles.errorTitle}>Link Not Found</Text>
        <Text style={styles.errorText}>
          This tool link may have been removed or is invalid.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Get tool icon
  const getToolIcon = (): keyof typeof Ionicons.glyphMap => {
    if (toolLink.toolType === "runsheet") return "list-outline";
    if (toolLink.toolType === "resource") {
      return (toolLink.resourceIcon as keyof typeof Ionicons.glyphMap) || "document-text-outline";
    }
    if (toolLink.toolType === "task") return "checkmark-circle-outline";
    return "link-outline";
  };

  if (toolLink.toolType === "task") {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        <Text style={styles.loadingText}>Opening task...</Text>
      </SafeAreaView>
    );
  }

  // Run sheet uses RunSheetScreen directly (no outer ScrollView — it manages its own)
  if (toolLink.toolType === "runsheet") {
    return (
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          {showBackButton ? (
            <TouchableOpacity style={styles.headerButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color="#000" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <View style={styles.headerTitleContainer}>
            <Ionicons name={getToolIcon()} size={18} color="#666" />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {getToolDisplayName()}
            </Text>
          </View>
          <TouchableOpacity style={styles.headerButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        {/* Run Sheet Content */}
        {runSheetLoading ? (
          <View style={styles.contentLoading}>
            <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
            <Text style={styles.loadingText}>Loading run sheet...</Text>
          </View>
        ) : runSheetError ? (
          <View style={styles.contentError}>
            <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
            <Text style={styles.errorTitle}>Failed to load</Text>
            <Text style={styles.errorText}>{runSheetError}</Text>
          </View>
        ) : !runSheet ? (
          <View style={styles.contentError}>
            <Ionicons name="calendar-outline" size={48} color="#999" />
            <Text style={styles.errorTitle}>No upcoming plans</Text>
            <Text style={styles.errorText}>
              There are no scheduled services for this group.
            </Text>
          </View>
        ) : (
          <RunSheetScreen externalRunSheet={runSheet} readOnly />
        )}
      </View>
    );
  }

  // Resource and other tool types use ScrollView wrapper
  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 40 + insets.bottom },
        ]}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          {showBackButton ? (
            <TouchableOpacity style={styles.headerButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color="#000" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <View style={styles.headerTitleContainer}>
            <Ionicons name={getToolIcon()} size={18} color="#666" />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {getToolDisplayName()}
            </Text>
          </View>
          <TouchableOpacity style={styles.headerButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        {/* Resource Content */}
        {toolLink.toolType === "resource" && renderResourceContent()}
      </ScrollView>
    </View>
  );

  // Render resource content
  function renderResourceContent() {
    if (resourceData === undefined) {
      return (
        <View style={styles.contentLoading}>
          <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          <Text style={styles.loadingText}>Loading resource...</Text>
        </View>
      );
    }

    if (resourceData === null) {
      return (
        <View style={styles.contentError}>
          <Ionicons name="document-outline" size={48} color="#ccc" />
          <Text style={styles.errorTitle}>Resource not found</Text>
          <Text style={styles.errorText}>
            This resource may have been removed.
          </Text>
        </View>
      );
    }

    const sortedSections = [...resourceData.sections].sort(
      (a: ResourceSectionData, b: ResourceSectionData) => a.order - b.order
    );

    return (
      <View style={styles.contentContainer}>
        {/* Resource header */}
        <View style={styles.resourceHeader}>
          {resourceData.icon && (
            <Ionicons
              name={resourceData.icon as keyof typeof Ionicons.glyphMap}
              size={28}
              color="#333"
            />
          )}
          <Text style={styles.resourceTitle}>{resourceData.title}</Text>
        </View>

        {/* Sections */}
        {sortedSections.map((section: ResourceSectionData) => (
          <ResourceSection key={section.id} section={section} />
        ))}

        {sortedSections.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No content yet</Text>
          </View>
        )}
      </View>
    );
  }
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
    color: "#333",
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
  },
  backBtn: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
  },
  backBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fff",
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },

  // Content states
  contentLoading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
  },
  contentError: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  contentContainer: {
    padding: 16,
  },

  // Resource styles
  resourceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
  },
  resourceTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
  },
});
