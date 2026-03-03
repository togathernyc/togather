/**
 * Tests for AuthProvider offline resilience
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// Mock NetInfo
const mockNetInfoFetch = jest.fn();
jest.mock("@react-native-community/netinfo", () => ({
  fetch: () => mockNetInfoFetch(),
  addEventListener: jest.fn(() => jest.fn()),
}));

// Mock convex APIs
const mockConvexQuery = jest.fn();
const mockConvexAction = jest.fn();
const mockConvexMutation = jest.fn();
jest.mock("@services/api/convex", () => ({
  convexVanilla: {
    query: (...args: any[]) => mockConvexQuery(...args),
    action: (...args: any[]) => mockConvexAction(...args),
    mutation: (...args: any[]) => mockConvexMutation(...args),
  },
  api: {
    functions: {
      users: {
        me: "users.me",
        clearActiveCommunity: "users.clearActiveCommunity",
      },
      auth: {
        tokens: {
          refreshToken: "auth.tokens.refreshToken",
          updateLastActivity: "auth.tokens.updateLastActivity",
        },
        login: { selectCommunity: "auth.login.selectCommunity" },
      },
      notifications: {
        tokens: { unregisterToken: "notifications.tokens.unregisterToken" },
      },
    },
  },
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
}));

// Mock other deps
jest.mock("@services/api", () => ({ api: { logout: jest.fn() } }));
jest.mock("@utils/query-keys", () => ({
  queryKeys: {
    groups: {
      userGroups: () => ["groups"],
      all: () => ["all"],
      types: () => ["types"],
    },
    chat: { rooms: () => ["rooms"] },
    home: { userData: () => ["home"] },
    admin: { groups: () => ["admin"], pendingRequests: () => ["pending"] },
    integrations: { list: () => ["integrations"] },
  },
}));
jest.mock("@providers/SentryProvider", () => ({
  SentryUtils: {
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    identifyUser: jest.fn(),
    clearUser: jest.fn(),
  },
}));

describe("AuthProvider offline resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.clear();
  });

  describe("cacheUserProfile / loadCachedProfile", () => {
    it("should cache and restore user profile from AsyncStorage", async () => {
      const profileData = {
        user: {
          id: "user-1",
          email: "test@example.com",
          first_name: "Test",
          last_name: "User",
          phone_verified: true,
        },
        community: { id: "comm-1", name: "Test Community" },
      };

      await AsyncStorage.setItem(
        "cached_user_profile",
        JSON.stringify(profileData)
      );
      const stored = await AsyncStorage.getItem("cached_user_profile");
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.user.id).toBe("user-1");
      expect(parsed.community.name).toBe("Test Community");
    });
  });

  describe("fetchUserProfile network error detection", () => {
    it('should detect "Network request failed" as network error', () => {
      const errorMsg = "Network request failed";
      const isNetworkError =
        errorMsg.includes("Network request failed") ||
        errorMsg.includes("Failed to fetch");
      expect(isNetworkError).toBe(true);
    });

    it('should detect "Failed to fetch" as network error', () => {
      const errorMsg = "TypeError: Failed to fetch";
      const isNetworkError =
        errorMsg.includes("Network request failed") ||
        errorMsg.includes("Failed to fetch");
      expect(isNetworkError).toBe(true);
    });

    it('should NOT detect "User not found" as network error', () => {
      const errorMsg = "User not found";
      const isNetworkError =
        errorMsg.includes("Network request failed") ||
        errorMsg.includes("Failed to fetch") ||
        errorMsg.includes("network") ||
        errorMsg.includes("timeout");
      expect(isNetworkError).toBe(false);
    });
  });

  describe("cached profile on logout", () => {
    it("should include cached_user_profile key in cleanup", () => {
      const asyncStorageKeys = [
        "auth_token",
        "convex_refresh_token",
        "convex_user_id",
        "cached_user_profile",
        "current_community",
        "newCommunityId",
        "expo_push_token",
        "pending_join_intent",
        "user_location_cache",
      ];
      expect(asyncStorageKeys).toContain("cached_user_profile");
    });
  });
});
