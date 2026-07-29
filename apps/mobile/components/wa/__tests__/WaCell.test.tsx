/**
 * Smoke tests for WaCell (WHATSAPP-DESIGN-SYSTEM.md §3.2/§1.4).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { WaCell } from '../WaCell';

describe('WaCell', () => {
  it('renders a navigational cell with a chevron', () => {
    const { getByText } = render(<WaCell title="Media, links and docs" />);
    expect(getByText('Media, links and docs')).toBeTruthy();
    expect(getByText('chevron-forward')).toBeTruthy();
  });

  it('renders a navigational cell with a value label before the chevron', () => {
    const { getByText } = render(<WaCell title="Manage storage" value="5.4 MB" />);
    expect(getByText('5.4 MB')).toBeTruthy();
    expect(getByText('chevron-forward')).toBeTruthy();
  });

  it('renders a monochrome icon glyph when provided', () => {
    const { getByText } = render(<WaCell title="Notifications" icon="notifications-outline" />);
    expect(getByText('notifications-outline')).toBeTruthy();
  });

  it('renders a description sub-line', () => {
    const { getByText } = render(
      <WaCell title="Lock chat" description="Require Face ID to open this chat." />
    );
    expect(getByText('Require Face ID to open this chat.')).toBeTruthy();
  });

  it('renders a toggle cell with a native Switch and no chevron', () => {
    const { getByRole, queryByText } = render(
      <WaCell title="Lock chat" variant="toggle" toggleValue={false} />
    );
    expect(getByRole('switch')).toBeTruthy();
    expect(queryByText('chevron-forward')).toBeNull();
  });

  it('calls onToggleChange when the switch flips', () => {
    const onToggleChange = jest.fn();
    const { getByRole } = render(
      <WaCell title="Lock chat" variant="toggle" toggleValue={false} onToggleChange={onToggleChange} />
    );
    fireEvent(getByRole('switch'), 'valueChange', true);
    expect(onToggleChange).toHaveBeenCalledWith(true);
  });

  it('renders an action-variant row with no icon and no chevron', () => {
    const { getByText, queryByText } = render(<WaCell title="Add to Favorites" variant="action" />);
    expect(getByText('Add to Favorites')).toBeTruthy();
    expect(queryByText('chevron-forward')).toBeNull();
  });

  it('renders a destructive-variant row with no icon and no chevron', () => {
    const { getByText, queryByText } = render(<WaCell title="Exit community" variant="destructive" />);
    expect(getByText('Exit community')).toBeTruthy();
    expect(queryByText('chevron-forward')).toBeNull();
  });

  it('calls onPress when a navigational cell is tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<WaCell title="Media, links and docs" onPress={onPress} testID="wa-cell" />);
    fireEvent.press(getByTestId('wa-cell'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
