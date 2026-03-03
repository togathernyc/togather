import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { Platform, AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@services/api";
import { convexVanilla, api as convexApi } from "@services/api/convex";
import { queryKeys } from "@utils/query-keys";
import NetInfo from "@react-native-community/netinfo";
import { SentryUtils } from "@providers/SentryProvider";
import { useInboxCache } from "../stores/inboxCache";
import { useMessageCache } from "../stores/messageCache";
import { useGroupCache } from "../stores/groupCache";
import { useChannelsCache } from "../stores/channelsCache";
import { useRunSheetCache } from "../stores/runSheetCache";
import type { User, Community } from "@/types/shared";
import type { Id } from "@services/api/convex";

// ============================================================================
// Constants
// ============================================================================

const AUTH_STORAGE_KEYS = {
  ACCESS_TOKEN: "auth_token",
  REFRESH_TOKEN: "convex_refresh_token",
  USER_ID: "convex_user_id",
  CACHED_PROFILE: "cached_user_profile",
} as const;

// Legacy keys to clean up on logout (for users who have old cached data)
const LEGACY_STORAGE_KEYS = [
  "current_community",
  "newCommunityId",
];

// ============================================================================
// Types
// ============================================================================

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  userId: string;
}

interface AuthContextType {
  user: User | null;
  community: Community | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  token: string | null;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setCommunity: (community: Community) => Promise<void>;
  clearCommunity: () => Promise<void>;
  signIn: (userId: string, tokens?: { accessToken?: string; refreshToken?: string }) => Promise<void>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Store auth tokens in AsyncStorage
 */
async function storeAuthTokens(tokens: AuthTokens): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken),
      tokens.refreshToken
        ? AsyncStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken)
        : AsyncStorage.removeItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN),
      AsyncStorage.setItem(AUTH_STORAGE_KEYS.USER_ID, tokens.userId),
    ]);
    console.log("🔐 AuthProvider: Tokens stored successfully");
  } catch (error) {
    console.error("🔐 AuthProvider: Failed to store tokens:", error);
    throw error;
  }
}

/**
 * Load auth tokens from AsyncStorage
 */
async function loadAuthTokens(): Promise<AuthTokens | null> {
  try {
    const [accessToken, refreshToken, userId] = await Promise.all([
      AsyncStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN),
      AsyncStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN),
      AsyncStorage.getItem(AUTH_STORAGE_KEYS.USER_ID),
    ]);

    if (!accessToken || !userId) {
      return null;
    }

    return {
      accessToken,
      refreshToken: refreshToken || undefined,
      userId,
    };
  } catch (error) {
    console.error("🔐 AuthProvider: Failed to load tokens:", error);
    return null;
  }
}

/**
 * Clear auth tokens from AsyncStorage
 */
async function clearAuthTokens(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN),
      AsyncStorage.removeItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN),
      AsyncStorage.removeItem(AUTH_STORAGE_KEYS.USER_ID),
    ]);
    console.log("🔐 AuthProvider: Tokens cleared");
  } catch (error) {
    console.error("🔐 AuthProvider: Failed to clear tokens:", error);
  }
}

/**
 * Clean up legacy storage keys (community data that's now fetched from server)
 */
async function clearLegacyStorageKeys(): Promise<void> {
  try {
    await Promise.all(
      LEGACY_STORAGE_KEYS.map((key) => AsyncStorage.removeItem(key))
    );
  } catch {
    // Ignore errors - these keys may not exist
  }
}

/**
 * Cache user profile to AsyncStorage for offline restoration
 */
async function cacheUserProfile(data: { user: User; community: Community | null }): Promise<void> {
  try {
    await AsyncStorage.setItem(
      AUTH_STORAGE_KEYS.CACHED_PROFILE,
      JSON.stringify(data)
    );
  } catch (error) {
    console.error("🔐 AuthProvider: Failed to cache user profile:", error);
  }
}

/**
 * Load cached user profile from AsyncStorage
 */
async function loadCachedProfile(): Promise<{ user: User; community: Community | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEYS.CACHED_PROFILE);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error("🔐 AuthProvider: Failed to load cached profile:", error);
    return null;
  }
}

/**
 * Clear cached user profile from AsyncStorage
 */
async function clearCachedProfile(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEYS.CACHED_PROFILE);
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Discriminated Union for fetchUserProfile results
// ============================================================================

type FetchProfileResult =
  | { status: "success"; user: User; community: Community | null }
  | { status: "not_found" }
  | { status: "network_error" };

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================================================
// Provider Component
// ============================================================================

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // State
  const [user, setUser] = useState<User | null>(null);
  const [community, setCommunityState] = useState<Community | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  // Refs to prevent stale closures and infinite loops
  const userRef = useRef<User | null>(null);
  const isRefreshingUserRef = useRef(false);
  const isRefreshingTokensRef = useRef(false);
  const hasInitializedRef = useRef(false);

  /**
   * Fetch user profile from Convex and derive community from the response.
   * Returns a discriminated union so callers can distinguish between
   * "user not found" (server confirmed) and "network error" (can't reach server).
   */
  const fetchUserProfile = useCallback(async (
    userId: string,
    accessToken?: string
  ): Promise<FetchProfileResult> => {
    try {
      console.log("🔐 AuthProvider: Fetching user profile for", userId);

      const tokenToUse = accessToken || await AsyncStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
      if (!tokenToUse) {
        console.log("🔐 AuthProvider: No token available for fetching profile");
        return { status: "not_found" };
      }

      const convexUser = await convexVanilla.query(
        convexApi.functions.users.me,
        { token: tokenToUse }
      );

      if (!convexUser) {
        console.log("🔐 AuthProvider: User not found");
        return { status: "not_found" };
      }

      // Get active community membership
      const activeCommunityMembership = convexUser.communityMemberships?.find(
        (m: any) => m && m.communityId === convexUser.activeCommunityId
      );
      const isAdmin = activeCommunityMembership?.isAdmin ?? false;
      const isPrimaryAdmin = activeCommunityMembership?.isPrimaryAdmin ?? false;

      // Map Convex response to User type
      const profileData: User = {
        id: convexUser.id,
        legacyId: convexUser.legacyId ? Number(convexUser.legacyId) : undefined,
        email: convexUser.email,
        first_name: convexUser.firstName,
        last_name: convexUser.lastName,
        phone: convexUser.phone ?? undefined,
        phone_verified: convexUser.phoneVerified,
        community_id: activeCommunityMembership?.communityId ?? undefined,
        current_community: activeCommunityMembership?.communityId ?? undefined,
        profile_photo: convexUser.profilePhoto ?? undefined,
        is_admin: isAdmin,
        is_primary_admin: isPrimaryAdmin,
        timezone: convexUser.timezone,
        date_of_birth: convexUser.dateOfBirth ?? undefined,
        community_primary_color: convexUser.activeCommunityPrimaryColor ?? undefined,
        community_secondary_color: convexUser.activeCommunitySecondaryColor ?? undefined,
      };

      // Derive community from server response (no caching needed)
      const communityData: Community | null = convexUser.activeCommunityId
        ? {
            id: convexUser.activeCommunityId,
            name: convexUser.activeCommunityName ?? undefined,
          }
        : null;

      console.log("🔐 AuthProvider: User profile fetched", {
        id: profileData.id,
        email: profileData.email,
        communityId: communityData?.id,
      });

      return { status: "success", user: profileData, community: communityData };
    } catch (error) {
      console.error("🔐 AuthProvider: Failed to fetch user profile:", error);

      // Detect network errors vs server errors
      const errorMsg = String(error);
      const isNetworkError =
        errorMsg.includes("Network request failed") ||
        errorMsg.includes("Failed to fetch") ||
        errorMsg.includes("network") ||
        errorMsg.includes("timeout") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("ETIMEDOUT");

      if (isNetworkError) {
        // Check NetInfo imperatively to confirm network is actually down
        // (AuthProvider is above ConnectionProvider, so no hook available)
        try {
          const netState = await NetInfo.fetch();
          if (!netState.isConnected || netState.isInternetReachable === false) {
            return { status: "network_error" };
          }
          // Device is connected but error contained network-like keywords
          // This is likely a server error, not a network issue — treat as not_found
          return { status: "not_found" };
        } catch {
          // If NetInfo itself fails, assume network error
          return { status: "network_error" };
        }
      }

      return { status: "not_found" };
    }
  }, []);

  /**
   * Refresh auth tokens using the refresh token
   * Called on app open/foreground to ensure tokens stay fresh
   * Returns true if refresh succeeded, false otherwise
   */
  const refreshAuthTokens = useCallback(async (communityId?: string): Promise<boolean> => {
    if (isRefreshingTokensRef.current) {
      console.log("🔐 AuthProvider: Token refresh already in progress, skipping");
      return false;
    }

    isRefreshingTokensRef.current = true;
    console.log("🔐 AuthProvider: Refreshing auth tokens...");

    try {
      const tokens = await loadAuthTokens();
      if (!tokens?.refreshToken) {
        console.log("🔐 AuthProvider: No refresh token available");
        return false;
      }

      // Call Convex refresh token action, passing communityId to preserve it in the new token
      const result = await convexVanilla.action(
        convexApi.functions.auth.tokens.refreshToken,
        {
          refreshToken: tokens.refreshToken,
          ...(communityId && { communityId: communityId as Id<"communities"> }),
        }
      );

      if (!result?.access_token) {
        console.error("🔐 AuthProvider: Token refresh returned no access token");
        return false;
      }

      // Store the new tokens
      await storeAuthTokens({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        userId: tokens.userId,
      });

      // Update state
      setToken(result.access_token);

      console.log("🔐 AuthProvider: Tokens refreshed successfully");
      return true;
    } catch (error) {
      console.error("🔐 AuthProvider: Token refresh failed:", error);
      // Log to Sentry for debugging but don't show error to user
      SentryUtils.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { operation: "token_refresh", errorMessage: String(error) }
      );
      return false;
    } finally {
      isRefreshingTokensRef.current = false;
    }
  }, []);

  /**
   * Sign in with user ID and optional tokens
   */
  const signIn = useCallback(async (
    userId: string,
    tokens?: { accessToken?: string; refreshToken?: string }
  ): Promise<void> => {
    console.log("🔐 AuthProvider: signIn called", { userId });

    try {
      const authTokens: AuthTokens = {
        accessToken: tokens?.accessToken || userId,
        refreshToken: tokens?.refreshToken,
        userId,
      };
      await storeAuthTokens(authTokens);
      setToken(authTokens.accessToken);

      const result = await fetchUserProfile(userId, authTokens.accessToken);
      if (result.status === "success") {
        setUser(result.user);
        userRef.current = result.user;
        setCommunityState(result.community);
        await cacheUserProfile({ user: result.user, community: result.community });
        // Clear legacy community storage - user is authenticated, community comes from server
        await clearLegacyStorageKeys();
        // Identify user in Sentry for error tracking
        SentryUtils.identifyUser({
          id: result.user.id,
          email: result.user.email,
          username: result.user.first_name
            ? `${result.user.first_name} ${result.user.last_name || ""}`.trim()
            : undefined,
        });
        console.log("🔐 AuthProvider: Sign in successful");
      } else if (result.status === "network_error") {
        // Network error during sign-in profile fetch — keep tokens, try cached profile
        console.warn("🔐 AuthProvider: Network error during sign-in, keeping tokens");
        const cached = await loadCachedProfile();
        if (cached) {
          setUser(cached.user);
          userRef.current = cached.user;
          setCommunityState(cached.community);
        }
        // Tokens are valid (just obtained from server), don't clear them
      } else {
        console.error("🔐 AuthProvider: Failed to fetch user after sign in");
        throw new Error("Failed to fetch user profile");
      }
    } catch (error) {
      console.error("🔐 AuthProvider: Sign in failed:", error);
      await clearAuthTokens();
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [fetchUserProfile]);

  /**
   * Refresh user data from the server
   */
  const refreshUser = useCallback(async () => {
    if (isRefreshingUserRef.current) {
      console.log("🔐 AuthProvider: refreshUser already in progress, skipping");
      return;
    }

    isRefreshingUserRef.current = true;
    console.log("🔐 AuthProvider: refreshUser started");

    try {
      const tokens = await loadAuthTokens();
      if (!tokens) {
        console.log("🔐 AuthProvider: No tokens found, cannot refresh user");
        return;
      }

      const result = await fetchUserProfile(tokens.userId, tokens.accessToken);
      if (result.status === "success") {
        setUser(result.user);
        userRef.current = result.user;
        setCommunityState(result.community);
        setToken(tokens.accessToken); // Ensure token state is updated
        await cacheUserProfile({ user: result.user, community: result.community });
        console.log("🔐 AuthProvider: User refreshed successfully");
      } else if (result.status === "network_error") {
        // Keep existing session - don't log out on network errors
        console.log("🔐 AuthProvider: Network error during refresh, keeping existing session");
      } else {
        // not_found - user was actually deleted or deactivated
        console.log("🔐 AuthProvider: User not found, clearing auth");
        setUser(null);
        userRef.current = null;
        setCommunityState(null);
        await clearAuthTokens();
        await clearCachedProfile();
      }
    } catch (error) {
      console.error("🔐 AuthProvider: Failed to refresh user:", error);
    } finally {
      isRefreshingUserRef.current = false;
    }
  }, [fetchUserProfile]);

  /**
   * Logout the current user
   */
  const logout = useCallback(async () => {
    console.log("🔐 AuthProvider: Logout started");

    // Unregister push token BEFORE clearing auth
    try {
      const pushToken = await AsyncStorage.getItem("expo_push_token");
      if (pushToken) {
        await convexVanilla.mutation(
          convexApi.functions.notifications.tokens.unregisterToken,
          { token: pushToken }
        );
        console.log("🔐 AuthProvider: Push token unregistered");
      }
    } catch (error) {
      console.warn("🔐 AuthProvider: Failed to unregister push token:", error);
    }

    console.log("🔐 AuthProvider: Clearing local auth state");

    // Clear auth tokens via legacy API
    await api.logout();

    // Clear React Query cache
    queryClient.clear();

    // Clear all AsyncStorage items
    const asyncStorageKeys = [
      AUTH_STORAGE_KEYS.ACCESS_TOKEN,
      AUTH_STORAGE_KEYS.REFRESH_TOKEN,
      AUTH_STORAGE_KEYS.USER_ID,
      AUTH_STORAGE_KEYS.CACHED_PROFILE,
      ...LEGACY_STORAGE_KEYS,
      "expo_push_token",
      "pending_join_intent",
      "user_location_cache",
      "inbox-cache",
      "message-cache",
      "group-cache",
      "channels-cache",
      "runsheet-cache",
    ];

    await Promise.all(
      asyncStorageKeys.map((key) =>
        AsyncStorage.removeItem(key).catch((err) =>
          console.warn(`Failed to remove ${key}:`, err)
        )
      )
    );

    // Clear Zustand in-memory caches (AsyncStorage removal alone doesn't reset them)
    useInboxCache.getState().clear();
    useMessageCache.getState().clearAll();
    useGroupCache.getState().clearAll();
    useChannelsCache.getState().clearAll();
    useRunSheetCache.getState().clearAll();

    // On web, clear localStorage
    if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
      console.log("🔐 AuthProvider: Clearing localStorage for web");
      window.localStorage.clear();
    }

    // Clear React state
    setUser(null);
    setToken(null);
    setCommunityState(null);
    userRef.current = null;

    // Clear user from Sentry
    SentryUtils.clearUser();

    console.log("🔐 AuthProvider: Logout completed");
  }, [queryClient]);

  /**
   * Set the current community (calls server to update activeCommunityId)
   */
  const setCommunity = useCallback(async (communityData: Community) => {
    const currentUser = userRef.current;
    if (!currentUser?.id) {
      console.error("🔐 AuthProvider: Cannot set community - no user");
      return;
    }

    const isCommunityChanging = !community || community.id !== communityData.id;

    try {
      // Get auth token to authenticate the request
      const authToken = await AsyncStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
      if (!authToken) {
        console.error("🔐 AuthProvider: Cannot set community - no auth token");
        return;
      }

      // Update on server (token-authenticated to prevent IDOR)
      const result = await convexVanilla.action(
        convexApi.functions.auth.login.selectCommunity,
        {
          communityId: communityData.id as Id<"communities">,
          token: authToken,
        }
      );

      // Store the new tokens returned by the server (scoped to the new community)
      if (result?.access_token && result?.refresh_token) {
        await AsyncStorage.setItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN, result.access_token);
        await AsyncStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, result.refresh_token);
        setToken(result.access_token);
      }

      // Update local state
      setCommunityState(communityData);

      // Clear cached data when switching communities
      if (isCommunityChanging) {
        console.log("🔄 AuthProvider: Community changed, clearing cached data");

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.groups.userGroups() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.groups.all() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.groups.types() }),
          queryClient.invalidateQueries({ queryKey: ['groups', 'search'], exact: false }),
          queryClient.invalidateQueries({ queryKey: queryKeys.chat.rooms() }),
          queryClient.invalidateQueries({ queryKey: ['chat', 'messages'], exact: false }),
          queryClient.invalidateQueries({ queryKey: queryKeys.home.userData() }),
          queryClient.invalidateQueries({ queryKey: ['home'], exact: false }),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.groups() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingRequests() }),
          queryClient.invalidateQueries({ queryKey: ['leader-tools'], exact: false }),
          queryClient.invalidateQueries({ queryKey: queryKeys.integrations.list() }),
          queryClient.invalidateQueries({ queryKey: [["groups"]], exact: false }),
          queryClient.invalidateQueries({ queryKey: [["chat"]], exact: false }),
          queryClient.invalidateQueries({ queryKey: [["admin"]], exact: false }),
          queryClient.invalidateQueries({ queryKey: [["user"]], exact: false }),
          queryClient.invalidateQueries({ queryKey: ['groupMembers'], exact: false }),
        ]);

        // Refresh user to get updated community data
        await refreshUser();

        console.log("🔄 AuthProvider: Cache cleared for community switch");
      }
    } catch (error) {
      console.error("🔐 AuthProvider: Failed to set community:", error);
      throw error;
    }
  }, [community, queryClient, refreshUser]);

  /**
   * Clear the current community
   */
  const clearCommunity = useCallback(async () => {
    console.log("🔄 AuthProvider: Clearing community context");

    const currentUser = userRef.current;
    if (currentUser?.id && token) {
      try {
        // Clear on server
        await convexVanilla.mutation(
          convexApi.functions.users.clearActiveCommunity,
          { token }
        );
      } catch (error) {
        console.warn("🔐 AuthProvider: Failed to clear community on server:", error);
      }
    }

    setCommunityState(null);

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.userGroups() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.types() }),
      queryClient.invalidateQueries({ queryKey: ['groups', 'search'], exact: false }),
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.rooms() }),
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages'], exact: false }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home.userData() }),
      queryClient.invalidateQueries({ queryKey: ['home'], exact: false }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.groups() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingRequests() }),
      queryClient.invalidateQueries({ queryKey: ['leader-tools'], exact: false }),
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations.list() }),
      queryClient.invalidateQueries({ queryKey: [["groups"]], exact: false }),
      queryClient.invalidateQueries({ queryKey: [["chat"]], exact: false }),
      queryClient.invalidateQueries({ queryKey: [["admin"]], exact: false }),
      queryClient.invalidateQueries({ queryKey: [["user"]], exact: false }),
      queryClient.invalidateQueries({ queryKey: ['groupMembers'], exact: false }),
    ]);

    console.log("🔄 AuthProvider: Community context cleared");
  }, [queryClient, token]);

  /**
   * Initialize auth state on mount
   */
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const initializeAuth = async () => {
      console.log("🔐 AuthProvider: Initializing auth state...");

      try {
        const tokens = await loadAuthTokens();

        if (!tokens) {
          console.log("🔐 AuthProvider: No stored tokens, user not authenticated");
          setIsLoading(false);
          return;
        }

        console.log("🔐 AuthProvider: Found stored tokens...");
        setToken(tokens.accessToken);

        // First, try to fetch user with existing token to get community ID
        let result = await fetchUserProfile(tokens.userId, tokens.accessToken);
        const communityId = result.status === "success" ? result.community?.id : undefined;

        // If we have a refresh token, refresh the tokens with community ID
        if (tokens.refreshToken) {
          console.log("🔐 AuthProvider: Refreshing tokens with communityId:", communityId);
          const refreshed = await refreshAuthTokens(communityId);

          if (refreshed) {
            // Reload tokens after refresh
            const refreshedTokens = await loadAuthTokens();
            if (refreshedTokens) {
              setToken(refreshedTokens.accessToken);
              // Re-fetch user with new token if first fetch failed
              if (result.status !== "success") {
                result = await fetchUserProfile(refreshedTokens.userId, refreshedTokens.accessToken);
              }
            }
          } else if (result.status !== "success") {
            // Both refresh and initial fetch failed
            if (result.status === "network_error") {
              // Network error - try to restore from cache
              console.log("🔐 AuthProvider: Network error during init, restoring from cache");
              const cached = await loadCachedProfile();
              if (cached) {
                setUser(cached.user);
                userRef.current = cached.user;
                setCommunityState(cached.community);
                SentryUtils.identifyUser({
                  id: cached.user.id,
                  email: cached.user.email,
                  username: cached.user.first_name
                    ? `${cached.user.first_name} ${cached.user.last_name || ""}`.trim()
                    : undefined,
                });
                console.log("🔐 AuthProvider: Restored from cached profile (offline)");
                setIsLoading(false);
                return;
              }
              // No cache but network is down — keep tokens for when connectivity returns.
              // The user will be in an offline state but NOT logged out.
              console.log("🔐 AuthProvider: Network error and no cache, keeping tokens for retry");
              setIsLoading(false);
              return;
            }
            // not_found (server confirmed invalid) - clear tokens
            console.log("🔐 AuthProvider: Server confirmed invalid session, clearing tokens");
            SentryUtils.captureMessage(
              "Auth initialization failed: token refresh failed and no valid session",
              "warning",
              { operation: "auth_init" }
            );
            await clearAuthTokens();
            await clearCachedProfile();
            setToken(null);
            setIsLoading(false);
            return;
          }
        }

        if (result.status === "success") {
          setUser(result.user);
          userRef.current = result.user;
          setCommunityState(result.community);
          await cacheUserProfile({ user: result.user, community: result.community });
          // Clear legacy community storage - user is authenticated, community comes from server
          await clearLegacyStorageKeys();
          // Identify user in Sentry for error tracking (session restore)
          SentryUtils.identifyUser({
            id: result.user.id,
            email: result.user.email,
            username: result.user.first_name
              ? `${result.user.first_name} ${result.user.last_name || ""}`.trim()
              : undefined,
          });
          console.log("🔐 AuthProvider: Auth state restored successfully");
        } else if (result.status === "network_error") {
          // Couldn't reach server but also no refresh token - try cache
          const cached = await loadCachedProfile();
          if (cached) {
            setUser(cached.user);
            userRef.current = cached.user;
            setCommunityState(cached.community);
            console.log("🔐 AuthProvider: Restored from cached profile (no refresh token, offline)");
          } else {
            console.log("🔐 AuthProvider: Network error and no cache, keeping tokens for next try");
            // Don't clear tokens - keep them for when network returns
          }
        } else {
          // not_found
          console.log("🔐 AuthProvider: Failed to fetch user after all attempts");
          await clearAuthTokens();
          await clearCachedProfile();
          setToken(null);
        }
      } catch (error) {
        console.error("🔐 AuthProvider: Failed to initialize auth:", error);
        // Check if this is a network error — don't clear tokens for network failures
        const errMsg = String(error);
        const isNetErr =
          errMsg.includes("Network request failed") ||
          errMsg.includes("Failed to fetch") ||
          errMsg.includes("network") ||
          errMsg.includes("timeout") ||
          errMsg.includes("ECONNREFUSED") ||
          errMsg.includes("ETIMEDOUT");
        if (isNetErr) {
          console.log("🔐 AuthProvider: Network error during init catch, keeping tokens");
          // Try to restore from cache
          const cached = await loadCachedProfile();
          if (cached) {
            setUser(cached.user);
            userRef.current = cached.user;
            setCommunityState(cached.community);
            console.log("🔐 AuthProvider: Restored from cached profile in catch block");
          }
        } else {
          // Non-network error — log to Sentry and clear auth
          SentryUtils.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { operation: "auth_init" }
          );
          await clearAuthTokens();
          setToken(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, [fetchUserProfile, refreshAuthTokens]);

  /**
   * Refresh tokens and update last activity when app comes to foreground
   */
  useEffect(() => {
    let previousAppState = AppState.currentState;

    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      // Only refresh when app becomes active from background/inactive state
      const wasInBackground = previousAppState.match(/inactive|background/);
      previousAppState = nextAppState;

      if (nextAppState === "active" && wasInBackground) {
        const tokens = await loadAuthTokens();
        if (!tokens?.refreshToken) {
          return;
        }

        console.log("🔐 AuthProvider: App foregrounded, refreshing tokens...");

        // Refresh tokens first, passing community ID to preserve it in the new token
        const refreshed = await refreshAuthTokens(community?.id);

        if (!refreshed) {
          // Refresh failed - this could be due to network issues or expired refresh token
          // Don't immediately logout as this could be a transient network error
          // The user can continue with their existing session; if their token is truly
          // expired, they'll encounter auth errors on their next action
          console.log("🔐 AuthProvider: Token refresh failed on foreground, continuing with existing session");
          SentryUtils.captureMessage(
            "Token refresh failed on foreground - may be network or token issue",
            "info",
            { operation: "foreground_refresh" }
          );
          // Continue to try updating activity - this will fail gracefully if token is invalid
        }

        // Update last activity with the (potentially new) token
        const currentToken = await AsyncStorage.getItem(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
        if (currentToken) {
          try {
            await convexVanilla.action(
              convexApi.functions.auth.tokens.updateLastActivity,
              { token: currentToken }
            );
            console.log("🔐 AuthProvider: Last activity updated");
          } catch (error) {
            // Silently fail - this is a non-critical operation
            console.debug("🔐 AuthProvider: Failed to update last activity:", error);
          }
        }
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    // Update last activity on initial mount if already active and authenticated
    // This tracks users who open the app fresh (not from background)
    if (AppState.currentState === "active" && token && community?.id) {
      convexVanilla.action(
        convexApi.functions.auth.tokens.updateLastActivity,
        { token }
      ).then(() => {
        console.log("🔐 AuthProvider: Initial last activity updated");
      }).catch((error) => {
        console.debug("🔐 AuthProvider: Failed to update initial last activity:", error);
      });
    }

    return () => {
      subscription.remove();
    };
  }, [refreshAuthTokens, fetchUserProfile, logout, community?.id, token]);

  // Memoize isAuthenticated
  // A user is considered authenticated if we have their profile OR a valid token.
  // Token-only auth happens when offline without a cached profile — the user was
  // previously logged in but we can't reach the server to load their data.
  const isAuthenticated = useMemo(() => {
    const authenticated = !!user || !!token;
    if (__DEV__) {
      console.log("👤 [AuthProvider] isAuthenticated:", authenticated, {
        hasUser: !!user,
        hasToken: !!token,
        userId: user?.id || null,
      });
    }
    return authenticated;
  }, [user, token]);

  // Memoize context value
  const contextValue = useMemo(
    () => ({
      user,
      community,
      isLoading,
      isAuthenticated,
      token,
      logout,
      refreshUser,
      setCommunity,
      clearCommunity,
      signIn,
    }),
    [
      user,
      community,
      isLoading,
      isAuthenticated,
      token,
      logout,
      refreshUser,
      setCommunity,
      clearCommunity,
      signIn,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    if (__DEV__) {
      console.warn(
        "useAuth called outside AuthProvider - returning default values."
      );
    }
    return {
      user: null,
      community: null,
      isLoading: true,
      isAuthenticated: false,
      token: null,
      logout: async () => {
        throw new Error("AuthProvider not available");
      },
      refreshUser: async () => {
        throw new Error("AuthProvider not available");
      },
      setCommunity: async () => {
        throw new Error("AuthProvider not available");
      },
      clearCommunity: async () => {
        throw new Error("AuthProvider not available");
      },
      signIn: async () => {
        throw new Error("AuthProvider not available");
      },
    };
  }
  return context;
}
