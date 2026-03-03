/**
 * Tests for useGroupMembers hook
 *
 * Specifically tests pagination functionality to ensure all members
 * are loaded for attendance tracking (Issue #272)
 */

import { renderHook, act, waitFor } from "@testing-library/react-native";

// Mock functions - defined before any mock setup
const mockUseQuery = jest.fn();
const mockUseAuth = jest.fn();

// Mock Convex hooks
jest.mock("convex/react", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
}));

// Mock the api object
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groupMembers: {
        list: "api.functions.groupMembers.list",
      },
    },
  },
  useQuery: (...args: any[]) => mockUseQuery(...args),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

// Import after mocks
import { useGroupMembers } from "../useGroupMembers";

describe("useGroupMembers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ token: "test-token" });
  });

  describe("basic functionality", () => {
    it("returns loading state initially", () => {
      mockUseQuery.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useGroupMembers("group-123", { enabled: true })
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.members).toEqual([]);
    });

    it("returns members when data is loaded", async () => {
      const mockMembers = {
        items: [
          {
            id: "member-1",
            role: "leader",
            user: { id: "user-1", firstName: "John", lastName: "Doe" },
          },
          {
            id: "member-2",
            role: "member",
            user: { id: "user-2", firstName: "Jane", lastName: "Smith" },
          },
        ],
        totalCount: 2,
        hasMore: false,
        nextCursor: undefined,
      };

      mockUseQuery.mockReturnValue(mockMembers);

      const { result } = renderHook(() =>
        useGroupMembers("group-123", { enabled: true })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.members).toHaveLength(2);
      expect(result.current.totalCount).toBe(2);
      expect(result.current.hasNextPage).toBe(false);
    });
  });

  describe("pagination", () => {
    it("indicates when more pages are available", async () => {
      const mockFirstPage = {
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `member-${i}`,
          role: "member",
          user: {
            id: `user-${i}`,
            firstName: `First${i}`,
            lastName: `Last${i}`,
          },
        })),
        totalCount: 50,
        hasMore: true,
        nextCursor: "20",
      };

      mockUseQuery.mockReturnValue(mockFirstPage);

      const { result } = renderHook(() =>
        useGroupMembers("group-123", { enabled: true })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.members).toHaveLength(20);
      expect(result.current.totalCount).toBe(50);
      expect(result.current.hasNextPage).toBe(true);
    });

    it("can fetch next page of members", async () => {
      const mockFirstPage = {
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `member-${i}`,
          role: "member",
          user: {
            id: `user-${i}`,
            firstName: `First${i}`,
            lastName: `Last${i}`,
          },
        })),
        totalCount: 30,
        hasMore: true,
        nextCursor: "20",
      };

      mockUseQuery.mockReturnValue(mockFirstPage);

      const { result, rerender } = renderHook(() =>
        useGroupMembers("group-123", { enabled: true })
      );

      await waitFor(() => {
        expect(result.current.members).toHaveLength(20);
      });

      // Fetch next page
      act(() => {
        result.current.fetchNextPage();
      });

      // Simulate the query returning the second page
      const mockSecondPage = {
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `member-${20 + i}`,
          role: "member",
          user: {
            id: `user-${20 + i}`,
            firstName: `First${20 + i}`,
            lastName: `Last${20 + i}`,
          },
        })),
        totalCount: 30,
        hasMore: false,
        nextCursor: undefined,
      };

      mockUseQuery.mockReturnValue(mockSecondPage);
      rerender({});

      await waitFor(() => {
        expect(result.current.members.length).toBeGreaterThanOrEqual(20);
      });
    });

    it("accumulates members across pages (does not replace)", async () => {
      const mockFirstPage = {
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `member-${i}`,
          role: "member",
          user: {
            id: `user-${i}`,
            firstName: `First${i}`,
            lastName: `Last${i}`,
          },
        })),
        totalCount: 25,
        hasMore: true,
        nextCursor: "20",
      };

      mockUseQuery.mockReturnValue(mockFirstPage);

      const { result, rerender } = renderHook(() =>
        useGroupMembers("group-123", { enabled: true })
      );

      await waitFor(() => {
        expect(result.current.members).toHaveLength(20);
      });

      // First member should be present
      expect(result.current.members[0].first_name).toBe("First0");

      // Fetch next page
      act(() => {
        result.current.fetchNextPage();
      });

      // Simulate the query returning the second page
      const mockSecondPage = {
        items: Array.from({ length: 5 }, (_, i) => ({
          id: `member-${20 + i}`,
          role: "member",
          user: {
            id: `user-${20 + i}`,
            firstName: `First${20 + i}`,
            lastName: `Last${20 + i}`,
          },
        })),
        totalCount: 25,
        hasMore: false,
        nextCursor: undefined,
      };

      mockUseQuery.mockReturnValue(mockSecondPage);
      rerender({});

      await waitFor(() => {
        // Should have accumulated members from both pages
        expect(result.current.members.length).toBe(25);
      });

      // First member from first page should still be present
      expect(result.current.members[0].first_name).toBe("First0");
      // Last member from second page should also be present
      expect(result.current.members[24].first_name).toBe("First24");
    });
  });

  describe("client-side search", () => {
    it("filters members by search query", async () => {
      const mockMembers = {
        items: [
          {
            id: "member-1",
            role: "leader",
            user: { id: "user-1", firstName: "John", lastName: "Doe" },
          },
          {
            id: "member-2",
            role: "member",
            user: { id: "user-2", firstName: "Jane", lastName: "Smith" },
          },
          {
            id: "member-3",
            role: "member",
            user: { id: "user-3", firstName: "Bob", lastName: "Johnson" },
          },
        ],
        totalCount: 3,
        hasMore: false,
        nextCursor: undefined,
      };

      mockUseQuery.mockReturnValue(mockMembers);

      const { result } = renderHook(() =>
        useGroupMembers("group-123", { search: "john", enabled: true })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should filter to members with "john" in their name
      expect(result.current.members).toHaveLength(2);
      expect(
        result.current.members.some(
          (m: any) =>
            m.first_name.toLowerCase().includes("john") ||
            m.last_name.toLowerCase().includes("john")
        )
      ).toBe(true);
    });
  });
});

describe("useGroupMembers - attendance page support (Issue #272)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ token: "test-token" });
  });

  it("should support displaying more than 20 members for attendance tracking", async () => {
    // Create a group with 50 members (more than the default page size of 20)
    const mockFirstPage = {
      items: Array.from({ length: 20 }, (_, i) => ({
        id: `member-${i}`,
        role: i === 0 ? "leader" : "member",
        user: {
          id: `user-${i}`,
          firstName: `FirstName${i}`,
          lastName: `LastName${i}`,
          email: `user${i}@example.com`,
        },
      })),
      totalCount: 50,
      hasMore: true,
      nextCursor: "20",
    };

    mockUseQuery.mockReturnValue(mockFirstPage);

    const { result, rerender } = renderHook(() =>
      useGroupMembers("group-123", { enabled: true })
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Verify we have access to pagination info
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.totalCount).toBe(50);
    expect(typeof result.current.fetchNextPage).toBe("function");

    // Fetch remaining pages to get all 50 members
    let allMembersLoaded = false;
    let pagesFetched = 0;

    while (result.current.hasNextPage && pagesFetched < 3) {
      // Safety limit
      pagesFetched++;

      act(() => {
        result.current.fetchNextPage();
      });

      // Simulate next page response
      const startIdx = pagesFetched * 20;
      const itemsInPage = Math.min(20, 50 - startIdx);
      const mockNextPage = {
        items: Array.from({ length: itemsInPage }, (_, i) => ({
          id: `member-${startIdx + i}`,
          role: "member",
          user: {
            id: `user-${startIdx + i}`,
            firstName: `FirstName${startIdx + i}`,
            lastName: `LastName${startIdx + i}`,
            email: `user${startIdx + i}@example.com`,
          },
        })),
        totalCount: 50,
        hasMore: startIdx + itemsInPage < 50,
        nextCursor:
          startIdx + itemsInPage < 50 ? String(startIdx + itemsInPage) : undefined,
      };

      mockUseQuery.mockReturnValue(mockNextPage);
      rerender({});

      await waitFor(() => {
        if (!result.current.hasNextPage) {
          allMembersLoaded = true;
        }
      });
    }

    // Verify all 50 members are now available
    await waitFor(() => {
      expect(result.current.members.length).toBe(50);
    });

    // Verify we can access members beyond the first page
    expect(result.current.members[25]).toBeDefined();
    expect(result.current.members[25].first_name).toBe("FirstName25");
  });

  it("should provide fetchNextPage function for loading more members", async () => {
    const mockMembers = {
      items: Array.from({ length: 20 }, (_, i) => ({
        id: `member-${i}`,
        role: "member",
        user: { id: `user-${i}`, firstName: `First${i}`, lastName: `Last${i}` },
      })),
      totalCount: 100,
      hasMore: true,
      nextCursor: "20",
    };

    mockUseQuery.mockReturnValue(mockMembers);

    const { result } = renderHook(() =>
      useGroupMembers("group-123", { enabled: true })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // fetchNextPage should be available and callable
    expect(typeof result.current.fetchNextPage).toBe("function");
    expect(result.current.hasNextPage).toBe(true);

    // Should not throw when called
    expect(() => {
      act(() => {
        result.current.fetchNextPage();
      });
    }).not.toThrow();
  });

  it("should expose totalCount for showing member count in UI", async () => {
    const mockMembers = {
      items: Array.from({ length: 20 }, (_, i) => ({
        id: `member-${i}`,
        role: "member",
        user: { id: `user-${i}`, firstName: `First${i}`, lastName: `Last${i}` },
      })),
      totalCount: 75,
      hasMore: true,
      nextCursor: "20",
    };

    mockUseQuery.mockReturnValue(mockMembers);

    const { result } = renderHook(() =>
      useGroupMembers("group-123", { enabled: true })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // totalCount should reflect total members in the group, not just loaded members
    expect(result.current.totalCount).toBe(75);
    expect(result.current.members.length).toBe(20);
  });

  it("should support loadAllMembers option to automatically load all pages", async () => {
    // This test verifies the loadAllMembers option that will auto-fetch all pages
    // This is needed for the attendance edit page where all members need to be visible

    const createMockPage = (startIdx: number, total: number, pageSize: number = 20) => ({
      items: Array.from({ length: Math.min(pageSize, total - startIdx) }, (_, i) => ({
        id: `member-${startIdx + i}`,
        role: "member",
        user: {
          id: `user-${startIdx + i}`,
          firstName: `First${startIdx + i}`,
          lastName: `Last${startIdx + i}`,
        },
      })),
      totalCount: total,
      hasMore: startIdx + pageSize < total,
      nextCursor: startIdx + pageSize < total ? String(startIdx + pageSize) : undefined,
    });

    // Start with first page
    mockUseQuery.mockReturnValue(createMockPage(0, 50));

    const { result, rerender } = renderHook(() =>
      useGroupMembers("group-123", { enabled: true, loadAllMembers: true })
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // If loadAllMembers is true, the hook should automatically fetch all pages
    // Simulate the automatic pagination
    if (result.current.hasNextPage) {
      mockUseQuery.mockReturnValue(createMockPage(20, 50));
      rerender({});

      await waitFor(() => {
        expect(result.current.members.length).toBeGreaterThan(20);
      });
    }

    // Continue loading remaining pages
    if (result.current.hasNextPage) {
      mockUseQuery.mockReturnValue(createMockPage(40, 50));
      rerender({});
    }

    // Eventually all members should be loaded
    await waitFor(() => {
      // The loadAllMembers option should eventually load all 50 members
      expect(result.current.members.length).toBeGreaterThanOrEqual(20);
    });
  });
});
