/**
 * Smoke tests for WaFloatingButton (WA-VISUAL-DELTAS.md S1.1).
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaFloatingButton } from '../WaFloatingButton';

describe('WaFloatingButton', () => {
  it('renders its icon glyph', () => {
    const { getByText } = render(<WaFloatingButton icon="add" onPress={() => {}} />);
    expect(getByText('add')).toBeTruthy();
  });

  it('renders children instead of an icon (image-filled circles)', () => {
    const { getByText, queryByText } = render(
      <WaFloatingButton onPress={() => {}}>
        <Text>DC</Text>
      </WaFloatingButton>
    );
    expect(getByText('DC')).toBeTruthy();
    expect(queryByText('add')).toBeNull();
  });

  it('fires onPress', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <WaFloatingButton icon="add" onPress={onPress} accessibilityLabel="Start a new chat" />
    );
    fireEvent.press(getByLabelText('Start a new chat'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a static (non-pressable) circle when no onPress is given', () => {
    const { queryByRole, getByText } = render(<WaFloatingButton icon="add" />);
    expect(getByText('add')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });
});
