/**
 * WaActionCard — WA-VISUAL-DELTAS.md per-screen §3.3 / S5.2: white rounded
 * button cards with an accent glyph and a DARK label, replacing the green
 * circle glyphs the audit flagged.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaActionCard, WaActionCardRow } from '../WaActionCard';
import { WA_ACTION_CARD_HEIGHT, WA_ACTION_CARD_RADIUS } from '../metrics';
import { lightColors } from '@/theme/colors';

describe('WaActionCard', () => {
  it('renders the glyph and label', () => {
    const { getByText } = render(
      <WaActionCard icon="chatbubbles-outline" label="Open chat" onPress={jest.fn()} />
    );
    expect(getByText('chatbubbles-outline')).toBeTruthy();
    expect(getByText('Open chat')).toBeTruthy();
  });

  it('§3.3: the card is ~76pt tall and rounded', () => {
    const { getByTestId } = render(
      <WaActionCard icon="search-outline" label="Search" onPress={jest.fn()} testID="wa-action" />
    );
    const style = StyleSheet.flatten(getByTestId('wa-action').props.style);
    expect(style.height).toBe(WA_ACTION_CARD_HEIGHT);
    expect(WA_ACTION_CARD_HEIGHT).toBe(76);
    expect(style.borderRadius).toBe(WA_ACTION_CARD_RADIUS);
  });

  it('S5.1: the accent lives in the glyph only — the label stays dark ink', () => {
    const { Ionicons } = require('@expo/vector-icons');
    (Ionicons as jest.Mock).mockClear();
    const { getByText } = render(
      <WaActionCard icon="person-add-outline" label="Invite" onPress={jest.fn()} accent="#25D366" />
    );
    const iconCall = (Ionicons as jest.Mock).mock.calls.find(
      ([props]: any[]) => props.name === 'person-add-outline'
    );
    expect(iconCall![0].color).toBe('#25D366');

    const labelStyle = StyleSheet.flatten(getByText('Invite').props.style);
    expect(labelStyle.color).toBe(lightColors.text);
    expect(labelStyle.fontSize).toBe(15);
  });

  it('calls onPress', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <WaActionCardRow>
        <WaActionCard icon="search-outline" label="Search" onPress={onPress} testID="wa-action" />
      </WaActionCardRow>
    );
    fireEvent.press(getByTestId('wa-action'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
