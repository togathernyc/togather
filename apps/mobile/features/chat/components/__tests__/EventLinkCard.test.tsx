import React from 'react';
import { render } from '@testing-library/react-native';
import { EventLinkCard } from '../EventLinkCard';
import { api } from '@services/api/convex';

const mockUseQuery = jest.fn();
const mockSubmitRsvp = jest.fn();
const mockPush = jest.fn();

jest.mock('@services/api/convex', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: jest.fn(() => mockSubmitRsvp),
  api: {
    functions: {
      meetings: {
        index: {
          getByShortId: 'api.functions.meetings.index.getByShortId',
        },
      },
      meetingRsvps: {
        list: 'api.functions.meetingRsvps.list',
        myRsvp: 'api.functions.meetingRsvps.myRsvp',
        submit: 'api.functions.meetingRsvps.submit',
      },
    },
  },
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({ token: 'mock-token' }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@components/ui/Avatar', () => ({
  Avatar: () => null,
}));

jest.mock('@components/ui/AppImage', () => ({
  AppImage: () => null,
}));

jest.mock('@/providers/ImageViewerProvider', () => ({
  ImageViewerManager: { show: jest.fn() },
}));

jest.mock('../../utils/imageActions', () => ({
  handleImageLongPress: jest.fn(),
  handleEventLongPress: jest.fn(),
}));

const fullEventData = {
  id: 'meeting-1',
  shortId: 'evt123',
  title: 'Planning Night',
  scheduledAt: '2026-04-01T17:00:00.000Z',
  coverImage: null,
  locationOverride: 'Main Hall',
  meetingType: 1,
  rsvpEnabled: true,
  rsvpOptions: [{ id: 1, label: 'Going', enabled: true }],
  groupName: 'Core Team',
  communityName: 'Demo Community',
  hasAccess: true,
  status: 'scheduled',
};

function mockQueries({
  eventData = fullEventData,
  rsvpCount = 12,
  previewUsers = 1,
}: {
  eventData?: Record<string, unknown> | null;
  rsvpCount?: number;
  previewUsers?: number;
}) {
  const users = Array.from({ length: previewUsers }, (_, i) => ({
    id: `user-${i + 1}`,
    firstName: `User${i + 1}`,
    lastName: 'Test',
    profileImage: null,
  }));

  mockUseQuery.mockImplementation((queryName: unknown, args: unknown) => {
    if (queryName === api.functions.meetings.index.getByShortId) {
      if (args === 'skip') return undefined;
      return eventData;
    }
    if (queryName === api.functions.meetingRsvps.list) {
      return {
        total: rsvpCount,
        limitedAccess: true,
        rsvps: [
          {
            option: { id: 1, label: 'Going', enabled: true },
            count: rsvpCount,
            users,
          },
        ],
      };
    }
    if (queryName === api.functions.meetingRsvps.myRsvp) {
      return { optionId: null };
    }
    return undefined;
  });
}

describe('EventLinkCard RSVP counts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders RSVP count from backend count instead of preview users length', () => {
    mockQueries({ rsvpCount: 12, previewUsers: 1 });

    const { getByText } = render(<EventLinkCard shortId="evt123" />);

    expect(getByText('Going 👍')).toBeTruthy();
    expect(getByText('12')).toBeTruthy();
  });

  it('fetches full event data when prefetched payload is missing rsvpOptions', () => {
    mockQueries({ rsvpCount: 3, previewUsers: 1 });

    const partialPrefetchedData = {
      id: 'meeting-1',
      shortId: 'evt123',
      title: 'Planning Night',
      scheduledAt: '2026-04-01T17:00:00.000Z',
      rsvpEnabled: true,
      hasAccess: true,
    };

    const { getByText } = render(
      <EventLinkCard shortId="evt123" prefetchedData={partialPrefetchedData as any} />
    );

    expect(getByText('Going 👍')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();

    const meetingQueryCall = mockUseQuery.mock.calls.find(
      ([queryName]) => queryName === api.functions.meetings.index.getByShortId
    );
    expect(meetingQueryCall?.[1]).toEqual({ shortId: 'evt123', token: 'mock-token' });
  });
});
