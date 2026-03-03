import React from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGroupDetails } from "../useGroupDetails";

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
      groups: {
        index: {
          getById: "api.functions.groups.index.getById",
          getLeaders: "api.functions.groups.index.getLeaders",
        },
      },
      groupMembers: {
        list: "api.functions.groupMembers.list",
        getMemberPreview: "api.functions.groupMembers.getMemberPreview",
      },
    },
  },
}));

// Mock AuthProvider
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

// Mock groupCache store
const mockSetFullGroupData = jest.fn();
const mockGetFullGroupData = jest.fn(() => null);
jest.mock("@/stores/groupCache", () => ({
  useGroupCache: () => ({
    setFullGroupData: mockSetFullGroupData,
    getFullGroupData: mockGetFullGroupData,
  }),
}));

// Create wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe("useGroupDetails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFullGroupData.mockReturnValue(null);
    // Default: return data based on which function is called
    mockUseQuery.mockImplementation((func: string, args: any) => {
      if (args === "skip") return undefined;

      if (func === "api.functions.groups.index.getById") {
        return {
          _id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Test Group",
          description: "Test description",
          groupTypeId: "type1",
          groupTypeName: "Dinner Party",
          groupTypeSlug: "dinner-party",
          userRole: "member",
          isArchived: false,
        };
      }
      if (func === "api.functions.groupMembers.list") {
        return [];
      }
      if (func === "api.functions.groups.index.getLeaders") {
        return [];
      }
      if (func === "api.functions.groupMembers.getMemberPreview") {
        return { members: [], totalCount: 0 };
      }
      return undefined;
    });
  });

  describe("ID detection", () => {
    it("queries Convex with valid ID", async () => {
      const groupId = "550e8400-e29b-41d4-a716-446655440000";

      const { result } = renderHook(() => useGroupDetails(groupId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // Should call getById with the groupId
        expect(mockUseQuery).toHaveBeenCalledWith(
          "api.functions.groups.index.getById",
          expect.objectContaining({ groupId })
        );
      });
    });

    it("skips query when group_id is empty string", async () => {
      const emptyId = "";

      renderHook(() => useGroupDetails(emptyId), {
        wrapper: createWrapper(),
      });

      // Should be called with "skip" for empty string
      expect(mockUseQuery).toHaveBeenCalledWith(
        "api.functions.groups.index.getById",
        "skip"
      );
    });

    it("recognizes various ID formats", async () => {
      const ids = [
        "550e8400-e29b-41d4-a716-446655440000", // UUID format
        "k7d8s9abc123", // Convex ID format
        "abc123", // Short ID
      ];

      for (const id of ids) {
        jest.clearAllMocks();

        renderHook(() => useGroupDetails(id), {
          wrapper: createWrapper(),
        });

        await waitFor(() => {
          expect(mockUseQuery).toHaveBeenCalledWith(
            "api.functions.groups.index.getById",
            expect.objectContaining({ groupId: id })
          );
        });
      }
    });
  });

  describe("Query enablement", () => {
    it("does not execute query when group_id is null", () => {
      renderHook(() => useGroupDetails(null), {
        wrapper: createWrapper(),
      });

      expect(mockUseQuery).toHaveBeenCalledWith(
        "api.functions.groups.index.getById",
        "skip"
      );
    });

    it("does not execute query when group_id is undefined", () => {
      renderHook(() => useGroupDetails(undefined), {
        wrapper: createWrapper(),
      });

      expect(mockUseQuery).toHaveBeenCalledWith(
        "api.functions.groups.index.getById",
        "skip"
      );
    });
  });

  describe("Integration", () => {
    it("handles groups with valid ID", async () => {
      const group = {
        id: "550e8400-e29b-41d4-a716-446655440000",
      };

      const { result } = renderHook(() => useGroupDetails(group.id), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockUseQuery).toHaveBeenCalledWith(
          "api.functions.groups.index.getById",
          expect.objectContaining({ groupId: group.id })
        );
      });
    });

    it("returns data from Convex query", async () => {
      const groupId = "550e8400-e29b-41d4-a716-446655440000";

      const { result } = renderHook(() => useGroupDetails(groupId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // The hook should return the transformed data from the mock
        expect(result.current.data).toBeDefined();
        expect(result.current.data?.name).toBe("Test Group");
      });
    });

    it("fetches members and leaders in addition to group", async () => {
      const groupId = "550e8400-e29b-41d4-a716-446655440000";

      renderHook(() => useGroupDetails(groupId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // Should call all three queries
        expect(mockUseQuery).toHaveBeenCalledWith(
          "api.functions.groups.index.getById",
          expect.objectContaining({ groupId })
        );
        expect(mockUseQuery).toHaveBeenCalledWith(
          "api.functions.groupMembers.list",
          expect.objectContaining({ groupId })
        );
        expect(mockUseQuery).toHaveBeenCalledWith(
          "api.functions.groups.index.getLeaders",
          expect.objectContaining({ groupId })
        );
      });
    });
  });
});
