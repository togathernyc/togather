/**
 * Smoke tests for WaRow (WHATSAPP-DESIGN-SYSTEM.md §3.1).
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaRow } from '../WaRow';

describe('WaRow', () => {
  it('renders title and subtitle', () => {
    const { getByText } = render(<WaRow title="Bridal Party Logistics" subtitle="Alex: See you at 6pm!" />);
    expect(getByText('Bridal Party Logistics')).toBeTruthy();
    expect(getByText('Alex: See you at 6pm!')).toBeTruthy();
  });

  it('renders without a subtitle', () => {
    const { getByText, queryByText } = render(<WaRow title="Archived" />);
    expect(getByText('Archived')).toBeTruthy();
    expect(queryByText('Alex: See you at 6pm!')).toBeNull();
  });

  it('renders the timestamp', () => {
    const { getByText } = render(<WaRow title="General" timestamp="2h" />);
    expect(getByText('2h')).toBeTruthy();
  });

  it('renders an unread badge with the count', () => {
    const { getByText } = render(<WaRow title="General" isUnread unreadCount={3} />);
    expect(getByText('3')).toBeTruthy();
  });

  it('caps the badge display at 99+', () => {
    const { getByText } = render(<WaRow title="General" isUnread unreadCount={140} />);
    expect(getByText('99+')).toBeTruthy();
  });

  it('does not render a badge when unreadCount is 0', () => {
    const { queryByText } = render(<WaRow title="General" unreadCount={0} />);
    expect(queryByText('0')).toBeNull();
  });

  it('renders the muted glyph instead of the badge when showMutedDot is true (§3.1: badge stays hidden, mute glyph communicates state)', () => {
    const { getByText, queryByText } = render(
      <WaRow title="P&P Community Members" isUnread unreadCount={2} showMutedDot />
    );
    expect(getByText('notifications-off-outline')).toBeTruthy();
    expect(queryByText('2')).toBeNull();
  });

  it('renders a trailing chevron when showChevron is true', () => {
    const { getByText } = render(<WaRow title="Join a channel" showChevron />);
    expect(getByText('chevron-forward')).toBeTruthy();
  });

  it('renders a custom rightAccessory instead of timestamp/badge', () => {
    const { getByText, queryByText } = render(
      <WaRow title="Worship Team" timestamp="1h" unreadCount={5} rightAccessory={<Text>Join</Text>} />
    );
    expect(getByText('Join')).toBeTruthy();
    expect(queryByText('1h')).toBeNull();
    expect(queryByText('5')).toBeNull();
  });

  it('renders initials placeholder avatar from a descriptor with no imageUrl', () => {
    const { getByText } = render(<WaRow title="Demo Community" avatar={{ label: 'Demo Community', shape: 'squircle' }} />);
    expect(getByText('DC')).toBeTruthy();
  });

  it('renders a custom avatar node as-is', () => {
    const { getByText } = render(<WaRow title="Custom" avatar={<Text>custom-avatar</Text>} />);
    expect(getByText('custom-avatar')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<WaRow title="Tappable" onPress={onPress} testID="wa-row" />);
    fireEvent.press(getByTestId('wa-row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders as a non-interactive row when no onPress/onLongPress is given', () => {
    const { getByTestId } = render(<WaRow title="Static" testID="wa-row-static" />);
    expect(getByTestId('wa-row-static').props.onPress).toBeUndefined();
  });
});
