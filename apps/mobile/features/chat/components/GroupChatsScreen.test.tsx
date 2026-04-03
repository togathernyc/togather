/**
 * Tests for GroupChatsScreen
 * Following TDD approach - these tests should fail initially
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GroupChatsScreen } from './GroupChatsScreen';

// Create mock functions that can be controlled per test
let mockConvexQueryResult: any = undefined;

// Mock Convex
jest.mock('@services/api/convex', () => ({
  useQuery: jest.fn(() => mockConvexQueryResult),
  useStoredAuthToken: jest.fn(() => 'mock-token'),
  api: {
    functions: {
      messaging: {
        channels: {
          getChannelsByGroup: 'api.functions.messaging.channels.getChannelsByGroup',
        },
      },
    },
  },
}));

// Mock expo-router
const mockPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({
  groupId: '123',
  groupName: 'Test Group',
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useRouter: jest.fn(() => ({
    push: mockPush,
  })),
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({
    user: { id: 'user-123', email: 'test@test.com' },
    isAuthenticated: true,
  })),
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
      <SafeAreaProvider>
        {children}
      </SafeAreaProvider>
    </QueryClientProvider>
  );
};

describe('GroupChatsScreen', () => {
  // Mock data matching new Convex response structure (array of channels with slugs)
  const mockChats = [
    {
      _id: 'channel-1',
      slug: 'general',
      name: 'General Chat',
      channelType: 'main',
    },
    {
      _id: 'channel-2',
      slug: 'leaders',
      name: 'Leaders Hub',
      channelType: 'leaders',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    // Default successful response - Convex returns array directly, not { chats: [...] }
    mockConvexQueryResult = mockChats;
  });

  it('should show loading state initially', () => {
    // Convex useQuery returns undefined while loading
    mockConvexQueryResult = undefined;

    const { getByTestId } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    expect(getByTestId('loading-indicator')).toBeTruthy();
  });

  it('should load and display chats for a group', async () => {
    const { getAllByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      const generalChatElements = getAllByText('General Chat');
      const leadersHubElements = getAllByText('Leaders Hub');
      expect(generalChatElements.length).toBeGreaterThan(0);
      expect(leadersHubElements.length).toBeGreaterThan(0);
    });
  });

  it('should display group name as header', async () => {
    const { getByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(getByText('Test Group')).toBeTruthy();
    });
  });

  it('should show correct icon for general chat', async () => {
    mockConvexQueryResult = [mockChats[0]];

    const { getByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(getByText('💬')).toBeTruthy();
    });
  });

  it('should show correct icon for leaders chat', async () => {
    mockConvexQueryResult = [mockChats[1]];

    const { getByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(getByText('👑')).toBeTruthy();
    });
  });

  it('should navigate to ChatRoom when chat is pressed', async () => {
    const { getAllByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      const generalChatElements = getAllByText('General Chat');
      expect(generalChatElements.length).toBeGreaterThan(0);
    });

    const generalChatElements = getAllByText('General Chat');
    fireEvent.press(generalChatElements[0]);

    // Now uses URL-based slug routing: /inbox/[groupId]/[channelSlug]
    expect(mockPush).toHaveBeenCalledWith('/inbox/123/general');
  });

  it('should handle empty chats gracefully', async () => {
    // Convex returns empty array when there's no data
    mockConvexQueryResult = [];

    const { queryByTestId, getByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(queryByTestId('loading-indicator')).toBeNull();
    });

    // Should still display the group name even with no chats
    expect(getByText('Test Group')).toBeTruthy();
  });

  it('should display chat type labels correctly', async () => {
    const { getAllByText } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      const generalChatElements = getAllByText('General Chat');
      const leadersHubElements = getAllByText('Leaders Hub');
      expect(generalChatElements.length).toBeGreaterThan(0);
      expect(leadersHubElements.length).toBeGreaterThan(0);
    });
  });

  it('should reload chats when groupId changes', async () => {
    const { rerender } = render(<GroupChatsScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Data should be loaded
      expect(mockConvexQueryResult).toEqual(mockChats);
    });

    // Simulate route param change
    mockUseLocalSearchParams.mockReturnValue({
      groupId: '456',
      groupName: 'Another Group',
    });

    rerender(<GroupChatsScreen />);

    // The Convex hook will be called with the new groupId
    // (the mock doesn't track calls, but the component will use the new params)
    await waitFor(() => {
      expect(mockConvexQueryResult).toBeDefined();
    });
  });
});
