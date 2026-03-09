import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FlatList } from "react-native";
import { Members } from "@features/leader-tools/components/Members";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery } from "@services/api/convex";

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: jest.fn(),
  })),
  useSegments: jest.fn(() => []),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: jest.fn(() => ({
    primaryColor: "#007AFF",
    secondaryColor: "#5856D6",
  })),
}));

jest.mock("@services/api/convex", () => ({
  useAuthenticatedQuery: jest.fn(),
  api: {
    functions: {
      messaging: {
        channels: {
          listGroupChannels: "listGroupChannels",
          getChannelMembers: "getChannelMembers",
        },
      },
      pcoServices: {
        queries: {
          getAutoChannelConfigByChannel: "getAutoChannelConfigByChannel",
        },
      },
    },
  },
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseAuthenticatedQuery = useAuthenticatedQuery as jest.MockedFunction<typeof useAuthenticatedQuery>;

const mockChannels = [
  {
    _id: "channel-1",
    slug: "general",
    channelType: "main",
    name: "General",
    memberCount: 10,
    isShared: false,
  },
  {
    _id: "channel-2",
    slug: "leaders",
    channelType: "leaders",
    name: "Leaders",
    memberCount: 3,
    isShared: false,
  },
  {
    _id: "channel-3",
    slug: "service",
    channelType: "pco_services",
    name: "Service",
    memberCount: 12,
    isShared: false,
  },
];

const mockChannelMembers = {
  members: [
    {
      id: "member-1",
      userId: "user-1",
      displayName: "John Doe",
      profilePhoto: null,
      role: "owner",
      syncSource: null,
      syncMetadata: null,
    },
    {
      id: "member-2",
      userId: "user-2",
      displayName: "Jane Smith",
      profilePhoto: null,
      role: "member",
      syncSource: null,
      syncMetadata: null,
    },
  ],
  totalCount: 2,
  nextCursor: null,
};

describe("Members", () => {
  let queryClient: QueryClient;
  let channelListResponse: any;

  const mockUser = {
    id: "user-1",
    legacyId: 1,
    email: "test@example.com",
    first_name: "Test",
    last_name: "User",
  };

  const defaultProps = {
    groupId: "group-13",
    onMemberAction: jest.fn(),
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          staleTime: 0,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });

    mockUseAuth.mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      community: null,
      token: "test-token",
      logout: jest.fn(),
      refreshUser: jest.fn(),
      setCommunity: jest.fn(),
      clearCommunity: jest.fn(),
      signIn: jest.fn(),
    });

    channelListResponse = mockChannels;
    mockUseAuthenticatedQuery.mockImplementation((queryFn: any, args: any) => {
      if (args === "skip") return undefined;
      if (queryFn === "listGroupChannels") return channelListResponse as any;
      if (queryFn === "getChannelMembers") return mockChannelMembers as any;
      if (queryFn === "getAutoChannelConfigByChannel") return undefined;
      return undefined;
    });
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <Members {...defaultProps} {...props} />
      </QueryClientProvider>
    );
  };

  it("renders loading state when channels are not loaded", async () => {
    channelListResponse = undefined;

    renderComponent();

    expect(screen.getByText("Loading members...")).toBeTruthy();
  });

  it("displays channel chips", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("General")).toBeTruthy();
      expect(screen.getByText("Leaders")).toBeTruthy();
      expect(screen.getByText("Service")).toBeTruthy();
    });
  });

  it("shows search bar", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search members...")).toBeTruthy();
    });
  });

  it("requests paginated members from backend", async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockUseAuthenticatedQuery).toHaveBeenCalledWith(
        "getChannelMembers",
        expect.objectContaining({
          channelId: "channel-1",
          limit: 50,
        })
      );
    });
  });

  it("loads channel members even when AuthProvider token is null", async () => {
    mockUseAuth.mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      community: null,
      token: null,
      logout: jest.fn(),
      refreshUser: jest.fn(),
      setCommunity: jest.fn(),
      clearCommunity: jest.fn(),
      signIn: jest.fn(),
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Jane Smith")).toBeTruthy();
    });
  });

  it("displays member count", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/2 members/)).toBeTruthy();
    });
  });

  it("shows empty state when no channels exist", async () => {
    channelListResponse = [];

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("No channels found for this group")).toBeTruthy();
    });
  });

  it("switches channel when chip is pressed", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Leaders")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Leaders"));

    // Component should still render without crashing
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search members...")).toBeTruthy();
    });
  });

  it("shows PCO badge for PCO synced channels", async () => {
    // Simulate selecting a PCO channel by returning only PCO channel
    channelListResponse = [mockChannels[2]];

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("PCO Synced")).toBeTruthy();
    });
  });

  it("uses backend member search after debounce", async () => {
    jest.useFakeTimers();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search members...")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText("Search members...");
    fireEvent.changeText(searchInput, "John");

    act(() => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(mockUseAuthenticatedQuery).toHaveBeenCalledWith(
        "getChannelMembers",
        expect.objectContaining({
          channelId: "channel-1",
          search: "John",
        })
      );
    });

    jest.useRealTimers();
  });

  it("loads additional members on scroll", async () => {
    mockUseAuthenticatedQuery.mockImplementation((queryFn: any, args: any) => {
      if (args === "skip") return undefined;
      if (queryFn === "listGroupChannels") return mockChannels as any;
      if (queryFn === "getAutoChannelConfigByChannel") return undefined;
      if (queryFn === "getChannelMembers") {
        if (args?.channelId === "channel-2") {
          return { members: [], totalCount: 0, nextCursor: null } as any;
        }

        if (args?.cursor === "next-cursor-1") {
          return {
            members: [
              ...mockChannelMembers.members,
              {
                id: "member-3",
                userId: "user-3",
                displayName: "New Person",
                profilePhoto: null,
                role: "member",
                syncSource: null,
                syncMetadata: null,
              },
            ],
            totalCount: 3,
            nextCursor: null,
          } as any;
        }

        return {
          ...mockChannelMembers,
          totalCount: 3,
          nextCursor: "next-cursor-1",
        } as any;
      }
      return undefined;
    });

    const rendered = renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Jane Smith")).toBeTruthy();
    });

    const list = rendered.UNSAFE_getByType(FlatList);
    act(() => {
      list.props.onEndReached?.();
    });

    await waitFor(() => {
      expect(screen.getByText("New Person")).toBeTruthy();
    });
  });

  it("filters DM and reach_out channels from chips", async () => {
    channelListResponse = [
      ...mockChannels,
      { _id: "dm-1", slug: "dm-user", channelType: "dm", name: "DM", memberCount: 2 },
      { _id: "ro-1", slug: "reach-out", channelType: "reach_out", name: "Reach Out", memberCount: 5 },
    ];

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("General")).toBeTruthy();
      expect(screen.queryByText("DM")).toBeNull();
      expect(screen.queryByText("Reach Out")).toBeNull();
    });
  });

  it("still allows promote action when leaders channel is unavailable", async () => {
    const onMemberAction = jest.fn();

    // Simulate groups where leaders channel is not available in channel list
    channelListResponse = [mockChannels[0]];

    renderComponent({ onMemberAction, canManageMembers: true });

    await waitFor(() => {
      expect(screen.getByText("Jane Smith")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Jane Smith"));

    await waitFor(() => {
      expect(screen.getByText("Promote to Leader")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Promote to Leader"));

    expect(onMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-2",
        role: "member",
      }),
      "promote"
    );
  });
});
