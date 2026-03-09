/**
 * Tests for MemberSearch component.
 */
import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { MemberSearch } from "../MemberSearch";

// Mock the useMemberSearch hook to avoid tRPC dependency issues
const mockUseMemberSearch = jest.fn();

jest.mock("@hooks/useMemberSearch", () => ({
  useMemberSearch: (options: any) => mockUseMemberSearch(options),
  parseSearchTerms: (query: string): string[] => {
    if (!query || !query.includes(",")) {
      return query.trim() ? [query.trim()] : [];
    }
    return query
      .split(",")
      .map((term: string) => term.trim())
      .filter((term: string) => term.length > 0);
  },
}));

// Mock useCommunityTheme
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
    secondaryColor: "#F5F5F5",
  }),
}));

const mockMembers = [
  {
    user_id: 1,
    first_name: "John",
    last_name: "Doe",
    email: "john@example.com",
    phone: "555-0001",
    profile_photo: null,
    groups_count: 2,
    is_admin: false,
    last_login: "2024-01-01",
    created_at: "2023-01-01",
  },
  {
    user_id: 2,
    first_name: "Jane",
    last_name: "Smith",
    email: "jane@example.com",
    phone: "555-0002",
    profile_photo: "https://example.com/jane.jpg",
    groups_count: 3,
    is_admin: true,
    last_login: "2024-01-02",
    created_at: "2023-02-01",
  },
  {
    user_id: 3,
    first_name: "Bob",
    last_name: "Johnson",
    email: "bob@example.com",
    phone: null,
    profile_photo: null,
    groups_count: 1,
    is_admin: false,
    last_login: null,
    created_at: "2023-03-01",
  },
];

function createMockHookReturn(overrides = {}) {
  return {
    searchQuery: "",
    setSearchQuery: jest.fn(),
    debouncedQuery: "",
    members: [],
    totalCount: 0,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    currentPage: 1,
    isLoading: false,
    isSearching: false,
    isFetchingNextPage: false,
    error: null,
    clearSearch: jest.fn(),
    refetch: jest.fn(),
    reset: jest.fn(),
    ...overrides,
  };
}

describe("MemberSearch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMemberSearch.mockReturnValue(createMockHookReturn());
  });

  it("renders search input with placeholder", () => {
    const { getByPlaceholderText } = render(
      <MemberSearch placeholder="Search members..." />
    );

    expect(getByPlaceholderText("Search members...")).toBeTruthy();
  });

  it("shows loading state while searching", () => {
    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "john",
        isLoading: true,
      })
    );

    const { getByText } = render(<MemberSearch />);

    expect(getByText("Searching...")).toBeTruthy();
  });

  it("displays search results", () => {
    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "john",
        debouncedQuery: "john",
        members: mockMembers,
        totalCount: 3,
      })
    );

    const { getByText } = render(<MemberSearch />);

    expect(getByText("John Doe")).toBeTruthy();
    expect(getByText("Jane Smith")).toBeTruthy();
    expect(getByText("Bob Johnson")).toBeTruthy();
  });

  it("calls onSelect when member is tapped in single mode", () => {
    const onSelect = jest.fn();
    const mockClearSearch = jest.fn();

    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "john",
        debouncedQuery: "john",
        members: mockMembers,
        totalCount: 3,
        clearSearch: mockClearSearch,
      })
    );

    const { getByText } = render(
      <MemberSearch onSelect={onSelect} mode="single" />
    );

    fireEvent.press(getByText("John Doe"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 1,
        first_name: "John",
        last_name: "Doe",
        email: "john@example.com",
      })
    );
    expect(mockClearSearch).toHaveBeenCalled();
  });

  it("limits results when maxResults is specified", () => {
    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "test",
        debouncedQuery: "test",
        members: mockMembers,
        totalCount: 3,
      })
    );

    const { queryByText, getByText } = render(<MemberSearch maxResults={2} />);

    expect(getByText("John Doe")).toBeTruthy();
    expect(getByText("Jane Smith")).toBeTruthy();
    expect(queryByText("Bob Johnson")).toBeNull();
  });

  it("shows result count when showCount is true", () => {
    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "test",
        debouncedQuery: "test",
        members: mockMembers,
        totalCount: 100,
      })
    );

    const { getByText } = render(<MemberSearch showCount />);

    expect(getByText("100 members (showing 3)")).toBeTruthy();
  });

  it("shows empty state when no results found", () => {
    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "nonexistent",
        debouncedQuery: "nonexistent",
        members: [],
        totalCount: 0,
      })
    );

    const { getByText } = render(<MemberSearch showEmptyState />);

    expect(getByText("No members found")).toBeTruthy();
    expect(getByText('No results for "nonexistent"')).toBeTruthy();
  });

  it("shows title and description when showTitle is true", () => {
    const { getByText } = render(
      <MemberSearch
        showTitle
        title="Add Members"
        description="Search for community members"
      />
    );

    expect(getByText("Add Members")).toBeTruthy();
    expect(getByText("Search for community members")).toBeTruthy();
  });

  it("calls setSearchQuery when user types", () => {
    const mockSetSearchQuery = jest.fn();

    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        setSearchQuery: mockSetSearchQuery,
      })
    );

    const { getByPlaceholderText } = render(<MemberSearch />);

    fireEvent.changeText(
      getByPlaceholderText("Search by name, email, or phone..."),
      "test"
    );

    expect(mockSetSearchQuery).toHaveBeenCalledWith("test");
  });

  it("shows member email and phone when available", () => {
    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "john",
        debouncedQuery: "john",
        members: [mockMembers[0]],
        totalCount: 1,
      })
    );

    const { getByText } = render(<MemberSearch />);

    expect(getByText("john@example.com")).toBeTruthy();
    expect(getByText("555-0001")).toBeTruthy();
  });

  it("supports multi-select mode", () => {
    const onMultiSelect = jest.fn();

    mockUseMemberSearch.mockReturnValue(
      createMockHookReturn({
        searchQuery: "test",
        debouncedQuery: "test",
        members: mockMembers,
        totalCount: 3,
      })
    );

    const { getByText } = render(
      <MemberSearch mode="multi" onMultiSelect={onMultiSelect} />
    );

    // Select first member
    fireEvent.press(getByText("John Doe"));

    expect(onMultiSelect).toHaveBeenCalledWith([mockMembers[0]]);
  });

  it("passes options to useMemberSearch hook", () => {
    render(
      <MemberSearch
        debounceMs={500}
        pageSize={10}
        excludeUserIds={[1, 2]}
        groupId="test-group"
        excludeGroupMembersOfGroupId="exclude-group-id"
        minSearchLength={3}
      />
    );

    expect(mockUseMemberSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        debounceMs: 500,
        pageSize: 10,
        excludeUserIds: [1, 2],
        groupId: "test-group",
        excludeGroupMembersOfGroupId: "exclude-group-id",
        minSearchLength: 3,
        enabled: true,
      })
    );
  });

  describe("comma-separated search", () => {
    it("displays results from comma-separated search terms", () => {
      // Simulate results from multi-term search (e.g., "john, jane")
      mockUseMemberSearch.mockReturnValue(
        createMockHookReturn({
          searchQuery: "john@example.com, jane",
          debouncedQuery: "john@example.com, jane",
          members: [mockMembers[0], mockMembers[1]], // John and Jane
          totalCount: 2,
        })
      );

      const { getByText } = render(<MemberSearch />);

      expect(getByText("John Doe")).toBeTruthy();
      expect(getByText("Jane Smith")).toBeTruthy();
    });

    it("handles comma-separated input with setSearchQuery", () => {
      const mockSetSearchQuery = jest.fn();

      mockUseMemberSearch.mockReturnValue(
        createMockHookReturn({
          setSearchQuery: mockSetSearchQuery,
        })
      );

      const { getByPlaceholderText } = render(<MemberSearch />);

      fireEvent.changeText(
        getByPlaceholderText("Search by name, email, or phone..."),
        "john@email.com, jane smith, 555-1234"
      );

      expect(mockSetSearchQuery).toHaveBeenCalledWith(
        "john@email.com, jane smith, 555-1234"
      );
    });

    it("shows results from mixed search types (email, name, phone)", () => {
      mockUseMemberSearch.mockReturnValue(
        createMockHookReturn({
          searchQuery: "john@example.com, Bob Johnson, 555-0002",
          debouncedQuery: "john@example.com, Bob Johnson, 555-0002",
          members: mockMembers, // All three members found
          totalCount: 3,
        })
      );

      const { getByText } = render(<MemberSearch />);

      // All members should be displayed
      expect(getByText("John Doe")).toBeTruthy();
      expect(getByText("Jane Smith")).toBeTruthy();
      expect(getByText("Bob Johnson")).toBeTruthy();
    });

    it("shows empty state when comma-separated search finds no results", () => {
      mockUseMemberSearch.mockReturnValue(
        createMockHookReturn({
          searchQuery: "nonexistent1, nonexistent2",
          debouncedQuery: "nonexistent1, nonexistent2",
          members: [],
          totalCount: 0,
        })
      );

      const { getByText } = render(<MemberSearch showEmptyState />);

      expect(getByText("No members found")).toBeTruthy();
    });

    it("works with multi-select mode for comma-separated results", () => {
      const onMultiSelect = jest.fn();

      mockUseMemberSearch.mockReturnValue(
        createMockHookReturn({
          searchQuery: "john, jane",
          debouncedQuery: "john, jane",
          members: [mockMembers[0], mockMembers[1]],
          totalCount: 2,
        })
      );

      const { getByText } = render(
        <MemberSearch mode="multi" onMultiSelect={onMultiSelect} />
      );

      // Select first member
      fireEvent.press(getByText("John Doe"));
      expect(onMultiSelect).toHaveBeenCalledWith([mockMembers[0]]);

      // Verify Jane is still selectable
      expect(getByText("Jane Smith")).toBeTruthy();
    });
  });
});

