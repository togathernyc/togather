import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/providers/AuthProvider";
import { useSelectCommunity } from "../hooks/useAuth";
import { Environment } from "@/services/environment";
import type { CommunitySearchResult } from "../types";
import { SwipeableCommunityRow } from './SwipeableCommunityRow';
import { LeaveCommunityModal } from './LeaveCommunityModal';
import { useConvex, useAuthenticatedMutation, api, Id, useStoredAuthToken } from '@services/api/convex';
import { Avatar } from '@components/ui/Avatar';
import { useTheme } from '@hooks/useTheme';
import { DOMAIN_CONFIG } from '@togather/shared';

// Check if there's a pending join intent and return the redirect path
async function getPostAuthRedirect(): Promise<string> {
  try {
    const intent = await AsyncStorage.getItem("pending_join_intent");
    if (intent) {
      const parsed = JSON.parse(intent);
      // Check if not expired (30 min)
      if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
        return "/(auth)/join-flow";
      }
      // Clear expired intent
      await AsyncStorage.removeItem("pending_join_intent");
    }
  } catch (e) {
    console.error("Error checking join intent:", e);
  }
  return "/(tabs)/chat";
}

interface Community {
  id: string; // Convex _id is now the primary ID
  legacyId?: number; // Old numeric ID from PostgreSQL
  name: string;
  logo: string | null;
  role: number;
}

export function CommunitySelectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { setCommunity, refreshUser, clearCommunity, community: currentCommunity, signIn } = useAuth();
  const params = useLocalSearchParams<{
    communities?: string;
    phone?: string;
    countryCode?: string;
    otp?: string;
    phoneVerificationToken?: string;
    isNewUser?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    birthday?: string;
    activeCommunityId?: string;
    activeCommunityName?: string;
  }>();

  // Check if this is a new user flow (from user-type screen)
  const isNewUserFlow = params.isNewUser === "true";
  const phone = params.phone || "";
  const countryCode = params.countryCode || "US";
  const otp = params.otp || "";
  const phoneVerificationToken = params.phoneVerificationToken || "";

  // Profile data for new users
  const profileData = {
    firstName: params.firstName || "",
    lastName: params.lastName || "",
    email: params.email || "",
    birthday: params.birthday || "",
  };

  const [isContinuingWithout, setIsContinuingWithout] = useState(false);

  // Parse communities from params
  const [userCommunities, setUserCommunities] = useState<Community[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CommunitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [featuredCommunity, setFeaturedCommunity] = useState<CommunitySearchResult | null>(null);
  const [selectingCommunityId, setSelectingCommunityId] = useState<number | string | null>(null);
  const [error, setError] = useState("");
  const [leavingCommunity, setLeavingCommunity] = useState<{ id: number | string; name: string } | null>(null);
  const [isLeavingCommunity, setIsLeavingCommunity] = useState(false);

  // Convex client for direct queries
  const convex = useConvex();

  // Track auth state for auto-redirect
  const authToken = useStoredAuthToken();
  const hasAutoRedirectedRef = useRef(false);

  // Custom hook for selecting community
  const selectCommunityMutation = useSelectCommunity();

  // Convex mutations
  const clearActiveCommunity = useAuthenticatedMutation(api.functions.users.clearActiveCommunity);
  const leaveCommunity = useAuthenticatedMutation(api.functions.communities.leave);

  // Use communities from params first (passed from sign-in flow to avoid auth timing issues)
  // Fall back to Convex query if no params provided
  useEffect(() => {
    // If communities were passed as params, use them immediately
    if (params.communities) {
      try {
        const parsed = JSON.parse(params.communities);
        // Map to expected format (params may have slightly different structure)
        // Convex data uses _id for the ID field
        const communities: Community[] = parsed
          .filter((c: any): c is NonNullable<typeof c> => c !== null)
          .map((c: any) => ({
            id: c._id || c.id, // Convex ID is now the primary ID
            legacyId: c.legacyId ? Number(c.legacyId) : undefined,
            name: c.name,
            logo: c.logo ?? null,
            role: c.roles ?? c.role ?? 3,
          }));
        setUserCommunities(communities);
        console.log("Using communities from params:", communities.length);
        return;
      } catch (parseErr) {
        console.error("Failed to parse communities from params:", parseErr);
      }
    }

    // No params, try to fetch from Convex (auth may be ready now)
    const fetchUserCommunities = async () => {
      try {
        // Query users.me to get community memberships
        const userData = await convex.query(api.functions.users.me, {});

        if (userData && userData.communityMemberships) {
          // Map Convex memberships to the expected Community format
          const communities: Community[] = userData.communityMemberships
            .filter((m): m is NonNullable<typeof m> => m !== null)
            .map((m: any) => ({
              id: m.communityId, // Convex ID is now the primary ID
              legacyId: m.communityLegacyId ? Number(m.communityLegacyId) : undefined,
              name: m.communityName,
              logo: m.communityLogo ?? null,
              role: m.role,
            }));
          setUserCommunities(communities);
          console.log("Fetched communities from Convex:", communities.length);
        }
      } catch (e) {
        console.error("Failed to fetch user communities:", e);
      }
    };

    fetchUserCommunities();
  }, [convex, params.communities]);

  // Fetch featured community ("Fount") on mount
  useEffect(() => {
    const fetchFeaturedCommunity = async () => {
      try {
        const response = await convex.query(api.functions.resources.communitySearch, { query: "Fount" });
        if (response && response.data && Array.isArray(response.data) && response.data.length > 0) {
          // Find exact match for "Fount" or use first result
          const exactMatch = response.data.find(
            (c: CommunitySearchResult) => c.name.toLowerCase() === "fount"
          );
          setFeaturedCommunity(exactMatch || response.data[0]);
        }
      } catch (err) {
        console.error("Failed to fetch featured community:", err);
      }
    };

    fetchFeaturedCommunity();
  }, [convex]);

  // Auto-redirect for users who have an active community
  // Waits for auth to be fully propagated via AuthProvider, then navigates
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    // Skip if no active community or already redirected
    if (!params.activeCommunityId || hasAutoRedirectedRef.current) {
      return;
    }

    // Wait for auth token to be ready
    if (!authToken) {
      console.log("[CommunitySelection] Waiting for auth token...");
      return;
    }

    // Wait for AuthProvider to finish loading and confirm authentication
    if (authLoading) {
      console.log("[CommunitySelection] Auth loading, waiting...");
      return;
    }

    if (!isAuthenticated) {
      console.log("[CommunitySelection] Not authenticated yet, waiting...");
      // AuthProvider will update when the token propagates
      return;
    }

    console.log("[CommunitySelection] Auth confirmed, auto-redirecting for active community");
    hasAutoRedirectedRef.current = true;

    const performRedirect = async () => {
      try {
        // Set community in context
        await setCommunity({
          id: params.activeCommunityId!, // Convex ID is now the primary ID
          name: params.activeCommunityName || "",
        });

        // Check for join intent
        const redirectPath = await getPostAuthRedirect();
        console.log("[CommunitySelection] Redirecting to:", redirectPath);
        router.replace(redirectPath);
      } catch (err) {
        console.error("[CommunitySelection] Auto-redirect failed:", err);
        hasAutoRedirectedRef.current = false; // Allow retry
      }
    };

    performRedirect();
  }, [params.activeCommunityId, params.activeCommunityName, authToken, isAuthenticated, authLoading, setCommunity, router]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setError("");

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      // Use Convex for community search
      const response = await convex.query(api.functions.resources.communitySearch, { query });
      if (response && response.data && Array.isArray(response.data)) {
        setSearchResults(response.data);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error("Community search error:", err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const isExistingCommunity = (communityId: number | string): boolean => {
    // Compare as strings since Convex IDs are strings
    const idStr = String(communityId);
    return userCommunities.some((c) => String(c.id) === idStr);
  };

  const performCommunitySelection = async (community: Community | CommunitySearchResult) => {
    const communityId = community.id;
    setSelectingCommunityId(communityId);
    setError("");

    try {
      // Check if user is authenticated
      const token = await AsyncStorage.getItem('auth_token');

      if (!token) {
        // User is not authenticated - store community locally and redirect to sign-in
        // The community will be selected after successful sign-in
        await setCommunity({
          id: String(community.id), // Convex ID is now the primary ID
          name: community.name,
          logo: "logo" in community ? community.logo : undefined,
        });

        // Store community ID for post-auth selection
        await AsyncStorage.setItem('pending_community_selection', String(communityId));

        // Redirect to phone sign-in with community context
        router.replace({
          pathname: "/(auth)/sign-in",
          params: { communityId: String(communityId), communityName: community.name }
        });
        return;
      }

      // Use the hook which wraps Convex mutation - uses authenticated user session
      // The communityId is now the Convex ID (primary ID)
      await selectCommunityMutation.mutateAsync({
        communityId: String(community.id),
      });

      // Set the community in auth context (for local state)
      await setCommunity({
        id: String(community.id), // Convex ID is now the primary ID
        name: community.name,
        logo: "logo" in community ? community.logo : undefined,
      });

      // Refresh user data
      await refreshUser();

      // Check for pending join intent and navigate
      const redirectPath = await getPostAuthRedirect();
      router.replace(redirectPath);
    } catch (err: any) {
      console.error("Failed to select community:", err);
      // Extract error message
      let errorMessage = "Failed to select community. Please try again.";
      if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      setSelectingCommunityId(null);
    }
  };

  const performNewUserRegistration = async (community: Community | CommunitySearchResult) => {
    const communityId = community.id;
    setSelectingCommunityId(communityId);
    setError("");

    try {
      // Convert birthday from MM/DD/YYYY to YYYY-MM-DD
      let formattedBirthday = profileData.birthday;
      if (formattedBirthday.includes("/")) {
        const [month, day, year] = formattedBirthday.split("/");
        formattedBirthday = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }

      // Step 1: Register new user via Convex
      const registrationResult = await convex.action(api.functions.auth.registration.registerNewUser, {
        phone,
        countryCode,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        email: profileData.email || undefined,
        otp,
        phoneVerificationToken: phoneVerificationToken || undefined,
        dateOfBirth: formattedBirthday || undefined,
      });

      // Use signIn to properly set auth state (same pattern as login flow)
      // This stores tokens AND sets the token state in AuthProvider
      await signIn(registrationResult.user.id, {
        accessToken: registrationResult.access_token,
        refreshToken: registrationResult.refresh_token,
      });

      // Step 2: Select/join the community (adds user to community)
      // Uses authenticated user session from Convex Auth
      await selectCommunityMutation.mutateAsync({
        communityId: String(communityId),
      });

      // Set community in context
      await setCommunity({
        id: String(community.id), // Convex ID is now the primary ID
        name: community.name,
        logo: "logo" in community ? community.logo : undefined,
      });

      // Refresh user and check for join intent
      await refreshUser();
      const redirectPath = await getPostAuthRedirect();
      router.replace(redirectPath);
    } catch (err: any) {
      console.error("Registration failed:", err);
      let errorMessage = "Registration failed. Please try again.";
      if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      setSelectingCommunityId(null);
    }
  };

  const handleSelectCommunity = async (community: Community | CommunitySearchResult) => {
    // For new users, show confirmation then register and join
    if (isNewUserFlow) {
      Alert.alert(
        "Join Community",
        `You're about to join ${community.name}. Community admins will be notified when you join.`,
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Join",
            onPress: () => performNewUserRegistration(community),
          },
        ]
      );
      return;
    }

    // If user is already a member, switch directly without confirmation
    if (isExistingCommunity(community.id)) {
      performCommunitySelection(community);
      return;
    }

    // Show confirmation dialog for joining a new community
    Alert.alert(
      "Join Community",
      `You're about to join ${community.name}. Community admins will be notified when you join.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Join",
          onPress: () => performCommunitySelection(community),
        },
      ]
    );
  };

  const getRoleName = (role: number) => {
    switch (role) {
      case 1:
        return "Admin";
      case 2:
        return "Leader";
      case 3:
        return "Member";
      default:
        return "Member";
    }
  };

  const handleContinueWithoutCommunity = async () => {
    setIsContinuingWithout(true);
    try {
      // For new users, we need to register them first without a community
      if (isNewUserFlow) {
        // Convert birthday from MM/DD/YYYY to YYYY-MM-DD
        let formattedBirthday = profileData.birthday;
        if (formattedBirthday.includes("/")) {
          const [month, day, year] = formattedBirthday.split("/");
          formattedBirthday = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        }

        // Register without selecting a community via Convex
        const registrationResult = await convex.action(api.functions.auth.registration.registerNewUser, {
          phone,
          countryCode,
          firstName: profileData.firstName,
          lastName: profileData.lastName,
          email: profileData.email || undefined,
          otp,
          phoneVerificationToken: phoneVerificationToken || undefined,
          dateOfBirth: formattedBirthday || undefined,
        });

        // Use signIn to properly set auth state (same pattern as login flow)
        await signIn(registrationResult.user.id, {
          accessToken: registrationResult.access_token,
          refreshToken: registrationResult.refresh_token,
        });
      } else {
        // For existing users, clear the active community in the database
        await clearActiveCommunity({});
      }

      // Clear community context locally (state, ref, storage, and query cache)
      await clearCommunity();

      // Navigate to search tab (ExploreScreen) which handles no-community state gracefully
      router.replace("/(tabs)/search");
    } catch (err: any) {
      console.error("Failed to continue without community:", err);
      setError("Something went wrong. Please try again.");
      setIsContinuingWithout(false);
    }
  };

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: colors.surface }]}
      contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.container}>
        <Text style={[styles.title, { color: colors.text }]}>Select Community</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {userCommunities.length > 0
            ? "Choose a community to continue or search for a new one"
            : "Search for your community to get started"}
        </Text>

        {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

        {/* Featured Communities section - only show if found and user is not already a member */}
        {featuredCommunity && !isExistingCommunity(featuredCommunity.id) && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Featured Communities</Text>
            <TouchableOpacity
              style={[styles.communityItem, { backgroundColor: colors.surface }]}
              onPress={() => handleSelectCommunity(featuredCommunity)}
              disabled={selectingCommunityId !== null}
            >
              <Avatar
                name={featuredCommunity.name}
                imageUrl={featuredCommunity.logo ?? null}
                size={48}
                style={styles.communityAvatar}
              />
              <View style={styles.communityInfo}>
                <Text style={[styles.communityName, { color: colors.text }]}>{featuredCommunity.name}</Text>
                {featuredCommunity.subdomain && (
                  <Text style={[styles.communitySubdomain, { color: colors.textSecondary }]}>
                    {featuredCommunity.subdomain}
                  </Text>
                )}
              </View>
              {selectingCommunityId === featuredCommunity.id ? (
                <ActivityIndicator size="small" color={colors.link} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.iconSecondary} />
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* User's existing communities */}
        {userCommunities.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Communities</Text>
            {userCommunities.map((community) => (
              <SwipeableCommunityRow
                key={community.id}
                community={community}
                onPress={() => handleSelectCommunity(community)}
                onLeavePress={() => setLeavingCommunity({ id: community.id, name: community.name })}
                isCurrentCommunity={currentCommunity ? currentCommunity.id === community.id : false}
                disabled={selectingCommunityId !== null}
              />
            ))}
          </View>
        )}

        {/* Search section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {userCommunities.length > 0 ? "Or Join Another" : "Find Your Community"}
          </Text>
          <View style={[styles.searchContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search communities..."
              placeholderTextColor={colors.inputPlaceholder}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {isSearching && (
              <ActivityIndicator
                size="small"
                color={colors.link}
                style={styles.searchSpinner}
              />
            )}
          </View>

          {/* Search results */}
          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((result) => {
                const resultId = result.id;
                return (
                  <TouchableOpacity
                    key={result.id}
                    style={[styles.communityItem, { backgroundColor: colors.surface }]}
                    onPress={() => handleSelectCommunity(result)}
                    disabled={selectingCommunityId !== null}
                  >
                    <Avatar
                      name={result.name}
                      imageUrl={result.logo ?? null}
                      size={48}
                      style={styles.communityAvatar}
                    />
                    <View style={styles.communityInfo}>
                      <Text style={[styles.communityName, { color: colors.text }]}>{result.name}</Text>
                      {result.subdomain && (
                        <Text style={[styles.communitySubdomain, { color: colors.textSecondary }]}>
                          {result.subdomain}
                        </Text>
                      )}
                    </View>
                    {selectingCommunityId === resultId ? (
                      <ActivityIndicator size="small" color={colors.link} />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color={colors.iconSecondary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
            <Text style={[styles.noResultsText, { color: colors.textSecondary }]}>
              No communities found matching "{searchQuery}"
            </Text>
          )}
        </View>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.borderLight }]}>
          <Text style={[styles.footerHelpText, { color: colors.textSecondary }]}>
            Can't find your community?{" "}
            <Text style={{ color: colors.link, fontWeight: "500" }}>Contact support</Text>
          </Text>

          <TouchableOpacity
            style={[styles.createCommunityButton, { backgroundColor: colors.surfaceSecondary }]}
            onPress={() => {
              const baseUrl = Environment.isStaging() ? "https://staging.togather.nyc" : DOMAIN_CONFIG.landingUrl;
              WebBrowser.openBrowserAsync(`${baseUrl}/onboarding/proposal`);
            }}
          >
            <Text style={[styles.createCommunityButtonText, { color: colors.text }]}>Create a Community</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.continueWithoutContainer}
            onPress={handleContinueWithoutCommunity}
            disabled={isContinuingWithout || selectingCommunityId !== null}
            activeOpacity={0.5}
          >
            {isContinuingWithout ? (
              <ActivityIndicator size="small" color={colors.textTertiary} />
            ) : (
              <Text style={[styles.continueWithoutText, { color: colors.textTertiary }]}>
                Continue without community
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <LeaveCommunityModal
        visible={!!leavingCommunity}
        communityName={leavingCommunity?.name || ''}
        onCancel={() => setLeavingCommunity(null)}
        onConfirm={async () => {
          if (leavingCommunity) {
            setIsLeavingCommunity(true);
            try {
              await leaveCommunity({ communityId: leavingCommunity.id as Id<"communities"> });
              // Remove community from local list
              setUserCommunities(prev => prev.filter(c => c.id !== leavingCommunity.id));
              setLeavingCommunity(null);

              // If user left their current community, they need to select a new one
              // The community list will update, and they can select another
              if (currentCommunity && currentCommunity.id === leavingCommunity.id) {
                // Refresh user to update community list
                await refreshUser();
              }
            } catch (error: any) {
              // Show error message (especially for "last admin" case)
              Alert.alert('Cannot Leave', error.message || 'Failed to leave community');
              setLeavingCommunity(null);
            } finally {
              setIsLeavingCommunity(false);
            }
          }
        }}
        isLoading={isLeavingCommunity}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 20,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  errorText: {
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  communityItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    marginBottom: 8,
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.1)",
      } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  communityAvatar: {
    marginRight: 12,
  },
  communityInfo: {
    flex: 1,
  },
  communityName: {
    fontSize: 16,
    fontWeight: "600",
  },
  communityRole: {
    fontSize: 14,
    marginTop: 2,
  },
  communitySubdomain: {
    fontSize: 14,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
  },
  searchIcon: {
    marginLeft: 16,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 16,
    paddingRight: 16,
    paddingLeft: 12,
    fontSize: 16,
  },
  searchSpinner: {
    marginRight: 16,
  },
  searchResults: {
    marginTop: 12,
  },
  noResultsText: {
    textAlign: "center",
    marginTop: 16,
    fontSize: 14,
  },
  footer: {
    alignItems: "center",
    marginTop: 16,
    paddingTop: 20,
    borderTopWidth: 1,
  },
  footerHelpText: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: "center",
  },
  createCommunityButton: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  createCommunityButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  continueWithoutContainer: {
    marginTop: 16,
    marginBottom: 24,
    paddingVertical: 12,
    alignItems: "center",
  },
  continueWithoutText: {
    fontSize: 13,
    textDecorationLine: "underline",
  },
});
