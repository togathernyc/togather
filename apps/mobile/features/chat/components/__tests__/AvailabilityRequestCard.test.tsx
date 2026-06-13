import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AvailabilityRequestCard } from '../AvailabilityRequestCard';
import type { Id } from '@services/api/convex';

jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#888',
      border: '#ccc',
      surfaceSecondary: '#f5f5f5',
      success: '#0a0',
      destructive: '#c00',
      link: '#06f',
    },
  }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

const planId = 'plan-1' as Id<'eventPlans'>;

const longTitleEvent = {
  _id: planId,
  title: 'MH Service 7/5 with extended rehearsal and sound check',
  eventDate: new Date('2025-07-05T10:00:00').getTime(),
  times: [
    { label: '10:00 AM', startsAt: new Date('2025-07-05T10:00:00').getTime() },
    { label: '12:00 PM', startsAt: new Date('2025-07-05T12:00:00').getTime() },
  ],
  myStatus: null as const,
};

describe('AvailabilityRequestCard', () => {
  it('renders full event title and date/time without truncation', () => {
    render(
      <AvailabilityRequestCard
        events={[longTitleEvent]}
        busyPlanId={null}
        onSetStatus={jest.fn()}
      />,
    );

    expect(
      screen.getByText('MH Service 7/5 with extended rehearsal and sound check'),
    ).toBeTruthy();
    expect(screen.getByText('Sat, Jul 5 · 10:00 AM, 12:00 PM')).toBeTruthy();
  });

  it('renders footer actions on separate rows so they do not overlap', () => {
    const onOpenPage = jest.fn();

    render(
      <AvailabilityRequestCard
        events={[longTitleEvent]}
        busyPlanId={null}
        onSetStatus={jest.fn()}
        copyLinkUrl="https://example.com/a/token"
        onOpenPage={onOpenPage}
      />,
    );

    fireEvent.press(screen.getByText('Copy link'));
    fireEvent.press(screen.getByText('Manage all upcoming'));
    expect(onOpenPage).toHaveBeenCalledTimes(1);
  });

  it('calls onSetStatus when a pill is pressed', () => {
    const onSetStatus = jest.fn();

    render(
      <AvailabilityRequestCard
        events={[longTitleEvent]}
        busyPlanId={null}
        onSetStatus={onSetStatus}
      />,
    );

    fireEvent.press(screen.getByText('Available'));
    expect(onSetStatus).toHaveBeenCalledWith(planId, 'available');
  });
});
