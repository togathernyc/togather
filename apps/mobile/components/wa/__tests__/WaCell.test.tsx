/**
 * Smoke tests for WaCell (WHATSAPP-DESIGN-SYSTEM.md §3.2/§1.4) plus the
 * WA-VISUAL-DELTAS.md S3 recalibrations (52–56pt rows, black 24pt glyphs,
 * vertically-centered chevrons, gray footer metadata rows).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaCell } from '../WaCell';
import { WA_CELL_MIN_HEIGHT, WA_CELL_ICON_SIZE } from '../metrics';
import { lightColors } from '@/theme/colors';

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

  // --- WA-VISUAL-DELTAS.md S3 ------------------------------------------------

  it('S3.2: rows are at least 52pt tall', () => {
    expect(WA_CELL_MIN_HEIGHT).toBeGreaterThanOrEqual(52);
    expect(WA_CELL_MIN_HEIGHT).toBeLessThanOrEqual(56);
  });

  it('S3.2: the left glyph is a 24pt black icon, not thin gray', () => {
    const { Ionicons } = require('@expo/vector-icons');
    (Ionicons as jest.Mock).mockClear();
    render(<WaCell title="Notifications" icon="notifications-outline" />);
    // The global Ionicons mock strips size/color off the rendered element, so
    // assert on the call args instead.
    const iconCall = (Ionicons as jest.Mock).mock.calls.find(
      ([props]: any[]) => props.name === 'notifications-outline'
    );
    expect(iconCall).toBeTruthy();
    expect(iconCall![0].size).toBe(WA_CELL_ICON_SIZE);
    expect(WA_CELL_ICON_SIZE).toBe(24);
    // Near-black `colors.text` ink, never the thin `text.secondary` gray.
    expect(iconCall![0].color).toBe(lightColors.text);
    expect(iconCall![0].color).not.toBe(lightColors.textSecondary);
  });

  it('S3.3: the chevron is vertically centered, not top-aligned', () => {
    const { getByText } = render(
      <WaCell title="Lock chat" description="Require Face ID to open this chat." />
    );
    const chevron = getByText('chevron-forward');
    expect(StyleSheet.flatten(chevron.props.style)).toMatchObject({ alignSelf: 'center' });
  });

  it('S3.6: renders a gray footer-metadata row with no chevron', () => {
    const { getByText, queryByText } = render(
      <WaCell title="Created by Pastor Dan · Created Jul 27, 2024." variant="footer" />
    );
    expect(getByText('Created by Pastor Dan · Created Jul 27, 2024.')).toBeTruthy();
    expect(queryByText('chevron-forward')).toBeNull();
  });
});
