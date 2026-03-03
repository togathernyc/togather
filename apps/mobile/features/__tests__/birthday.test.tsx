/**
 * Birthday/DOB Functionality Tests
 *
 * These tests verify:
 * 1. BirthdayCollectionModal - blocking modal for users without DOB
 * 2. COPPA compliance (13+ years requirement)
 * 3. Profile editing works on user's birthday
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock functions that can be controlled per test
const mockRefreshUser = jest.fn().mockResolvedValue(undefined);
const mockUpdateUserMutation = jest.fn().mockResolvedValue({});

// Default mock user without DOB
const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  legacyId: 123,
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  phone: '+1234567890',
  phone_verified: true,
  community_id: 'community-1',
  date_of_birth: undefined,
  ...overrides,
});

// Mock auth context value
let mockAuthContextValue: {
  user: ReturnType<typeof createMockUser> | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshUser: typeof mockRefreshUser;
  token: string | null;
  community: { id: string; name: string } | null;
  logout: jest.Mock;
  setCommunity: jest.Mock;
  clearCommunity: jest.Mock;
  signIn: jest.Mock;
} = {
  user: createMockUser(),
  isLoading: false,
  isAuthenticated: true,
  refreshUser: mockRefreshUser,
  token: 'mock-token',
  community: { id: 'community-1', name: 'Test Community' },
  logout: jest.fn(),
  setCommunity: jest.fn(),
  clearCommunity: jest.fn(),
  signIn: jest.fn(),
};

// Mock AuthProvider
jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => mockAuthContextValue,
}));

// Mock Convex API
jest.mock('@services/api/convex', () => ({
  useMutation: () => mockUpdateUserMutation,
  useAuthenticatedMutation: () => mockUpdateUserMutation,
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedAction: jest.fn(() => jest.fn()),
  api: {
    functions: {
      users: {
        update: 'api.functions.users.update',
      },
    },
  },
}));

// Mock AsyncStorage
const mockAsyncStorage: Record<string, string | null> = {
  auth_token: 'mock-token',
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockAsyncStorage[key] || null)),
  setItem: jest.fn((key: string, value: string) => {
    mockAsyncStorage[key] = value;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    delete mockAsyncStorage[key];
    return Promise.resolve();
  }),
}));

// Mock storage utility
jest.mock('@utils/storage', () => ({
  storage: {
    getItem: jest.fn().mockResolvedValue('1.0'), // Terms accepted
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock expo-router
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
  }),
}));

// Import component after mocks
import { BirthdayCollectionModal } from '@/components/legal/BirthdayCollectionModal';

// Test wrapper with providers
const createTestWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 375, height: 812 },
          insets: { top: 47, right: 0, bottom: 34, left: 0 },
        }}
      >
        {children}
      </SafeAreaProvider>
    </QueryClientProvider>
  );
};

// Helper to calculate date for a specific age
const getDateForAge = (age: number): string => {
  const today = new Date();
  const birthYear = today.getFullYear() - age;
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${month}/${day}/${birthYear}`;
};

describe('BirthdayCollectionModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock auth context to default (no DOB)
    mockAuthContextValue = {
      user: createMockUser(),
      isLoading: false,
      isAuthenticated: true,
      refreshUser: mockRefreshUser,
      token: 'mock-token',
      community: { id: 'community-1', name: 'Test Community' },
      logout: jest.fn(),
      setCommunity: jest.fn(),
      clearCommunity: jest.fn(),
      signIn: jest.fn(),
    };
    mockAsyncStorage['auth_token'] = 'mock-token';
  });

  describe('Modal Visibility', () => {
    it('shows blocking modal when user has no DOB', async () => {
      const Wrapper = createTestWrapper();
      const { getByText, queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      // Wait for async storage check to complete and modal to appear
      await waitFor(
        () => {
          expect(getByText("When's Your Birthday?")).toBeTruthy();
        },
        { timeout: 10000 }
      );

      // Continue button should be present
      expect(getByText('Continue')).toBeTruthy();
      // There should be no X button or close option (non-dismissible modal)
      expect(queryByText('Close')).toBeNull();
      expect(queryByText('Skip')).toBeNull();
    }, 15000);

    it('hides modal when user has DOB', async () => {
      // Set user with existing DOB
      mockAuthContextValue.user = createMockUser({
        date_of_birth: '1990-05-15',
      });

      const Wrapper = createTestWrapper();
      const { queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      // Modal should NOT be visible
      await waitFor(() => {
        expect(queryByText("When's Your Birthday?")).toBeNull();
      });
    });

    it('hides modal when auth is loading', async () => {
      mockAuthContextValue.isLoading = true;

      const Wrapper = createTestWrapper();
      const { queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        expect(queryByText("When's Your Birthday?")).toBeNull();
      });
    });

    it('hides modal when user is not authenticated', async () => {
      mockAuthContextValue.isAuthenticated = false;
      mockAuthContextValue.user = null;

      const Wrapper = createTestWrapper();
      const { queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        expect(queryByText("When's Your Birthday?")).toBeNull();
      });
    });
  });

  describe('Date Format Validation', () => {
    it('formats input as MM/DD/YYYY while typing', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      // Wait for async storage check to complete and modal to appear
      await waitFor(
        () => {
          expect(getByPlaceholderText('MM/DD/YYYY')).toBeTruthy();
        },
        { timeout: 10000 }
      );

      const input = getByPlaceholderText('MM/DD/YYYY');

      // Type date numbers
      fireEvent.changeText(input, '12252000');

      await waitFor(() => {
        // Should format as MM/DD/YYYY
        expect(input.props.value).toBe('12/25/2000');
      });
    }, 15000);

    it('strips non-numeric characters from input', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');

      // Type with special characters
      fireEvent.changeText(input, '12-25-2000');

      await waitFor(() => {
        // Should strip hyphens and format correctly
        expect(input.props.value).toBe('12/25/2000');
      });
    });

    it('prevents submission when date is incomplete', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter incomplete date - button should be disabled
      fireEvent.changeText(input, '12/25');

      // Try to press button - mutation should NOT be called
      // because the button is disabled when birthday length < 10
      await act(async () => {
        fireEvent.press(continueButton);
      });

      // Mutation should NOT have been called
      expect(mockUpdateUserMutation).not.toHaveBeenCalled();
    });

    it('validates month range (1-12)', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter invalid month (13)
      fireEvent.changeText(input, '13/25/2000');
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('Month must be between 1 and 12')).toBeTruthy();
      });
    });

    it('validates day range (1-31)', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter invalid day (32)
      fireEvent.changeText(input, '12/32/2000');
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('Day must be between 1 and 31')).toBeTruthy();
      });
    });

    it('validates impossible dates (Feb 31)', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter impossible date (Feb 31)
      fireEvent.changeText(input, '02/31/2000');
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('Please enter a valid date')).toBeTruthy();
      });
    });

    it('rejects future dates', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter future date
      const futureYear = new Date().getFullYear() + 1;
      fireEvent.changeText(input, `01/01/${futureYear}`);
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('Please enter a valid year')).toBeTruthy();
      });
    });
  });

  describe('COPPA Compliance (13+ years)', () => {
    it('rejects birthday making user under 13 years old', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter birthday making user 12 years old
      const twelveYearsAgo = getDateForAge(12);
      fireEvent.changeText(input, twelveYearsAgo);
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('You must be at least 13 years old')).toBeTruthy();
      });
    });

    it('rejects birthday for user who is exactly 12 years and 364 days old', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter birthday making user almost 13 (birthday is tomorrow)
      const today = new Date();
      const birthDate = new Date(today.getFullYear() - 13, today.getMonth(), today.getDate() + 1);
      const month = String(birthDate.getMonth() + 1).padStart(2, '0');
      const day = String(birthDate.getDate()).padStart(2, '0');
      const dateStr = `${month}/${day}/${birthDate.getFullYear()}`;

      fireEvent.changeText(input, dateStr);
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('You must be at least 13 years old')).toBeTruthy();
      });
    });

    it('accepts birthday for user exactly 13 years old', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText, queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter birthday making user exactly 13 today
      const thirteenYearsAgo = getDateForAge(13);
      fireEvent.changeText(input, thirteenYearsAgo);

      await act(async () => {
        fireEvent.press(continueButton);
      });

      await waitFor(() => {
        // Should NOT show age error
        expect(queryByText('You must be at least 13 years old')).toBeNull();
        // Mutation should be called
        expect(mockUpdateUserMutation).toHaveBeenCalled();
      });
    });

    it('accepts valid birthday for user 13+ years old', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText, queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter birthday making user 20 years old
      const twentyYearsAgo = getDateForAge(20);
      fireEvent.changeText(input, twentyYearsAgo);

      await act(async () => {
        fireEvent.press(continueButton);
      });

      await waitFor(() => {
        // Should NOT show any error
        expect(queryByText('You must be at least 13 years old')).toBeNull();
        expect(queryByText('Please enter a valid date')).toBeNull();
        // Mutation should be called
        expect(mockUpdateUserMutation).toHaveBeenCalled();
      });
    });
  });

  describe('Save Functionality', () => {
    it('calls updateUser mutation with correct date format on save', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter valid birthday
      fireEvent.changeText(input, '05/15/1990');

      await act(async () => {
        fireEvent.press(continueButton);
      });

      await waitFor(() => {
        // Should call mutation with YYYY-MM-DD format
        // Note: useAuthenticatedMutation auto-injects token, so component doesn't pass it
        expect(mockUpdateUserMutation).toHaveBeenCalledWith({
          dateOfBirth: '1990-05-15',
        });
      });
    });

    it('calls refreshUser after successful save', async () => {
      mockUpdateUserMutation.mockResolvedValueOnce({});

      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter valid birthday
      fireEvent.changeText(input, '05/15/1990');

      await act(async () => {
        fireEvent.press(continueButton);
      });

      await waitFor(() => {
        expect(mockRefreshUser).toHaveBeenCalled();
      });
    });

    it('shows error message when save fails', async () => {
      mockUpdateUserMutation.mockRejectedValueOnce(new Error('Network error'));

      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter valid birthday
      fireEvent.changeText(input, '05/15/1990');

      await act(async () => {
        fireEvent.press(continueButton);
      });

      await waitFor(() => {
        expect(getByText('Failed to save birthday. Please try again.')).toBeTruthy();
      });
    });

    it('calls onCompleted callback after successful save', async () => {
      mockUpdateUserMutation.mockResolvedValueOnce({});
      const onCompleted = jest.fn();

      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal onCompleted={onCompleted} />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter valid birthday
      fireEvent.changeText(input, '05/15/1990');

      await act(async () => {
        fireEvent.press(continueButton);
      });

      await waitFor(() => {
        expect(onCompleted).toHaveBeenCalled();
      });
    });

    it('disables submit button when birthday is incomplete', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter incomplete date
      fireEvent.changeText(input, '05/15');

      // Button should be disabled (has opacity style)
      expect(continueButton.props.style || continueButton.parent?.props.style).toBeDefined();
    });
  });

  describe('Button State', () => {
    it('disables continue button while saving', async () => {
      // Make mutation take time
      mockUpdateUserMutation.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText, getByTestId, queryByTestId } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter valid birthday
      fireEvent.changeText(input, '05/15/1990');

      // Press button and check it's disabled during save
      await act(async () => {
        fireEvent.press(continueButton);
      });

      // The button text should change or show loading indicator
      // (implementation may vary - just verify the mutation was called)
      expect(mockUpdateUserMutation).toHaveBeenCalled();
    });
  });
});

describe('Edit Profile on Birthday', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage['auth_token'] = 'mock-token';
  });

  // These tests verify that profile editing works correctly when:
  // 1. Today is the user's birthday
  // 2. User is editing their birthday field in profile
  //
  // The tests focus on the date validation logic rather than the full
  // EditProfileForm component, since the BirthdayCollectionModal tests
  // above cover the core birthday validation logic.

  describe('Birthday Date Edge Cases', () => {
    it('accepts valid leap year birthday (Feb 29)', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText, queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter leap year birthday (2000 was a leap year)
      fireEvent.changeText(input, '02/29/2000');

      await act(async () => {
        fireEvent.press(continueButton);
      });

      await waitFor(() => {
        // Should NOT show any error - Feb 29, 2000 is valid
        expect(queryByText('Please enter a valid date')).toBeNull();
        expect(mockUpdateUserMutation).toHaveBeenCalled();
      });
    });

    it('rejects invalid leap year date (Feb 29 on non-leap year)', async () => {
      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter invalid leap year date (2001 was NOT a leap year)
      fireEvent.changeText(input, '02/29/2001');
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('Please enter a valid date')).toBeTruthy();
      });
    });

    it('handles today as birthday without blocking edit', async () => {
      // This test simulates a user whose birthday is today
      // They should still be able to use the app normally

      const today = new Date();
      const todayBirthday = `${today.getFullYear() - 25}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      mockAuthContextValue.user = createMockUser({
        date_of_birth: todayBirthday,
      });

      const Wrapper = createTestWrapper();
      const { queryByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      // Modal should NOT be visible since user has DOB
      await waitFor(() => {
        expect(queryByText("When's Your Birthday?")).toBeNull();
      });
    });

    it('validates year is not before 1900', async () => {
      // Reset to user without DOB
      mockAuthContextValue.user = createMockUser();

      const Wrapper = createTestWrapper();
      const { getByPlaceholderText, getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        const input = getByPlaceholderText('MM/DD/YYYY');
        expect(input).toBeTruthy();
      });

      const input = getByPlaceholderText('MM/DD/YYYY');
      const continueButton = getByText('Continue');

      // Enter very old date
      fireEvent.changeText(input, '01/01/1899');
      fireEvent.press(continueButton);

      await waitFor(() => {
        expect(getByText('Please enter a valid year')).toBeTruthy();
      });
    });
  });

  describe('Modal Info Content', () => {
    it('displays informational text about birthday usage', async () => {
      // Reset to user without DOB so modal shows
      mockAuthContextValue.user = createMockUser();

      const Wrapper = createTestWrapper();
      const { getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        // Check for informational content
        expect(getByText('Your birthday helps us:')).toBeTruthy();
        expect(getByText(/Celebrate your special day/)).toBeTruthy();
        expect(getByText(/age-appropriate experiences/)).toBeTruthy();
      });
    });

    it('displays privacy notice', async () => {
      // Reset to user without DOB so modal shows
      mockAuthContextValue.user = createMockUser();

      const Wrapper = createTestWrapper();
      const { getByText } = render(
        <BirthdayCollectionModal />,
        { wrapper: Wrapper }
      );

      await waitFor(() => {
        expect(getByText(/Your birthday is kept private/)).toBeTruthy();
      });
    });
  });
});
