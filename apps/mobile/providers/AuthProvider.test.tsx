import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { AuthProvider, useAuth } from "@providers/AuthProvider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Create mock functions that can be controlled per test
const mockUsersMeQuery = jest.fn();
const mockAuthSelectCommunityAction = jest.fn();

// Mock Convex API - use factory function to properly mock
jest.mock("@services/api/convex", () => ({
  convexVanilla: {
    query: jest.fn((func: any, args: any) => {
      // Route to appropriate mock based on function reference
      if (func?.name?.includes?.("me") || func === "users.me") {
        return mockUsersMeQuery(args);
      }
      return Promise.resolve(null);
    }),
    mutation: jest.fn(() => Promise.resolve()),
    action: jest.fn((func: any, args: any) => {
      // Route to appropriate mock based on function reference
      if (func?.name?.includes?.("selectCommunity") || func === "auth.selectCommunity") {
        return mockAuthSelectCommunityAction(args);
      }
      return Promise.resolve();
    }),
  },
  api: {
    functions: {
      users: {
        me: "users.me",
      },
      auth: {
        selectCommunity: "auth.selectCommunity",
      },
      notifications: {
        unregisterToken: "notifications.unregisterToken",
      },
    },
  },
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useConvex: jest.fn(),
  useStoredAuthToken: jest.fn(() => null),
}));

// Mock the api object for logout
jest.mock("@services/api", () => ({
  api: {
    logout: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Wrapper component that provides QueryClient
const TestWrapper: React.FC<{
  children: React.ReactNode;
  queryClient: QueryClient;
}> = ({ children, queryClient }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

// Test component that uses auth context
const TestComponent: React.FC<{
  onLoadingChange: (loading: boolean) => void;
}> = ({ onLoadingChange }) => {
  const { isLoading } = useAuth();
  React.useEffect(() => {
    onLoadingChange(isLoading);
  }, [isLoading, onLoadingChange]);
  return null;
};

describe("AuthProvider - Loading State Management", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Default: no stored tokens
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    queryClient.clear();
  });

  it("should set isLoading to false when no tokens are stored", async () => {
    const loadingStates: boolean[] = [];
    const onLoadingChange = (loading: boolean) => {
      loadingStates.push(loading);
    };

    render(
      <TestWrapper queryClient={queryClient}>
        <TestComponent onLoadingChange={onLoadingChange} />
      </TestWrapper>
    );

    // Fast-forward timers and flush promises
    await jest.runAllTimersAsync();

    // After initialization, loading should be false (no tokens = not authenticated)
    await waitFor(() => {
      expect(loadingStates[loadingStates.length - 1]).toBe(false);
    });
  });

  it("should try to fetch user when tokens are stored", async () => {
    // Mock stored tokens
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === "auth_token") return Promise.resolve("test-token");
      if (key === "convex_user_id") return Promise.resolve("user123");
      return Promise.resolve(null);
    });

    // Mock users.me to return null (user not found or session expired)
    mockUsersMeQuery.mockResolvedValue(null);

    render(<TestWrapper queryClient={queryClient}>{null}</TestWrapper>);

    // Fast-forward timers
    jest.advanceTimersByTime(100);
    await jest.runAllTimersAsync();

    // Should have called users.me to fetch the user
    await waitFor(() => {
      expect(mockUsersMeQuery).toHaveBeenCalled();
    });
  });

  it("should restore auth state when valid tokens and user exist", async () => {
    // Mock stored tokens
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === "auth_token") return Promise.resolve("test-token");
      if (key === "convex_user_id") return Promise.resolve("user123");
      return Promise.resolve(null);
    });

    // Mock users.me to return a valid user
    mockUsersMeQuery.mockResolvedValue({
      id: "user123",
      legacyId: "123",
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      phone: "+1234567890",
      phoneVerified: true,
      activeCommunityId: "community1",
      activeCommunityName: "Test Community",
      communityMemberships: [],
    });

    const AuthStateComponent: React.FC<{ onAuthChange: (isAuth: boolean, user: any) => void }> = ({ onAuthChange }) => {
      const { isAuthenticated, user } = useAuth();
      React.useEffect(() => {
        onAuthChange(isAuthenticated, user);
      }, [isAuthenticated, user, onAuthChange]);
      return null;
    };

    let lastIsAuth = false;
    let lastUser: any = null;
    const onAuthChange = (isAuth: boolean, user: any) => {
      lastIsAuth = isAuth;
      lastUser = user;
    };

    render(
      <TestWrapper queryClient={queryClient}>
        <AuthStateComponent onAuthChange={onAuthChange} />
      </TestWrapper>
    );

    // Fast-forward timers
    jest.advanceTimersByTime(100);
    await jest.runAllTimersAsync();

    // Should be authenticated with user data
    await waitFor(() => {
      expect(lastIsAuth).toBe(true);
      expect(lastUser).not.toBeNull();
      expect(lastUser?.first_name).toBe("Test");
    });
  });
});

describe("AuthProvider - Logout Cache Clearing", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Mock AsyncStorage to return no tokens initially
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    // Mock users.me to return null (not authenticated)
    mockUsersMeQuery.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    queryClient.clear();
  });

  it("should clear React Query cache when logout is called", async () => {
    // Test component that calls logout
    const LogoutTestComponent: React.FC = () => {
      const { logout } = useAuth();
      React.useEffect(() => {
        // Call logout after component mounts
        logout();
      }, [logout]);
      return null;
    };

    // Add some data to the query cache before logout
    queryClient.setQueryData(["groups"], [{ id: 1, name: "Test Group" }]);
    queryClient.setQueryData(["user"], { id: 1, name: "Test User" });

    // Verify cache has data
    expect(queryClient.getQueryData(["groups"])).toBeDefined();
    expect(queryClient.getQueryData(["user"])).toBeDefined();

    render(
      <TestWrapper queryClient={queryClient}>
        <LogoutTestComponent />
      </TestWrapper>
    );

    // Fast-forward timers to allow logout to complete
    jest.advanceTimersByTime(1000);
    await jest.runAllTimersAsync();

    // Wait for logout to complete
    const { api } = require("@services/api");
    await waitFor(() => {
      expect(api.logout).toHaveBeenCalled();
    });

    // Verify cache was cleared
    await waitFor(() => {
      expect(queryClient.getQueryData(["groups"])).toBeUndefined();
      expect(queryClient.getQueryData(["user"])).toBeUndefined();
    });

    // Verify token storage was cleared
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("auth_token");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("convex_refresh_token");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("convex_user_id");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("current_community");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("newCommunityId");
  });

  it("should clear all cached queries including groups data", async () => {
    const LogoutTestComponent: React.FC = () => {
      const { logout } = useAuth();
      React.useEffect(() => {
        logout();
      }, [logout]);
      return null;
    };

    // Simulate cached group data from previous user
    queryClient.setQueryData(["my-groups"], [
      { id: 1, name: "Old User Group 1" },
      { id: 2, name: "Old User Group 2" },
    ]);
    queryClient.setQueryData(["group-details", "1"], {
      id: 1,
      name: "Old User Group 1",
      members: [],
    });
    queryClient.setQueryData(["user-profile"], {
      id: 123,
      email: "olduser@example.com",
    });

    // Verify all caches have data
    expect(queryClient.getQueryData(["my-groups"])).toHaveLength(2);
    expect(queryClient.getQueryData(["group-details", "1"])).toBeDefined();
    expect(queryClient.getQueryData(["user-profile"])).toBeDefined();

    render(
      <TestWrapper queryClient={queryClient}>
        <LogoutTestComponent />
      </TestWrapper>
    );

    jest.advanceTimersByTime(1000);
    await jest.runAllTimersAsync();

    const { api } = require("@services/api");
    await waitFor(() => {
      expect(api.logout).toHaveBeenCalled();
    });

    // Verify all caches were cleared
    await waitFor(() => {
      expect(queryClient.getQueryData(["my-groups"])).toBeUndefined();
      expect(queryClient.getQueryData(["group-details", "1"])).toBeUndefined();
      expect(queryClient.getQueryData(["user-profile"])).toBeUndefined();
    });
  });
});

describe("AuthProvider - SignIn functionality", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // No stored tokens initially
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    queryClient.clear();
  });

  it("should store tokens and fetch user on signIn", async () => {
    // Mock users.me to return a valid user
    mockUsersMeQuery.mockResolvedValue({
      id: "user123",
      legacyId: "123",
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      phoneVerified: true,
      communityMemberships: [],
    });

    const SignInTestComponent: React.FC<{ onAuthChange: (isAuth: boolean) => void }> = ({ onAuthChange }) => {
      const { signIn, isAuthenticated, isLoading } = useAuth();
      React.useEffect(() => {
        if (!isLoading) {
          onAuthChange(isAuthenticated);
        }
      }, [isAuthenticated, isLoading, onAuthChange]);

      React.useEffect(() => {
        // Call signIn after initial loading is complete
        if (!isLoading) {
          signIn("user123", { accessToken: "test-token", refreshToken: "refresh-token" });
        }
      }, [isLoading, signIn]);

      return null;
    };

    let lastIsAuth = false;
    const onAuthChange = (isAuth: boolean) => {
      lastIsAuth = isAuth;
    };

    render(
      <TestWrapper queryClient={queryClient}>
        <SignInTestComponent onAuthChange={onAuthChange} />
      </TestWrapper>
    );

    // Fast-forward timers
    jest.advanceTimersByTime(500);
    await jest.runAllTimersAsync();

    // Wait for signIn to complete
    await waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith("auth_token", "test-token");
      expect(AsyncStorage.setItem).toHaveBeenCalledWith("convex_refresh_token", "refresh-token");
      expect(AsyncStorage.setItem).toHaveBeenCalledWith("convex_user_id", "user123");
    });

    // Should be authenticated
    await waitFor(() => {
      expect(lastIsAuth).toBe(true);
    });
  });

  it("should provide token in context after signIn", async () => {
    // Mock users.me to return a valid user
    mockUsersMeQuery.mockResolvedValue({
      id: "user123",
      legacyId: "123",
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      phoneVerified: true,
      communityMemberships: [],
    });

    const TokenTestComponent: React.FC<{ onTokenChange: (token: string | null) => void }> = ({ onTokenChange }) => {
      const { signIn, token, isLoading } = useAuth();
      React.useEffect(() => {
        onTokenChange(token);
      }, [token, onTokenChange]);

      React.useEffect(() => {
        if (!isLoading && token === null) {
          signIn("user123", { accessToken: "my-access-token" });
        }
      }, [isLoading, token, signIn]);

      return null;
    };

    let lastToken: string | null = null;
    const onTokenChange = (token: string | null) => {
      lastToken = token;
    };

    render(
      <TestWrapper queryClient={queryClient}>
        <TokenTestComponent onTokenChange={onTokenChange} />
      </TestWrapper>
    );

    // Fast-forward timers
    jest.advanceTimersByTime(500);
    await jest.runAllTimersAsync();

    // Token should be set
    await waitFor(() => {
      expect(lastToken).toBe("my-access-token");
    });
  });
});
