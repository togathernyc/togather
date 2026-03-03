import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGroupSearch } from "../useGroupSearch";

// Create mock functions that can be controlled per test
const mockUseQuery = jest.fn();

// Mock Convex
jest.mock("convex/react", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
}));

jest.mock("@services/api/convex", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  api: {
    functions: {
      groupSearch: {
        searchGroups: "api.functions.groupSearch.searchGroups",
        searchGroupsWithMembership: "api.functions.groupSearch.searchGroupsWithMembership",
      },
    },
  },
}));

// Mock AuthProvider
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    community: { id: "community123" }, // id is now the Convex ID
    user: null, // Not logged in by default
  }),
}));

describe("useGroupSearch", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    jest.clearAllMocks();

    // Default successful response
    mockUseQuery.mockReturnValue([
      { id: "1", name: "Group 1", groupTypeId: "type1" },
      { id: "2", name: "Group 2", groupTypeId: "type2" },
    ]);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("should fetch all groups when no search query or type filter", async () => {
    const { result } = renderHook(() => useGroupSearch(null), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Convex useQuery is called with the function reference and args
    // Note: null passed as selectedType becomes null in JS (TypeScript cast doesn't change runtime value)
    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupSearch.searchGroups",
      {
        communityId: "community123",
        query: undefined,
        groupTypeId: null,
        limit: 50,
      }
    );
    expect(result.current.groupsList.length).toBe(2);
  });

  it("should fetch groups with type filter when selectedType is provided", async () => {
    const mockGroups = [{ id: "1", name: "Dinner Party Group", groupTypeId: "type1" }];
    mockUseQuery.mockReturnValue(mockGroups);

    const { result } = renderHook(() => useGroupSearch("type1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupSearch.searchGroups",
      {
        communityId: "community123",
        query: undefined,
        groupTypeId: "type1",
        limit: 50,
      }
    );
    expect(result.current.groupsList).toEqual(mockGroups);
  });

  it("should fetch groups with search query", async () => {
    const mockGroups = [{ id: "1", name: "Test Group", groupTypeId: "type1" }];

    const { result } = renderHook(() => useGroupSearch(null), { wrapper });

    // Set search query
    act(() => {
      result.current.setSearchQuery("Test");
    });

    await waitFor(() => {
      expect(result.current.debouncedQuery).toBe("Test");
    });

    // Mock should be called with the debounced query
    // Note: null passed as selectedType becomes null in JS (TypeScript cast doesn't change runtime value)
    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupSearch.searchGroups",
      {
        communityId: "community123",
        query: "Test",
        groupTypeId: null,
        limit: 50,
      }
    );
  });

  it("should combine type filter with search query", async () => {
    const { result } = renderHook(() => useGroupSearch("type1"), { wrapper });

    // Set search query
    act(() => {
      result.current.setSearchQuery("Dinner");
    });

    await waitFor(() => {
      expect(result.current.debouncedQuery).toBe("Dinner");
    });

    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupSearch.searchGroups",
      {
        communityId: "community123",
        query: "Dinner",
        groupTypeId: "type1",
        limit: 50,
      }
    );
  });

  it("should debounce search query", async () => {
    const { result } = renderHook(() => useGroupSearch(null), { wrapper });

    // Set search query multiple times quickly
    act(() => {
      result.current.setSearchQuery("T");
    });
    act(() => {
      result.current.setSearchQuery("Te");
    });
    act(() => {
      result.current.setSearchQuery("Tes");
    });
    act(() => {
      result.current.setSearchQuery("Test");
    });

    // Initially, debouncedQuery should be empty
    expect(result.current.debouncedQuery).toBe("");

    // Wait for debounce
    await waitFor(
      () => {
        expect(result.current.debouncedQuery).toBe("Test");
      },
      { timeout: 1000 }
    );

    // Should have called with final query after debounce
    // Note: null passed as selectedType becomes null in JS (TypeScript cast doesn't change runtime value)
    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupSearch.searchGroups",
      {
        communityId: "community123",
        query: "Test",
        groupTypeId: null,
        limit: 50,
      }
    );
  });

  it("should handle response as direct array", async () => {
    const mockGroups = [{ id: "1", name: "Group 1", groupTypeId: "type1" }];
    mockUseQuery.mockReturnValue(mockGroups);

    const { result } = renderHook(() => useGroupSearch(null), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.groupsList).toEqual(mockGroups);
  });

  it("should return empty array when response is null/undefined", async () => {
    mockUseQuery.mockReturnValue(null);

    const { result } = renderHook(() => useGroupSearch(null), { wrapper });

    await waitFor(() => {
      // When data is null/undefined and debounce is done, isLoading should be false
      expect(result.current.searchQuery).toBe(result.current.debouncedQuery);
    });

    // Note: isLoading is true when groups is undefined (null !== undefined)
    // The hook returns empty array for falsy values
    expect(result.current.groupsList).toEqual([]);
  });
});
