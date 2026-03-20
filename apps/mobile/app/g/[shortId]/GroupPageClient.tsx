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
import { useLocalSearchParams, useRouter, useSegments } from "expo-router";
import { useQuery, useAuthenticatedMutation, api, Id } from "@services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/providers/AuthProvider";
import { useSelectCommunity } from "@/features/auth/hooks/useAuth";
import { useJoinIntent } from "@/features/auth/hooks/useJoinIntent";
import { useUserData } from "@/features/profile/hooks/useUserData";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppImage } from "@components/ui";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";
import { MembersRow } from "@/features/groups/components/MembersRow";
import { JoinCommunityCard } from "@/features/events/components/JoinCommunityCard";
import { SharedPageTabBar } from "@/features/events/components/SharedPageTabBar";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";

/**
 * Initial group data passed from Server Component
 * This is used for initial hydration before Convex queries kick in
 */
export interface InitialGroupData {
  id: string;
  shortId: string;
  name: string;
  description?: string;
  preview?: string;
  previewFallback?: string;
  memberCount?: number;
  memberPreview?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    profile_photo?: string;
    isLeader: boolean;
  }>;
  communityId?: string;
  communityName?: string;
  communitySubdomain?: string;
  communityLogo?: string;
  city?: string;
  state?: string;
  groupTypeName?: string;
  isPublic?: boolean;
  isOnBreak?: boolean;
  hasAccess?: boolean;
  userRequestStatus?: string;
}

interface GroupPageClientProps {
  initialGroupData?: InitialGroupData | null;
}

/**
 * Group Page Client Component
 *
 * Contains all interactive logic for the group page.
 * Receives initial group data from Server Component for faster first paint.
 * Convex queries will take over for real-time updates.
 */
export default function GroupPageClient({ initialGroupData }: GroupPageClientProps) {
  const { colors } = useTheme();
  const { shortId, source } = useLocalSearchParams<{
    shortId: string;
    source?: string;
  }>();
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, refreshUser, setCommunity, community, user } = useAuth();
  const { setJoinIntent } = useJoinIntent();

  // Check if this is an in-app navigation (vs. shared link)
  const isInAppNavigation = source === "app";

  // Check if we're in the (user) modal group to navigate correctly
  const isInUserGroup = segments[0] === "(user)";
  const [isJoining, setIsJoining] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Load auth token from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem('auth_token').then(setAuthToken);
  }, []);

  // Get user data to check community membership
  const { data: userData, isLoading: isLoadingUser } = useUserData(isAuthenticated);
  const selectCommunityMutation = useSelectCommunity();

  // Fetch group by short ID using Convex
  // This will hydrate with initialGroupData first, then Convex takes over for real-time updates
  const group = useQuery(
    api.functions.groups.queries.getByShortId,
    shortId ? { shortId, token: authToken ?? undefined } : "skip"
  );

  // Use Convex data if available, otherwise fall back to initial data
  const groupData = group ?? (initialGroupData as typeof group);
  const isLoading = group === undefined && !initialGroupData;
  const error = group === null;

  // Join group mutation
  const joinGroupMutation = useAuthenticatedMutation(api.functions.groups.mutations.join);

  // Handle sharing the group
  const handleShare = async () => {
    if (!groupData?.shortId) {
      Alert.alert("Cannot Share", "This group doesn't have a shareable link yet.");
      return;
    }

    const groupUrl = DOMAIN_CONFIG.groupShareUrl(groupData.shortId);
    const groupName = groupData.name || "Group";

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Copy Link", "Share"],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(groupUrl);
            Alert.alert("Link Copied", "Group link has been copied to clipboard.");
          } else if (buttonIndex === 2) {
            await Share.share({
              message: `${groupName}\n${groupUrl}`,
              url: groupUrl,
            });
          }
        }
      );
    } else {
      await Share.share({
        message: `${groupName}\n${groupUrl}`,
      });
    }
  };

  // Store join intent and navigate to auth
  const navigateToAuth = async () => {
    if (groupData?.id) {
      await setJoinIntent(groupData.id as string, groupData.communitySubdomain || "");
    }
    router.push("/(auth)/signin");
  };

  // Handle joining the group
  const handleJoin = async () => {
    if (!groupData?.id || !authToken) {
      // If not authenticated, navigate to sign in with return URL
      navigateToAuth();
      return;
    }

    setIsJoining(true);
    try {
      await joinGroupMutation({
        groupId: groupData.id as Id<"groups">,
      });
      Alert.alert("Joined!", `You've joined ${groupData.name}`, [
        {
          text: "View Group",
          onPress: () => router.push(`/groups/${groupData.id}`),
        },
      ]);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to join group");
    } finally {
      setIsJoining(false);
    }
  };

  // On web, hide back button when there's no navigation history (direct link)
  const showBackButton = Platform.OS !== "web" || router.canGoBack();

  // Handle back navigation
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/search");
    }
  };

  // Check if user is already in the community
  // Use String() conversion to handle both numeric and string IDs
  const isInCommunity = userData?.community_memberships?.some(
    (c: { community_id: string | number }) => String(c.community_id) === String(groupData?.communityId)
  );

  // Determine if user is an admin in the current community
  // Use String() conversion for consistency with numeric/string ID handling
  const currentMembership = userData?.community_memberships?.find(
    (c: { community_id: string | number }) => String(c.community_id) === String(userData?.active_community_id)
  );
  const isAdmin = (currentMembership as { is_admin?: boolean } | undefined)?.is_admin ?? false;
  const hasActiveCommunity = Boolean(userData?.active_community_id);

  // Handle joining community first
  const handleJoinCommunity = async () => {
    if (!groupData?.communityId || !authToken) {
      navigateToAuth();
      return;
    }

    try {
      await selectCommunityMutation.mutateAsync({ communityId: String(groupData.communityId) });
      await refreshUser();
    } catch (error) {
      console.error("Error joining community:", error);
    }
  };

  // ============================================================================
  // Render States
  // ============================================================================

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading group...</Text>
      </SafeAreaView>
    );
  }

  if (error || !groupData) {
    return (
      <SafeAreaView style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.textTertiary} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>Group Not Found</Text>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          This group may have been removed or the link is invalid.
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 100 + insets.bottom },
        ]}
      >
        {/* Header with back button and 3-dots menu (Share Group, Copy Link) */}
        <View style={[styles.header, { paddingTop: insets.top }]}>
          {showBackButton ? (
            <TouchableOpacity style={styles.headerButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <TouchableOpacity style={styles.headerButton} onPress={handleShare}>
            <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Group Image */}
        {groupData.preview ? (
          <AppImage
            source={groupData.preview}
            style={styles.groupImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.groupImage, styles.placeholderImage, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="people" size={64} color={colors.iconSecondary} />
          </View>
        )}

        {/* Group Info */}
        <View style={styles.infoContainer}>
          {/* Group Type Badge */}
          {groupData.groupTypeName && (
            <View style={[styles.typeBadge, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.typeBadgeText, { color: colors.textSecondary }]}>{groupData.groupTypeName}</Text>
            </View>
          )}

          {/* Group Name */}
          <Text style={[styles.groupName, { color: colors.text }]}>{groupData.name}</Text>

          {/* Community Name */}
          {groupData.communityName && (
            <View style={styles.communityRow}>
              {groupData.communityLogo && (
                <AppImage
                  source={groupData.communityLogo}
                  style={styles.communityLogo}
                  resizeMode="cover"
                />
              )}
              <Text style={[styles.communityName, { color: colors.textSecondary }]}>{groupData.communityName}</Text>
            </View>
          )}

          {/* Location */}
          {(groupData.city || groupData.state) && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.locationText, { color: colors.textSecondary }]}>
                {[groupData.city, groupData.state].filter(Boolean).join(", ")}
              </Text>
            </View>
          )}

          {/* Members */}
          {groupData.memberPreview && groupData.memberPreview.length > 0 ? (
            <>
              <MembersRow
                members={groupData.memberPreview.filter(m => !m.isLeader)}
                leaders={groupData.memberPreview.filter(m => m.isLeader)}
                maxVisible={5}
                totalCount={groupData.memberCount}
              />
              {!groupData.isPublic && (
                <View style={[styles.privateBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Ionicons name="lock-closed" size={12} color={colors.textSecondary} />
                  <Text style={[styles.privateText, { color: colors.textSecondary }]}>Private</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.memberRow}>
              <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.memberText, { color: colors.textSecondary }]}>
                {groupData.memberCount} {groupData.memberCount === 1 ? "member" : "members"}
              </Text>
              {!groupData.isPublic && (
                <View style={[styles.privateBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Ionicons name="lock-closed" size={12} color={colors.textSecondary} />
                  <Text style={[styles.privateText, { color: colors.textSecondary }]}>Private</Text>
                </View>
              )}
            </View>
          )}

          {/* Description */}
          {groupData.description && (
            <Text style={[styles.description, { color: colors.text }]}>{groupData.description}</Text>
          )}

          {/* On Break Notice */}
          {groupData.isOnBreak && (
            <View style={styles.onBreakBanner}>
              <Ionicons name="pause-circle-outline" size={20} color="#FF9500" />
              <Text style={styles.onBreakText}>
                This group is currently on a break
              </Text>
            </View>
          )}
        </View>

        {/* Join Community Card for non-members (web only — native has its own navigation) */}
        {Platform.OS === "web" && isAuthenticated && !isInCommunity && groupData.communityId && (
          <View style={styles.joinCommunityContainer}>
            <JoinCommunityCard
              communityLogo={groupData.communityLogo || null}
              communityName={groupData.communityName || "this community"}
              onJoinPress={handleJoinCommunity}
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom Action Button */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16, backgroundColor: colors.surface, borderTopColor: colors.surfaceSecondary }]}>
        {groupData.userRole ? (
          // User is already a member - navigate to full group detail
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push(`/groups/${groupData.id}`)}
          >
            <Text style={styles.primaryButtonText}>Open Group</Text>
          </TouchableOpacity>
        ) : groupData.userRequestStatus === "pending" ? (
          // User has pending request
          <View style={styles.pendingContainer}>
            <Ionicons name="time-outline" size={20} color="#FF9500" />
            <Text style={styles.pendingText}>Request Pending</Text>
          </View>
        ) : !isAuthenticated ? (
          // User is not signed in
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={navigateToAuth}
          >
            <Text style={styles.primaryButtonText}>Sign In to Join</Text>
          </TouchableOpacity>
        ) : !groupData.isPublic ? (
          // Private group - request to join
          <TouchableOpacity
            style={[styles.primaryButton, isJoining && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={isJoining}
          >
            {isJoining ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Request to Join</Text>
            )}
          </TouchableOpacity>
        ) : (
          // Public group - join directly
          <TouchableOpacity
            style={[styles.primaryButton, isJoining && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={isJoining}
          >
            {isJoining ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Join Group</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Tab bar for authenticated users (web only — native has its own tab bar) */}
      {Platform.OS === "web" && isAuthenticated && (
        <SharedPageTabBar
          hasActiveCommunity={hasActiveCommunity}
          isAdmin={isAdmin}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "600",
    marginTop: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 8,
  },
  backButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  groupImage: {
    width: "100%",
    height: 280,
  },
  placeholderImage: {
    justifyContent: "center",
    alignItems: "center",
  },
  infoContainer: {
    padding: 20,
  },
  typeBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  groupName: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  communityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  communityLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  communityName: {
    fontSize: 16,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  locationText: {
    fontSize: 14,
    marginLeft: 6,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  memberText: {
    fontSize: 14,
    marginLeft: 6,
  },
  privateBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  privateText: {
    fontSize: 12,
    marginLeft: 4,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
  },
  onBreakBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  onBreakText: {
    fontSize: 14,
    color: "#E65100",
    marginLeft: 8,
  },
  joinCommunityContainer: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  primaryButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  pendingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF3E0",
    paddingVertical: 16,
    borderRadius: 12,
  },
  pendingText: {
    fontSize: 16,
    color: "#FF9500",
    fontWeight: "600",
    marginLeft: 8,
  },
});
