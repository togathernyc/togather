/**
 * Run Sheet Screen (ScriptViewer-style)
 *
 * Displays PCO service plan items with role-based filtering:
 * - Role selector: Audio, Video, Lighting, Stage, TD, SD, Service Cues
 * - Time display: Clock time + duration
 * - Role-specific notes shown based on selected role
 * - Color coding per role (matching ScriptViewer)
 *
 * Mobile-optimized: Shows one role's notes at a time instead of columns.
 */
import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  Linking,
  ActionSheetIOS,
  Alert,
  Share,
  Platform,
} from "react-native";
// Video URLs are opened in expo-web-browser for in-app playback
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedAction, useAuthenticatedMutation, useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useRunSheetCache } from "@/stores/runSheetCache";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import {
  normalizeRoleName,
  getRoleColor,
  sanitizeNoteContent,
} from "../utils/runSheetUtils";
import * as WebBrowser from "expo-web-browser";
import { useLinkPreview } from "@features/chat/hooks/useLinkPreview";
import { LinkPreviewCard } from "@features/chat/components/LinkPreviewCard";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

// URL regex pattern for detecting links
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

// Dropbox video URL pattern - use global flag to find all matches
const DROPBOX_VIDEO_REGEX = /https?:\/\/(?:www\.)?dropbox\.com\/[^\s<>"{}|\\^`[\]]+\.(?:mp4|mov|avi|webm|mkv)(?:\?[^\s<>"{}|\\^`[\]]*)?/gi;

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
function SelectableText({
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
        console.error('[RunSheetScreen] Failed to open video URL:', linkErr);
      });
    }
  }, [playableUrl]);

  return (
    <Pressable
      style={[dropboxVideoStyles.container, { backgroundColor: isDark ? '#1a2730' : '#1a1a1a' }]}
      onPress={handlePress}
    >
      <View style={[dropboxVideoStyles.iconContainer, { backgroundColor: isDark ? '#233138' : '#333' }]}>
        <Ionicons name="play-circle" size={48} color={colors.textInverse} />
      </View>
      <View style={dropboxVideoStyles.textContainer}>
        <Text style={[dropboxVideoStyles.filename, { color: '#fff' }]} numberOfLines={1}>
          {filename}
        </Text>
        <Text style={[dropboxVideoStyles.tapText, { color: colors.textTertiary }]}>Tap to play video</Text>
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

// Check if URL is a video URL (mp4, mov, etc.)
function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|avi|webm|mkv)/i.test(url);
}

// Check if URL is a Dropbox video URL
function isDropboxVideoUrl(url: string): boolean {
  return url.includes("dropbox.com") && isVideoUrl(url);
}

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
        <LinkPreviewCard
          preview={{ url }}
          loading
          embedded
        />
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
        <Text style={[linkPreviewStyles.fallbackLinkText, { color: colors.link }]} numberOfLines={1}>
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

// Helper to render selectable text with links shown separately below
// Also renders Dropbox videos inline and rich link previews for other URLs
function renderTextWithLinks(
  text: string,
  style: object,
  _linkColor: string
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
  const cleanedText = allPreviewUrls.length > 0
    ? removeUrlsFromText(text, allPreviewUrls)
    : text;

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

// Types matching backend RunSheet (from apps/convex/functions/pcoServices/runSheet.ts)
// NOTE: These are intentionally duplicated rather than imported from the Convex package
// because the mobile app and Convex functions have different build/runtime environments.
// Importing directly could cause bundling issues and breaks the separation of concerns.
// If the backend types change, these must be updated manually.
export interface RunSheetItem {
  id: string;
  type: "song" | "header" | "media" | "item";
  title: string;
  description: string | null;
  sequence: number;
  length: number | null;
  /** Computed start time for this item (ISO string) */
  startsAt: string | null;
  /** Position relative to service: "pre", "post", "during", or null */
  servicePosition: string | null;
  songDetails?: {
    key: string | null;
    arrangement: string | null;
    author: string | null;
    ccliNumber: string | null;
    bpm: number | null;
    meter: string | null;
  };
  assignedPeople: Array<{
    name: string;
    position: string | null;
    team: string | null;
    status: string;
  }>;
  notes: Array<{
    category: string;
    content: string;
  }>;
  times: Array<{
    type: string;
    startsAt: string | null;
  }>;
  htmlDetails?: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    contentType: string;
    linkedUrl: string | null;
  }>;
}

export interface RunSheet {
  planId: string;
  title: string | null;
  date: string;
  seriesTitle: string | null;
  serviceTypeName: string;
  items: RunSheetItem[];
  /** Available service times for this plan (e.g., 10 AM, 12 PM) */
  serviceTimes: Array<{
    id: string;
    startsAt: string | null;
    name: string;
  }>;
  teamMembers: Array<{
    name: string;
    position: string | null;
    team: string | null;
    status: string;
  }>;
}

interface ServiceType {
  id: string;
  name: string;
  upcomingPlans: Array<{
    id: string;
    title: string | null;
    date: string;
    seriesTitle: string | null;
  }>;
}

interface RunSheetScreenProps {
  /** Pre-fetched run sheet data (skips all API calls when provided) */
  externalRunSheet?: RunSheet | null;
  /** Override theme color (used in public/external mode) */
  externalThemeColor?: string;
  /** Hide share/settings buttons */
  readOnly?: boolean;
}

export function RunSheetScreen({
  externalRunSheet,
  externalThemeColor,
  readOnly = false,
}: RunSheetScreenProps = {}) {
  const { colors, isDark } = useTheme();
  const isExternalMode = externalRunSheet !== undefined;

  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const themeColor = externalThemeColor || primaryColor || DEFAULT_PRIMARY_COLOR;

  // State
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<string | null>(null);
  const [runSheet, setRunSheet] = useState<RunSheet | null>(externalRunSheet ?? null);
  const [loading, setLoading] = useState(!isExternalMode);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [hasAppliedDefault, setHasAppliedDefault] = useState(false);

  // Role filter state
  const [selectedRole, setSelectedRole] = useState<string>("All");

  // Service time toggle state (for plans with multiple service times)
  const [selectedServiceTimeId, setSelectedServiceTimeId] = useState<string | null>(null);

  // Collapsed headers state
  const [collapsedHeaders, setCollapsedHeaders] = useState<Set<string>>(new Set());
  const [collapsedHeadersLoaded, setCollapsedHeadersLoaded] = useState(false);

  // Cache for offline support
  const [isStale, setIsStale] = useState(false);
  const {
    setRunSheet: cacheRunSheet,
    getRunSheet: getFreshCachedRunSheet,
    getRunSheetStale: getStaleCachedRunSheet,
    setServiceTypes: cacheServiceTypes,
    getServiceTypes: getFreshCachedServiceTypes,
    getServiceTypesStale: getStaleCachedServiceTypes,
  } = useRunSheetCache();

  // Type for group data with runSheetConfig
  type GroupWithRunSheetConfig = {
    userRole?: "leader" | "admin" | "member" | null;
    runSheetConfig?: {
      defaultServiceTypeIds?: string[];
      defaultView?: string;
      chipConfig?: {
        hidden: string[];
        order: string[];
      };
    };
  };

  // Query group data to get runSheetConfig with default service types
  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  ) as GroupWithRunSheetConfig | undefined | null;

  // Check if user can access settings (group leader/admin or community admin)
  const isAdmin = user?.is_admin === true;
  const isGroupLeader = groupData?.userRole === "leader" || groupData?.userRole === "admin";
  const canAccessSettings = isAdmin || isGroupLeader;

  // Extract available roles from notes
  const availableRoles = useMemo(() => {
    if (!runSheet?.items) return ["All"];

    // Get chip config from group data
    const chipConfig = groupData?.runSheetConfig?.chipConfig;
    const hiddenCategories = new Set(chipConfig?.hidden || []);
    const orderList = chipConfig?.order || [];

    // Collect all roles from item notes
    const roles = new Set<string>();
    runSheet.items.forEach((item) => {
      item.notes.forEach((note) => {
        const normalized = normalizeRoleName(note.category);
        // Skip hidden categories
        if (!hiddenCategories.has(normalized)) {
          roles.add(normalized);
        }
      });
    });

    // Build ordered list: "All" first, then ordered roles, then remaining
    const orderedRoles = ["All"];

    // Add roles in the configured order
    orderList.forEach((role: string) => {
      if (roles.has(role)) {
        orderedRoles.push(role);
        roles.delete(role); // Remove so we don't add again
      }
    });

    // Add any remaining roles (new categories not in order list)
    // Use fallback default order for any not configured
    const defaultOrder = ["Audio", "Video", "Lighting", "Stage", "TD", "SD", "Service Cues"];
    defaultOrder.forEach((role: string) => {
      if (roles.has(role)) {
        orderedRoles.push(role);
        roles.delete(role);
      }
    });

    // Add truly remaining roles alphabetically
    Array.from(roles).sort().forEach((role: string) => {
      orderedRoles.push(role);
    });

    return orderedRoles;
  }, [runSheet?.items, groupData?.runSheetConfig?.chipConfig]);

  // API actions
  const getAvailableServiceTypes = useAuthenticatedAction(
    api.functions.pcoServices.runSheet.getAvailableServiceTypes
  );
  const getRunSheet = useAuthenticatedAction(
    api.functions.pcoServices.runSheet.getRunSheet
  );
  const getOrCreateToolLink = useAuthenticatedMutation(
    api.functions.toolShortLinks.index.getOrCreate
  );

  // Fetch service types on mount (with offline cache fallback)
  const fetchServiceTypes = useCallback(async () => {
    if (!group_id || isExternalMode) return;

    try {
      setError(null);
      const types = await getAvailableServiceTypes({
        groupId: group_id as Id<"groups">,
      });
      setServiceTypes(types || []);
      // Cache the result
      if (types && types.length > 0) {
        cacheServiceTypes(group_id, types);
      }
    } catch (err) {
      console.error("Error fetching service types:", err);
      // Try cache fallback on error (fresh first, then stale/expired)
      const cachedTypes =
        getFreshCachedServiceTypes(group_id) ??
        getStaleCachedServiceTypes(group_id);
      if (cachedTypes && cachedTypes.length > 0) {
        setServiceTypes(cachedTypes);
        setIsStale(true);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load service types");
      }
    }
  }, [
    group_id,
    getAvailableServiceTypes,
    cacheServiceTypes,
    getFreshCachedServiceTypes,
    getStaleCachedServiceTypes,
  ]);

  // Filter service types to only those configured in defaultServiceTypeIds (if set)
  const visibleServiceTypes = useMemo(() => {
    const groupConfig = groupData as { runSheetConfig?: { defaultServiceTypeIds?: string[] } } | null;
    const defaultIds = groupConfig?.runSheetConfig?.defaultServiceTypeIds;
    if (defaultIds && defaultIds.length > 0) {
      const filtered = serviceTypes.filter((t: ServiceType) => defaultIds.includes(t.id));
      // Fall back to all types if none of the configured IDs match
      return filtered.length > 0 ? filtered : serviceTypes;
    }
    return serviceTypes;
  }, [serviceTypes, groupData]);

  // Apply default service type once both serviceTypes and groupData are available
  useEffect(() => {
    if (hasAppliedDefault || visibleServiceTypes.length === 0) return;

    // Offline-friendly fallback: if group query hasn't resolved yet, still select
    // the first service type so cached run sheet data can load.
    if (groupData === undefined) {
      if (!selectedServiceTypeId) {
        setSelectedServiceTypeId(visibleServiceTypes[0].id);
      }
      return;
    }

    if (!selectedServiceTypeId || !visibleServiceTypes.some((t: ServiceType) => t.id === selectedServiceTypeId)) {
      setSelectedServiceTypeId(visibleServiceTypes[0].id);
    }
    setHasAppliedDefault(true);
  }, [visibleServiceTypes, groupData, hasAppliedDefault, selectedServiceTypeId]);

  // Fetch run sheet for selected service type (with offline cache fallback)
  const fetchRunSheet = useCallback(async (options?: { isRefresh?: boolean }) => {
    if (!group_id || !selectedServiceTypeId || isExternalMode) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // Show cached data immediately on initial/service-type-switch loads.
    // Skip during pull-to-refresh to avoid stale banner flashing since
    // cache already matches the currently displayed data.
    const freshCached = getFreshCachedRunSheet(group_id, selectedServiceTypeId);
    const cached = freshCached ?? getStaleCachedRunSheet(group_id, selectedServiceTypeId);
    if (cached && !options?.isRefresh) {
      setRunSheet(cached);
      setIsStale(true);
      setLoading(false);
    }

    try {
      setError(null);
      const result = await getRunSheet({
        groupId: group_id as Id<"groups">,
        serviceTypeId: selectedServiceTypeId,
      });
      setRunSheet(result);
      setIsStale(false);
      // Cache the result
      if (result) {
        cacheRunSheet(group_id, selectedServiceTypeId, result);
      }
    } catch (err) {
      console.error("Error fetching run sheet:", err);
      // If we already showed cached data, keep it with stale indicator
      if (cached) {
        setRunSheet(cached);
        setIsStale(true);
      } else {
        // Check cache one more time as last resort
        const fallback =
          getFreshCachedRunSheet(group_id, selectedServiceTypeId) ??
          getStaleCachedRunSheet(group_id, selectedServiceTypeId);
        if (fallback) {
          setRunSheet(fallback);
          setIsStale(true);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load run sheet");
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    group_id,
    selectedServiceTypeId,
    getRunSheet,
    getFreshCachedRunSheet,
    getStaleCachedRunSheet,
    cacheRunSheet,
  ]);

  // Initial load (skip in external mode)
  useEffect(() => {
    if (!isExternalMode) fetchServiceTypes();
  }, [fetchServiceTypes, isExternalMode]);

  // Fetch run sheet when service type changes (skip in external mode)
  useEffect(() => {
    if (selectedServiceTypeId && !isExternalMode) {
      setLoading(true);
      fetchRunSheet();
    }
  }, [selectedServiceTypeId, fetchRunSheet, isExternalMode]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchServiceTypes().then(() => fetchRunSheet({ isRefresh: true }));
  }, [fetchServiceTypes, fetchRunSheet]);

  // Share run sheet via tool short link
  const handleShareRunSheet = useCallback(async () => {
    if (!group_id) return;
    try {
      const shortId = await getOrCreateToolLink({
        groupId: group_id as Id<"groups">,
        toolType: "runsheet",
      });
      const toolUrl = DOMAIN_CONFIG.toolShareUrl(shortId);

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Copy Link", "Share"],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await Clipboard.setStringAsync(toolUrl);
              Alert.alert("Link Copied", "Run sheet link copied to clipboard.");
            } else if (buttonIndex === 2) {
              await Share.share({
                message: `Run Sheet\n${toolUrl}`,
                url: toolUrl,
              });
            }
          }
        );
      } else {
        await Share.share({ message: `Run Sheet\n${toolUrl}` });
      }
    } catch (err) {
      console.error("[RunSheetScreen] Share error:", err);
      Alert.alert("Error", "Failed to create share link.");
    }
  }, [group_id, getOrCreateToolLink]);

  const toggleItemExpanded = useCallback((itemId: string) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  // Toggle header collapsed state
  const toggleHeaderCollapsed = useCallback((headerId: string) => {
    setCollapsedHeaders((prev) => {
      const next = new Set(prev);
      if (next.has(headerId)) {
        next.delete(headerId);
      } else {
        next.add(headerId);
      }
      return next;
    });
  }, []);

  // Load collapsed headers from AsyncStorage
  useEffect(() => {
    const loadCollapsedState = async () => {
      try {
        const key = `runsheet_collapsed_${group_id}`;
        const saved = await AsyncStorage.getItem(key);
        if (saved) {
          setCollapsedHeaders(new Set(JSON.parse(saved)));
        }
      } catch (error) {
        console.error("Failed to load collapsed state:", error);
      } finally {
        // Mark as loaded even if there was an error or no saved data
        setCollapsedHeadersLoaded(true);
      }
    };
    if (group_id) {
      loadCollapsedState();
    } else {
      // In external mode (no group_id), mark as loaded immediately
      setCollapsedHeadersLoaded(true);
    }
  }, [group_id]);

  // Save collapsed headers to AsyncStorage (only after initial load completes)
  useEffect(() => {
    // Don't save until initial load is complete to avoid race condition
    if (!collapsedHeadersLoaded) return;

    const saveCollapsedState = async () => {
      try {
        const key = `runsheet_collapsed_${group_id}`;
        await AsyncStorage.setItem(key, JSON.stringify(Array.from(collapsedHeaders)));
      } catch (error) {
        console.error("Failed to save collapsed state:", error);
      }
    };
    if (group_id) {
      saveCollapsedState();
    }
  }, [collapsedHeaders, group_id, collapsedHeadersLoaded]);

  // Filter items to hide children of collapsed headers
  // Recompute item start times when a different service time is selected
  const computedItems = useMemo(() => {
    if (!runSheet?.items) return [];

    const serviceTimes = runSheet.serviceTimes ?? [];
    if (serviceTimes.length <= 1) return runSheet.items; // Already computed by backend

    // Find the selected service time
    const selectedTime = selectedServiceTimeId
      ? serviceTimes.find((t) => t.id === selectedServiceTimeId)
      : serviceTimes[0];

    // If it's the default (first) service time, items are already computed
    if (!selectedServiceTimeId || selectedTime?.id === serviceTimes[0]?.id) {
      return runSheet.items;
    }

    const serviceStartTime = selectedTime?.startsAt;
    if (!serviceStartTime) return runSheet.items;

    // Deep-copy items and recompute start times
    const items = runSheet.items.map((item) => ({ ...item }));
    recomputeItemStartTimes(items, serviceStartTime);
    return items;
  }, [runSheet?.items, runSheet?.serviceTimes, selectedServiceTimeId]);

  const visibleItems = useMemo(() => {
    if (!computedItems.length) return [];

    const visible: typeof computedItems = [];
    let isCurrentHeaderCollapsed = false;

    for (const item of computedItems) {
      if (item.type === "header") {
        isCurrentHeaderCollapsed = collapsedHeaders.has(item.id);
        visible.push(item); // Always show headers
      } else {
        // Only show non-header items if current header is not collapsed
        if (!isCurrentHeaderCollapsed) {
          visible.push(item);
        }
      }
    }

    return visible;
  }, [computedItems, collapsedHeaders]);

  // Track current item based on time of day (updates every 30s)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const currentItemId = useMemo(() => {
    if (!computedItems.length) return null;

    // Find the last non-header item whose start time has passed but hasn't ended
    for (let i = computedItems.length - 1; i >= 0; i--) {
      const item = computedItems[i];
      if (item.type === "header" || !item.startsAt) continue;
      const start = new Date(item.startsAt).getTime();
      const end = start + (item.length ?? 0) * 1000;
      if (now >= start && now < end) return item.id;
    }

    // If nothing is currently active, find the next upcoming item
    for (const item of computedItems) {
      if (item.type === "header" || !item.startsAt) continue;
      if (new Date(item.startsAt).getTime() > now) return null;
    }

    return null;
  }, [computedItems, now]);

  // Loading state (skip in external mode — loading is managed by parent)
  if (!isExternalMode && loading && serviceTypes.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={themeColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading run sheet...</Text>
      </View>
    );
  }

  // Error state (skip in external mode)
  if (!isExternalMode && error && serviceTypes.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        <Text style={[styles.hintText, { color: colors.textTertiary }]}>
          Make sure PCO sync is configured for this group.
        </Text>
      </View>
    );
  }

  // No service types configured (skip in external mode)
  if (!isExternalMode && serviceTypes.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.text }]}>No PCO services configured</Text>
        <Text style={[styles.hintText, { color: colors.textTertiary }]}>
          Set up PCO sync channels to see run sheets.
        </Text>
      </View>
    );
  }

  const selectedRoleColor = getRoleColor(selectedRole);

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {/* Drag Indicator - at the very top (hidden in external mode) */}
      {!isExternalMode && <DragHandle />}

      {/* Service Type Tabs (hidden in external mode) */}
      {!isExternalMode && visibleServiceTypes.length > 1 && (
        <View style={[styles.serviceTypeTabs, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.tabsRow}>
              {visibleServiceTypes.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  style={[
                    styles.serviceTab,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    selectedServiceTypeId === type.id && {
                      backgroundColor: themeColor,
                      borderColor: themeColor,
                    },
                  ]}
                  onPress={() => {
                    setSelectedServiceTypeId(type.id);
                    setSelectedServiceTimeId(null); // Reset service time when switching service types
                  }}
                >
                  <Text
                    style={[
                      styles.serviceTabText,
                      { color: colors.textSecondary },
                      selectedServiceTypeId === type.id && styles.serviceTabTextActive,
                    ]}
                  >
                    {type.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {/* Role Selector (with share/settings buttons) */}
      {(availableRoles.length > 1 || canAccessSettings || !readOnly) && (
        <View style={[styles.roleSelector, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <View style={styles.roleSelectorContent}>
            {availableRoles.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rolesScrollView}>
                <View style={styles.rolesRow}>
                  {availableRoles.map((role) => {
                    const roleColor = getRoleColor(role);
                    const isSelected = selectedRole === role;
                    return (
                      <TouchableOpacity
                        key={role}
                        style={[
                          styles.roleChip,
                          {
                            backgroundColor: isSelected ? roleColor : colors.surfaceSecondary,
                            borderColor: roleColor,
                          },
                        ]}
                        onPress={() => setSelectedRole(role)}
                      >
                        <Text
                          style={[
                            styles.roleChipText,
                            { color: isSelected ? "#fff" : roleColor },
                          ]}
                        >
                          {role}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}
            {!readOnly && (
              <Pressable
                style={styles.settingsButton}
                onPress={handleShareRunSheet}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="share-outline" size={22} color={colors.textSecondary} />
              </Pressable>
            )}
            {!readOnly && canAccessSettings && (
              <Pressable
                style={styles.settingsButton}
                onPress={() => router.push(`/(user)/leader-tools/${group_id}/tool-settings/runsheet`)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* Service Time Toggle (when plan has multiple service times) */}
      {runSheet && runSheet.serviceTimes && runSheet.serviceTimes.length > 1 && (
        <View style={[styles.serviceTimeSelector, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          {runSheet.serviceTimes.map((st) => {
            const isSelected = selectedServiceTimeId
              ? st.id === selectedServiceTimeId
              : st.id === runSheet.serviceTimes[0]?.id;
            const label = st.startsAt ? formatCompactTime(st.startsAt) : st.name;
            return (
              <TouchableOpacity
                key={st.id}
                style={[
                  styles.serviceTimeChip,
                  { backgroundColor: colors.surfaceSecondary },
                  isSelected && { backgroundColor: themeColor },
                ]}
                onPress={() => setSelectedServiceTimeId(st.id)}
              >
                <Text
                  style={[
                    styles.serviceTimeChipText,
                    { color: colors.textSecondary },
                    isSelected && { color: "#fff" },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Run Sheet Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={themeColor} />
        </View>
      ) : !runSheet ? (
        <View style={styles.centered}>
          <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No upcoming plans</Text>
          <Text style={[styles.hintText, { color: colors.textTertiary }]}>
            There are no scheduled services for this location.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[themeColor]}
              tintColor={themeColor}
            />
          }
        >
          {/* Stale data indicator */}
          {isStale && (
            <View style={[styles.staleBanner, { backgroundColor: isDark ? '#332b00' : '#fff3cd', borderBottomColor: colors.warning }]}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
              <Text style={[styles.staleBannerText, { color: isDark ? colors.warning : '#856404' }]}>Cached — may not be current</Text>
            </View>
          )}

          {/* Plan Header */}
          <View style={[styles.planHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Text style={[styles.planDate, { color: colors.textSecondary }]}>
              {new Date(runSheet.date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </Text>
            {runSheet.title && (
              <Text style={[styles.planTitle, { color: colors.text }]}>{runSheet.title}</Text>
            )}
            {runSheet.seriesTitle && (
              <Text style={[styles.seriesTitle, { color: colors.textTertiary }]}>{runSheet.seriesTitle}</Text>
            )}
          </View>

          {/* Run Sheet Items */}
          <View style={styles.itemsList}>
            {visibleItems.map((item) => (
              <RunSheetItemRow
                key={item.id}
                item={item}
                selectedRole={selectedRole}
                roleColor={selectedRoleColor}
                themeColor={themeColor}
                isExpanded={expandedItemIds.has(item.id)}
                onToggle={() => toggleItemExpanded(item.id)}
                isCollapsed={collapsedHeaders.has(item.id)}
                onToggleCollapse={() => toggleHeaderCollapsed(item.id)}
                isCurrent={item.id === currentItemId}
              />
            ))}
          </View>

          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Client-side recomputation of item start times for a different service time.
 * Mirrors the backend computeItemStartTimes logic (functions/pcoServices/runSheet.ts).
 *
 * NOTE: This is an intentional duplication of the backend logic. The frontend
 * needs to recompute times locally for instant service time switching without
 * a network round-trip. If the algorithm changes, both copies must be updated.
 * See: apps/convex/functions/pcoServices/runSheet.ts#computeItemStartTimes
 */
function recomputeItemStartTimes(items: RunSheetItem[], serviceStartTime: string): void {
  const serviceStart = new Date(serviceStartTime).getTime();

  const preItems: RunSheetItem[] = [];
  const duringAndPostItems: RunSheetItem[] = [];

  let currentSection: string | null = null;
  for (const item of items) {
    if (item.type === "header") {
      currentSection = item.servicePosition;
    }
    const effectivePosition = item.servicePosition || currentSection;
    if (effectivePosition === "pre") {
      preItems.push(item);
    } else {
      duringAndPostItems.push(item);
    }
  }

  // Pre-service items: count backwards from service start
  let preTime = serviceStart;
  for (let i = preItems.length - 1; i >= 0; i--) {
    if (preItems[i].type === "header") continue;
    preTime -= (preItems[i].length ?? 0) * 1000;
    preItems[i].startsAt = new Date(preTime).toISOString();
  }
  for (let i = 0; i < preItems.length; i++) {
    if (preItems[i].type === "header") {
      for (let j = i + 1; j < preItems.length; j++) {
        if (preItems[j].type !== "header" && preItems[j].startsAt) {
          preItems[i].startsAt = preItems[j].startsAt;
          break;
        }
      }
    }
  }

  // During/post items: accumulate from service start
  let currentTime = serviceStart;
  for (const item of duringAndPostItems) {
    if (item.type === "header") continue;
    item.startsAt = new Date(currentTime).toISOString();
    currentTime += (item.length ?? 0) * 1000;
  }
  for (let i = 0; i < duringAndPostItems.length; i++) {
    if (duringAndPostItems[i].type === "header") {
      for (let j = i + 1; j < duringAndPostItems.length; j++) {
        if (duringAndPostItems[j].type !== "header" && duringAndPostItems[j].startsAt) {
          duringAndPostItems[i].startsAt = duringAndPostItems[j].startsAt;
          break;
        }
      }
    }
  }
}

// Format time as compact "10:00a" / "1:30p" style
function formatCompactTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "p" : "a";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
}

// Get item type badge text
function getItemTypeBadge(type: RunSheetItem["type"]): string | null {
  switch (type) {
    case "song": return "Song";
    case "media": return "Media";
    case "item": return null; // Generic, don't show badge
    case "header": return null;
    default: return null;
  }
}

function RunSheetItemRow({
  item,
  selectedRole,
  roleColor,
  themeColor,
  isExpanded,
  onToggle,
  isCollapsed,
  onToggleCollapse,
  isCurrent,
}: {
  item: RunSheetItem;
  selectedRole: string;
  roleColor: string;
  themeColor: string;
  isExpanded: boolean;
  onToggle: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isCurrent: boolean;
}) {
  const { colors, isDark } = useTheme();
  const isHeader = item.type === "header";

  // Get clock time from computed startsAt
  const clockTime = item.startsAt ? formatCompactTime(item.startsAt) : null;

  // Filter notes by selected role
  const filteredNotes = useMemo(() => {
    if (selectedRole === "All") return item.notes;
    return item.notes.filter((note) => {
      const normalized = normalizeRoleName(note.category);
      return normalized === selectedRole;
    });
  }, [item.notes, selectedRole]);

  // Get notes grouped by role for "All" view
  const notesByRole = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    item.notes.forEach((note) => {
      const role = normalizeRoleName(note.category);
      if (!grouped[role]) grouped[role] = [];
      grouped[role].push(note.content);
    });
    return grouped;
  }, [item.notes]);

  // Section header
  if (isHeader) {
    return (
      <Pressable
        onPress={onToggleCollapse}
        style={[styles.sectionHeader, { backgroundColor: roleColor + "20" }]}
      >
        <View style={styles.sectionHeaderContent}>
          {isCollapsed ? (
            <Ionicons name="chevron-forward" size={18} color={roleColor} />
          ) : (
            <Ionicons name="chevron-down" size={18} color={roleColor} />
          )}
          <Text style={[styles.sectionTitle, { color: roleColor }]}>
            {item.title.toUpperCase()}
          </Text>
        </View>
      </Pressable>
    );
  }

  const hasNotes = filteredNotes.length > 0 || (selectedRole === "All" && item.notes.length > 0);
  const hasDescription = item.description && item.description.trim().length > 0;
  const hasAttachments = item.attachments && item.attachments.length > 0;
  const itemTypeBadge = getItemTypeBadge(item.type);

  // Check if title looks like just a time range (e.g., "7:45-9:00 AM")
  const titleIsTimeRange = /^\d{1,2}:\d{2}/.test(item.title.trim());
  const hasExpandableContent = hasNotes || hasDescription || item.songDetails || hasAttachments;

  return (
    <View
      style={[
        styles.itemRowOuter,
        { backgroundColor: colors.surface },
        isCurrent && { backgroundColor: isDark ? '#2a2700' : '#FFF9E6' },
        // Role note border applied after currentItem so it takes precedence
        hasNotes && { borderLeftColor: roleColor, borderLeftWidth: 4 },
        // If current but no role notes, apply the current item border
        isCurrent && !hasNotes && { borderLeftColor: "#D4A017", borderLeftWidth: 4 },
      ]}
    >
      {/* Pressable header area - only this toggles expand/collapse */}
      <Pressable
        style={styles.itemRow}
        onPress={hasExpandableContent ? onToggle : undefined}
      >
        {/* Time Column */}
        <View style={[styles.timeColumn, { borderRightColor: colors.borderLight }]}>
          {clockTime && (
            <Text style={[styles.clockTime, { color: colors.textSecondary }]}>{clockTime}</Text>
          )}
          {item.length != null && item.length > 0 && (
            <Text style={[styles.duration, { color: colors.textTertiary }]}>{formatDuration(item.length)}</Text>
          )}
        </View>

        {/* Content Column */}
        <View style={styles.contentColumn}>
          {/* Title Row */}
          <View style={styles.titleRow}>
            <View style={styles.titleContent}>
              <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={isExpanded ? undefined : 1}>
                {item.title}
              </Text>
              {/* If title IS a time range, show description inline */}
              {titleIsTimeRange && hasDescription && !isExpanded && (
                <Text style={[styles.inlineDescription, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.description}
                </Text>
              )}
            </View>
            {hasExpandableContent && (
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.textTertiary}
              />
            )}
          </View>

          {/* Item type badge + Song details (key, arrangement) */}
          <View style={styles.metaRow}>
            {itemTypeBadge && (
              <View style={[styles.typeBadge, { backgroundColor: themeColor + "15" }]}>
                <Text style={[styles.typeBadgeText, { color: themeColor }]}>
                  {itemTypeBadge}
                </Text>
              </View>
            )}
            {item.songDetails?.key && (
              <View style={[styles.keyBadge, { backgroundColor: themeColor + "15" }]}>
                <Text style={[styles.keyText, { color: themeColor }]}>
                  {item.songDetails.key}
                </Text>
              </View>
            )}
            {item.songDetails?.arrangement && (
              <Text style={[styles.arrangementText, { color: colors.textSecondary }]}>{item.songDetails.arrangement}</Text>
            )}
          </View>

          {/* Role-specific notes preview */}
          {hasNotes && !isExpanded && (
            <Text style={[styles.notePreview, { color: roleColor }]} numberOfLines={2}>
              {selectedRole === "All"
                ? `${Object.keys(notesByRole).length} role notes`
                : sanitizeNoteContent(filteredNotes[0]?.content || "")}
            </Text>
          )}
        </View>
      </Pressable>

      {/* Expanded content - OUTSIDE Pressable for text selection and link clicking */}
      {isExpanded && (
          <View style={[styles.expandedContent, { borderTopColor: colors.borderLight }]}>
            {/* Description */}
            {hasDescription && (
              <View style={[styles.descriptionBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.descriptionLabel, { color: colors.textTertiary }]}>Description</Text>
                {renderTextWithLinks(item.description!, [styles.descriptionText, { color: colors.text }], themeColor)}
              </View>
            )}

            {/* Song details */}
            {item.songDetails && (
              <View style={[styles.songDetailsBox, { backgroundColor: colors.surfaceSecondary }]}>
                {item.songDetails.key && (
                  <DetailRow label="Key" value={item.songDetails.key} />
                )}
                {item.songDetails.bpm && (
                  <DetailRow label="BPM" value={String(item.songDetails.bpm)} />
                )}
                {item.songDetails.meter && (
                  <DetailRow label="Meter" value={item.songDetails.meter} />
                )}
              </View>
            )}

            {/* Notes - shown BEFORE details and attachments */}
            {selectedRole === "All" ? (
              // Show all notes grouped by role
              Object.entries(notesByRole).map(([role, notes]) => (
                <View
                  key={role}
                  style={[
                    styles.roleNoteBox,
                    { backgroundColor: getRoleColor(role) + "15", borderLeftColor: getRoleColor(role) },
                  ]}
                >
                  <Text style={[styles.roleNoteLabel, { color: getRoleColor(role) }]}>
                    {role}
                  </Text>
                  {notes.map((content, idx) => (
                    <SelectableText key={idx} style={[styles.roleNoteText, { color: colors.text }]}>
                      {sanitizeNoteContent(content)}
                    </SelectableText>
                  ))}
                </View>
              ))
            ) : (
              // Show filtered notes
              filteredNotes.map((note, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.roleNoteBox,
                    { backgroundColor: roleColor + "15", borderLeftColor: roleColor },
                  ]}
                >
                  <SelectableText style={[styles.roleNoteText, { color: colors.text }]}>
                    {sanitizeNoteContent(note.content)}
                  </SelectableText>
                </View>
              ))
            )}

            {/* HTML Details from PCO "Detail" tab - shown AFTER notes */}
            {item.htmlDetails && (
              <View style={[styles.descriptionBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.descriptionLabel, { color: colors.textTertiary }]}>Details</Text>
                {renderTextWithLinks(
                  item.htmlDetails.replace(/<[^>]*>/g, ''),
                  styles.descriptionText,
                  themeColor
                )}
              </View>
            )}

            {/* Attachments/Files - shown AFTER notes and details */}
            {item.attachments && item.attachments.length > 0 && (
              <View style={[styles.attachmentsBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.attachmentsLabel, { color: colors.textSecondary }]}>Files</Text>
                {item.attachments.map((attachment) => (
                  <Pressable
                    key={attachment.id}
                    style={styles.attachmentRow}
                    onPress={() => {
                      const url = attachment.linkedUrl || attachment.url;
                      Linking.openURL(url).catch((err) => {
                        console.error("Failed to open attachment:", err);
                      });
                    }}
                  >
                    <Ionicons name="document-text-outline" size={16} color={themeColor} />
                    <Text style={[styles.attachmentName, { color: themeColor }]} numberOfLines={1}>
                      {attachment.filename}
                    </Text>
                    <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${mins}m`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: "center",
  },
  emptyText: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "600",
  },
  hintText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: "center",
  },

  // Service Type Tabs
  serviceTypeTabs: {
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  tabsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    gap: 8,
  },
  serviceTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  serviceTabText: {
    fontSize: 14,
    fontWeight: "600",
  },
  serviceTabTextActive: {
    color: "#fff",
  },

  // Role Selector
  serviceTimeSelector: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
  },
  serviceTimeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  serviceTimeChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  roleSelector: {
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  roleSelectorContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  rolesScrollView: {
    flex: 1,
  },
  rolesRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    gap: 8,
  },
  settingsButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 2,
  },
  roleChipText: {
    fontSize: 13,
    fontWeight: "700",
  },

  // Stale Banner
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  staleBannerText: {
    fontSize: 13,
    fontWeight: "500",
  },

  // Plan Header
  planHeader: {
    padding: 16,
    borderBottomWidth: 1,
  },
  planDate: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  planTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  seriesTitle: {
    fontSize: 14,
    fontStyle: "italic",
    marginTop: 4,
  },

  // Items List
  itemsList: {
    padding: 8,
  },

  // Section Header
  sectionHeader: {
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
  sectionHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    flex: 1,
  },

  // Item Row - outer container (card styling)
  itemRowOuter: {
    marginHorizontal: 4,
    marginVertical: 3,
    borderRadius: 10,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  currentItem: {
  },
  // Item Row - pressable header (row layout)
  itemRow: {
    flexDirection: "row",
  },

  // Time Column
  timeColumn: {
    width: 52,
    paddingRight: 6,
    borderRightWidth: 1,
    marginRight: 6,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  clockTime: {
    fontSize: 10,
    fontWeight: "500",
    marginTop: 2,
  },
  duration: {
    fontSize: 11,
    marginTop: 1,
  },

  // Content Column
  contentColumn: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },

  // Title content wrapper
  titleContent: {
    flex: 1,
  },
  inlineDescription: {
    fontSize: 13,
    marginTop: 2,
  },

  // Meta row (badges + song info)
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 8,
    flexWrap: "wrap",
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  keyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  keyText: {
    fontSize: 12,
    fontWeight: "700",
  },
  arrangementText: {
    fontSize: 12,
  },

  // Note Preview
  notePreview: {
    fontSize: 12,
    marginTop: 6,
    fontStyle: "italic",
  },

  // Expanded Content
  expandedContent: {
    marginTop: 12,
    marginLeft: 26, // Small indent for visual hierarchy
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },

  // Description Box
  descriptionBox: {
    padding: 10,
    borderRadius: 8,
  },
  descriptionLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Song Details Box
  songDetailsBox: {
    padding: 10,
    borderRadius: 8,
    gap: 4,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  detailLabel: {
    fontSize: 11,
    textTransform: "uppercase",
  },
  detailValue: {
    fontSize: 12,
    fontWeight: "500",
  },

  // Role Note Box
  roleNoteBox: {
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  roleNoteLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  roleNoteText: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Attachments
  attachmentsBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
  },
  attachmentsLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  attachmentName: {
    flex: 1,
    fontSize: 14,
  },
});
