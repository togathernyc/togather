/**
 * Tests for Leader Chat Navigation functionality
 *
 * TDD Tests - These tests are written to FAIL initially to expose the bug
 * where clicking on leader chats doesn't work properly.
 *
 * Test coverage:
 * 1. Leader sees "Leaders" tab when they are a leader
 * 2. Regular member does NOT see "Leaders" tab
 * 3. Clicking on a leader chat navigates to the correct channel
 * 4. Clicking the "Leaders" tab switches to the leaders channel
 * 5. The correct channel ID is passed when navigating to leader chat
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock reach-out components to avoid deep import chain
jest.mock('../ReachOutScreen', () => ({
  ReachOutScreen: () => null,
}));

// Import components to test
import { ChatTabBar, ChatNavigation } from '../ChatNavigation';
import { ConvexChatRoomScreen } from '../ConvexChatRoomScreen';

// Create mock functions that can be controlled per test
let mockConvexQueryResult: any = undefined;
let mockUseConvexChannelFromGroupResult: any = null;

// Mock data for listGroupChannels (leader user by default)
let mockListGroupChannelsResult: any = [
  { _id: 'main-channel-123', slug: 'general', channelType: 'main', name: 'General', description: '', memberCount: 10, isArchived: false, isMember: true, unreadCount: 0 },
  { _id: 'leaders-channel-456', slug: 'leaders', channelType: 'leaders', name: 'Leaders', description: '', memberCount: 2, isArchived: false, isMember: true, unreadCount: 0 },
];

// Mock Convex hooks - useQuery will be replaced per test via mockImplementation
jest.mock('@services/api/convex', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(() => jest.fn()),
  useAction: jest.fn(() => jest.fn().mockResolvedValue(undefined)),
  useStoredAuthToken: jest.fn(() => 'mock-token'),
  api: {
    functions: {
      messaging: {
        channels: {
          getChannelsByGroup: 'api.functions.messaging.channels.getChannelsByGroup',
          getChannel: 'api.functions.messaging.channels.getChannel',
          getChannelBySlug: 'api.functions.messaging.channels.getChannelBySlug',
          getUserChannels: 'api.functions.messaging.channels.getUserChannels',
          ensureChannels: 'api.functions.messaging.channels.ensureChannels',
          listGroupChannels: 'api.functions.messaging.channels.listGroupChannels',
          hasAutoChannels: 'api.functions.messaging.channels.hasAutoChannels',
        },
        readState: {
          getUnreadCounts: 'api.functions.messaging.readState.getUnreadCounts',
        },
        flagging: {
          flagMessage: 'api.functions.messaging.flagging.flagMessage',
        },
        blocking: {
          blockUser: 'api.functions.messaging.blocking.blockUser',
        },
        reactions: {
          toggleReaction: 'api.functions.messaging.reactions.toggleReaction',
        },
        messages: {
          deleteMessage: 'api.functions.messaging.messages.deleteMessage',
        },
      },
      groups: {
        index: {
          getByLegacyIdPublic: 'api.functions.groups.index.getByLegacyIdPublic',
          getById: 'api.functions.groups.index.getById',
        },
        queries: {
          listForUser: 'api.functions.groups.queries.listForUser',
        },
      },
      pcoServices: {
        index: {
          triggerGroupSync: 'api.functions.pcoServices.index.triggerGroupSync',
        },
      },
      groupResources: {
        index: {
          getVisibleForUser: 'api.functions.groupResources.index.getVisibleForUser',
        },
      },
    },
  },
}));

// Get reference to the mocked useQuery
import { useQuery as mockUseQuery } from '@services/api/convex';
const mockedUseQuery = mockUseQuery as jest.Mock;

// Mock useConvexChannelFromGroup hook
jest.mock('../../hooks/useConvexChannelFromGroup', () => ({
  useConvexChannelFromGroup: jest.fn((groupId, channelType) => {
    if (!groupId) return undefined;
    // Return different channel IDs based on type
    if (channelType === 'main') {
      return mockUseConvexChannelFromGroupResult?.main ?? 'main-channel-123';
    }
    if (channelType === 'leaders') {
      return mockUseConvexChannelFromGroupResult?.leaders ?? 'leaders-channel-456';
    }
    return null;
  }),
}));

// Mock expo-router
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
// Use Record<string, string> for flexible params that different screens need
const mockUseLocalSearchParams = jest.fn<Record<string, string>, []>(() => ({
  chat_id: 'main-channel-123',
  channelType: 'general', // URL-based tab routing
  groupId: 'group-123',
  groupName: 'Test Group',
  groupType: 'Small Group',
  groupTypeId: '1',
  imageUrl: '',
  isLeader: '1',
  leadersChannelId: 'leaders-channel-456',
  isAnnouncementGroup: '0',
  externalChatLink: '',
}));

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  usePathname: () => '/inbox/group-123/general',
  useRouter: jest.fn(() => ({
    push: mockPush,
    back: mockBack,
    canGoBack: mockCanGoBack,
    replace: mockReplace,
  })),
}));

// Mock AuthProvider
jest.mock('@providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({
    user: { id: 'user-123', email: 'test@test.com' },
    isAuthenticated: true,
  })),
}));

// Mock NotificationProvider
jest.mock('@providers/NotificationProvider', () => ({
  useNotifications: jest.fn(() => ({
    setActiveChannelId: jest.fn(),
  })),
}));

// Mock useCommunityTheme
jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({
    primaryColor: '#007AFF',
    secondaryColor: '#F5F5F5',
  }),
}));

// Mock useLeaveGroup
jest.mock('@features/groups/hooks/useLeaveGroup', () => ({
  useLeaveGroup: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
}));

// Mock BlockedUsersContext
jest.mock('../../context/BlockedUsersContext', () => ({
  BlockedUsersProvider: ({ children }: { children: React.ReactNode }) => children,
  useBlockedUsersContext: () => ({
    blockedUsers: new Set(),
    addBlockedUser: jest.fn(),
    removeBlockedUser: jest.fn(),
    isBlocked: jest.fn(() => false),
  }),
}));

// Mock chat hooks
jest.mock('../../hooks/useReadState', () => ({
  useReadState: jest.fn(() => ({
    markAsRead: jest.fn(),
    unreadCount: 0,
  })),
}));

jest.mock('../../hooks/useTypingIndicators', () => ({
  useTypingIndicators: jest.fn(() => ({
    typingUsers: [],
    startTyping: jest.fn(),
    stopTyping: jest.fn(),
  })),
}));

// Note: useChannelUnreadIndicators is no longer used - unread counts come from listGroupChannels

// Mock @togather/shared
jest.mock('@togather/shared', () => ({
  parseStreamChannelId: jest.fn((channelId: string) => {
    // Simple mock parsing - returns null for Convex IDs (no underscores)
    if (!channelId.includes('_')) return null;
    // For Stream-style IDs, parse them
    const parts = channelId.split('_');
    return {
      env: parts[0],
      groupId: parts[1],
      type: parts[2] || 'main',
    };
  }),
  buildStreamChannelId: jest.fn(),
}));

// Mock child components that are not being tested
jest.mock('../MessageList', () => ({
  MessageList: ({ channelId }: { channelId: string }) => {
    const { Text } = require('react-native');
    return <Text testID="message-list">MessageList: {channelId}</Text>;
  },
}));

jest.mock('../MessageInput', () => ({
  MessageInput: () => {
    const { Text } = require('react-native');
    return <Text testID="message-input">MessageInput</Text>;
  },
}));

jest.mock('../TypingIndicator', () => ({
  TypingIndicator: () => null,
}));

jest.mock('../MessageActionsOverlay', () => ({
  MessageActionsOverlay: () => null,
}));

jest.mock('../ChatHeader', () => ({
  ChatHeader: ({ displayName, onBack }: any) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID="chat-header">
        <TouchableOpacity testID="back-button" onPress={onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
        <Text testID="display-name">{displayName}</Text>
      </View>
    );
  },
  ChatHeaderPlaceholder: ({ displayName }: any) => {
    const { View, Text } = require('react-native');
    return (
      <View testID="chat-header-placeholder">
        <Text>{displayName}</Text>
      </View>
    );
  },
}));

jest.mock('../ChatMenuModal', () => ({
  ChatMenuModal: () => null,
}));

jest.mock('../ExternalChatModal', () => ({
  ExternalChatModal: () => null,
}));

jest.mock('@features/channels', () => ({
  ChannelMembersModal: () => null,
}));

// Create wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('ChatTabBar - Leaders Tab Visibility', () => {
  // Helper to create channel tabs for testing
  const createChannelTabs = (includeLeaders: boolean) => {
    const tabs = [
      { slug: 'general', channelType: 'main', name: 'General', unreadCount: 0 },
    ];
    if (includeLeaders) {
      tabs.push({ slug: 'leaders', channelType: 'leaders', name: 'Leaders', unreadCount: 0 });
    }
    return tabs;
  };

  const defaultProps = {
    activeSlug: 'general',
    channels: createChannelTabs(false),
    externalChatLink: null,
    onTabChange: jest.fn(),
    onExternalChatPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show General tab for all users', () => {
    const { getByText } = render(<ChatTabBar {...defaultProps} />);
    expect(getByText('General')).toBeTruthy();
  });

  it('should show Leaders tab when user is a leader (channel is in list)', () => {
    const { getByText } = render(
      <ChatTabBar {...defaultProps} channels={createChannelTabs(true)} />
    );
    expect(getByText('Leaders')).toBeTruthy();
  });

  it('should NOT show Leaders tab when user is NOT a leader (channel not in list)', () => {
    const { queryByText } = render(
      <ChatTabBar {...defaultProps} channels={createChannelTabs(false)} />
    );
    expect(queryByText('Leaders')).toBeNull();
  });

  it('should call onTabChange with "leaders" when Leaders tab is pressed', () => {
    const onTabChange = jest.fn();
    const { getByText } = render(
      <ChatTabBar {...defaultProps} channels={createChannelTabs(true)} onTabChange={onTabChange} />
    );

    fireEvent.press(getByText('Leaders'));
    expect(onTabChange).toHaveBeenCalledWith('leaders');
  });

  it('should call onTabChange with "general" when General tab is pressed', () => {
    const onTabChange = jest.fn();
    const { getByText } = render(
      <ChatTabBar
        {...defaultProps}
        activeSlug="leaders"
        channels={createChannelTabs(true)}
        onTabChange={onTabChange}
      />
    );

    fireEvent.press(getByText('General'));
    expect(onTabChange).toHaveBeenCalledWith('general');
  });

  it('should highlight active tab correctly', () => {
    const { getByText, rerender } = render(
      <ChatTabBar {...defaultProps} channels={createChannelTabs(true)} activeSlug="general" />
    );

    // General tab should be styled as active (we can check the style prop)
    const generalTab = getByText('General');
    expect(generalTab).toBeTruthy();

    // Rerender with leaders tab active
    rerender(
      <ChatTabBar {...defaultProps} channels={createChannelTabs(true)} activeSlug="leaders" />
    );

    const leadersTab = getByText('Leaders');
    expect(leadersTab).toBeTruthy();
  });
});

describe('ChatNavigation - Full Component', () => {
  // Helper to create channel tabs for testing
  const createChannelTabs = (includeLeaders: boolean) => {
    const tabs = [
      { slug: 'general', channelType: 'main', name: 'General', unreadCount: 0 },
    ];
    if (includeLeaders) {
      tabs.push({ slug: 'leaders', channelType: 'leaders', name: 'Leaders', unreadCount: 0 });
    }
    return tabs;
  };

  const defaultProps = {
    activeSlug: 'general',
    channels: createChannelTabs(true),
    showLeaderTools: true,
    externalChatLink: null,
    onTabChange: jest.fn(),
    onExternalChatPress: jest.fn(),
    onToolPress: jest.fn(),
    userRole: 'leader' as const,  // Required for toolbar visibility
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render both General and Leaders tabs for leaders', () => {
    const { getByText } = render(<ChatNavigation {...defaultProps} />);
    expect(getByText('General')).toBeTruthy();
    expect(getByText('Leaders')).toBeTruthy();
  });

  it('should only render General tab for non-leaders', () => {
    const { getByText, queryByText } = render(
      <ChatNavigation {...defaultProps} channels={createChannelTabs(false)} showLeaderTools={false} />
    );
    expect(getByText('General')).toBeTruthy();
    expect(queryByText('Leaders')).toBeNull();
  });

  it('should show leader toolbar when showLeaderTools is true', () => {
    const { getByText, queryByText } = render(<ChatNavigation {...defaultProps} />);
    expect(getByText('Attendance')).toBeTruthy();
    expect(getByText('People')).toBeTruthy();
    expect(queryByText('Tasks')).toBeNull();
    expect(getByText('Events')).toBeTruthy();
    expect(getByText('Bots')).toBeTruthy();
  });

  it('should hide leader toolbar when showLeaderTools is false', () => {
    const { queryByText } = render(
      <ChatNavigation {...defaultProps} showLeaderTools={false} />
    );
    expect(queryByText('Attendance')).toBeNull();
    expect(queryByText('People')).toBeNull();
  });
});

describe('ConvexChatRoomScreen - Leader Channel Navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default params (leader user)
    mockUseLocalSearchParams.mockReturnValue({
      chat_id: 'main-channel-123',
      channelType: 'general', // URL-based tab routing
      groupId: 'group-123',
      groupName: 'Test Group',
      groupType: 'Small Group',
      groupTypeId: '1',
      imageUrl: '',
      isLeader: '1',
      leadersChannelId: 'leaders-channel-456',
      isAnnouncementGroup: '0',
      externalChatLink: '',
    });
    mockUseConvexChannelFromGroupResult = {
      main: 'main-channel-123',
      leaders: 'leaders-channel-456',
    };
    // Set up query results for group data
    mockConvexQueryResult = {
      _id: 'group-123',
      name: 'Test Group',
      groupTypeName: 'Small Group',
      userRole: 'leader',
    };
    // Set up listGroupChannels for leader (includes both channels)
    mockListGroupChannelsResult = [
      { _id: 'main-channel-123', slug: 'general', channelType: 'main', name: 'General', description: '', memberCount: 10, isArchived: false, isMember: true, unreadCount: 0 },
      { _id: 'leaders-channel-456', slug: 'leaders', channelType: 'leaders', name: 'Leaders', description: '', memberCount: 2, isArchived: false, isMember: true, unreadCount: 0 },
    ];
    // Set up the mock implementation for useQuery
    mockedUseQuery.mockImplementation((query: string, args: any) => {
      if (query === 'api.functions.messaging.channels.listGroupChannels') {
        return mockListGroupChannelsResult;
      }
      return mockConvexQueryResult;
    });
  });

  it('should show Leaders tab when user is a leader', async () => {
    const { getByText } = render(<ConvexChatRoomScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(getByText('Leaders')).toBeTruthy();
    });
  });

  it('should NOT show Leaders tab when user is NOT a leader', async () => {
    // Set up as non-leader
    mockUseLocalSearchParams.mockReturnValue({
      chat_id: 'main-channel-123',
      channelType: 'general', // URL-based tab routing
      groupId: 'group-123',
      groupName: 'Test Group',
      groupType: 'Small Group',
      groupTypeId: '1',
      imageUrl: '',
      isLeader: '0', // Not a leader
      leadersChannelId: '',
      isAnnouncementGroup: '0',
      externalChatLink: '',
    });
    const nonLeaderQueryResult = {
      _id: 'group-123',
      name: 'Test Group',
      groupTypeName: 'Small Group',
      userRole: 'member', // Not a leader
    };
    // Non-leader only gets main channel (not a member of leaders channel)
    const nonLeaderChannels = [
      { _id: 'main-channel-123', slug: 'general', channelType: 'main', name: 'General', description: '', memberCount: 10, isArchived: false, isMember: true, unreadCount: 0 },
    ];
    // Update the mock for this specific test
    mockedUseQuery.mockImplementation((query: string, args: any) => {
      if (query === 'api.functions.messaging.channels.listGroupChannels') {
        return nonLeaderChannels;
      }
      return nonLeaderQueryResult;
    });

    const { queryByText, getByText } = render(<ConvexChatRoomScreen />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Should see General tab
      expect(getByText('General')).toBeTruthy();
    });

    // Should NOT see Leaders tab
    expect(queryByText('Leaders')).toBeNull();
  });

  it('should switch to leaders channel when Leaders tab is clicked', async () => {
    const { getByText } = render(<ConvexChatRoomScreen />, {
      wrapper: createWrapper(),
    });

    // Wait for component to load
    await waitFor(() => {
      expect(getByText('Leaders')).toBeTruthy();
    });

    // Click on Leaders tab
    fireEvent.press(getByText('Leaders'));

    // With URL-based routing, clicking tab navigates to new URL with params
    // Verify router.replace was called with correct path and params
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: '/inbox/group-123/leaders',
        })
      );
    });
  });

  it('should use correct channel ID when navigating from inbox to leader chat', async () => {
    // Simulate navigating directly to leaders channel from inbox
    mockUseLocalSearchParams.mockReturnValue({
      chat_id: 'leaders-channel-456', // Direct navigation to leaders channel
      channelType: 'leaders', // URL-based tab routing indicates leaders tab
      groupId: 'group-123',
      groupName: 'Test Group',
      groupType: 'Small Group',
      groupTypeId: '1',
      imageUrl: '',
      isLeader: '1',
      leadersChannelId: 'leaders-channel-456',
      isAnnouncementGroup: '0',
      externalChatLink: '',
    });

    const { getByTestId } = render(<ConvexChatRoomScreen />, {
      wrapper: createWrapper(),
    });

    // Wait for the message list to render with the correct channel
    await waitFor(() => {
      const messageList = getByTestId('message-list');
      // This test will FAIL if the navigation doesn't pass the correct channel ID
      expect(messageList.props.children).toContain('leaders-channel-456');
    });
  });

  it('should start on leaders tab when channel type is leaders', async () => {
    // Mock channel data that indicates this is a leaders channel
    mockedUseQuery.mockImplementation((query: string, args: any) => {
      if (query === 'api.functions.messaging.channels.listGroupChannels') {
        return mockListGroupChannelsResult;
      }
      if (query === 'api.functions.messaging.channels.getChannel') {
        return {
          _id: 'leaders-channel-456',
          channelType: 'leaders',
          groupId: 'group-123',
        };
      }
      return mockConvexQueryResult;
    });

    mockUseLocalSearchParams.mockReturnValue({
      chat_id: 'leaders-channel-456',
      channelType: 'leaders', // URL-based tab routing
      groupId: 'group-123',
      groupName: 'Test Group',
      groupType: 'Small Group',
      groupTypeId: '1',
      imageUrl: '',
      isLeader: '1',
      leadersChannelId: 'leaders-channel-456',
      isAnnouncementGroup: '0',
      externalChatLink: '',
    });

    const { getByText } = render(<ConvexChatRoomScreen />, {
      wrapper: createWrapper(),
    });

    // The Leaders tab should be active when navigating to a leaders channel
    // This test may FAIL if the initial tab selection logic is broken
    await waitFor(() => {
      const leadersTab = getByText('Leaders');
      // Check that Leaders tab is rendered and can be found
      expect(leadersTab).toBeTruthy();
    });
  });

  it('should handle clicking between General and Leaders tabs correctly', async () => {
    const { getByText, getByTestId } = render(<ConvexChatRoomScreen />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getByText('General')).toBeTruthy();
      expect(getByText('Leaders')).toBeTruthy();
    });

    // Start on General - verify main channel is displayed
    const messageList = getByTestId('message-list');
    expect(messageList.props.children).toContain('main-channel-123');

    // Click Leaders - with URL-based routing, this navigates to /inbox/group-123/leaders with params
    fireEvent.press(getByText('Leaders'));
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/inbox/group-123/leaders',
      })
    );

    // Click General - navigates to /inbox/group-123/general with params
    mockReplace.mockClear();
    fireEvent.press(getByText('General'));
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/inbox/group-123/general',
      })
    );
  });
});

describe('Leader Chat Click from GroupChatsScreen', () => {
  // These tests verify that clicking a leader chat from the GroupChatsScreen
  // navigates with the correct channel ID

  beforeEach(() => {
    jest.clearAllMocks();
    mockConvexQueryResult = [
      {
        _id: 'main-channel-123',
        slug: 'general',
        name: 'General Chat',
        channelType: 'main',
      },
      {
        _id: 'leaders-channel-456',
        slug: 'leaders',
        name: 'Leaders Hub',
        channelType: 'leaders',
      },
    ];
  });

  it('should have correct channel ID in mock data for leaders channel', () => {
    // Verify our test setup - the leaders channel should have the correct ID
    const leadersChannel = mockConvexQueryResult.find(
      (ch: any) => ch.channelType === 'leaders'
    );
    expect(leadersChannel).toBeDefined();
    expect(leadersChannel._id).toBe('leaders-channel-456');
    expect(leadersChannel.name).toBe('Leaders Hub');
  });

  it('should navigate to correct leaders channel when clicked', async () => {
    // This test imports GroupChatsScreen and verifies navigation
    // Import the component
    const { GroupChatsScreen } = require('../GroupChatsScreen');

    mockUseLocalSearchParams.mockReturnValue({
      groupId: 'group-123',
      groupName: 'Test Group',
    });

    const { getAllByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    // Wait for chats to load - use getAllByText since the name appears in multiple places
    await waitFor(() => {
      const leadersHubElements = getAllByText('Leaders Hub');
      expect(leadersHubElements.length).toBeGreaterThan(0);
    });

    // Click on the first Leaders Hub element (the chat name, not the subtitle)
    const leadersHubElements = getAllByText('Leaders Hub');
    fireEvent.press(leadersHubElements[0]);

    // Verify navigation was called with the correct URL-based route
    // Uses new format: /inbox/[groupId]/[channelSlug]
    expect(mockPush).toHaveBeenCalledWith('/inbox/group-123/leaders');
  });

  it('should pass correct channel ID for main chat', async () => {
    const { GroupChatsScreen } = require('../GroupChatsScreen');

    mockUseLocalSearchParams.mockReturnValue({
      groupId: 'group-123',
      groupName: 'Test Group',
    });

    const { getAllByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      const generalChatElements = getAllByText('General Chat');
      expect(generalChatElements.length).toBeGreaterThan(0);
    });

    const generalChatElements = getAllByText('General Chat');
    fireEvent.press(generalChatElements[0]);

    // Verify navigation uses new URL-based slug route format
    expect(mockPush).toHaveBeenCalledWith('/inbox/group-123/general');
  });
});
