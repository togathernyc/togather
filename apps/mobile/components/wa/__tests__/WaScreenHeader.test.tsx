/**
 * Smoke tests for WaScreenHeader / WaSubScreenHeader (WA-VISUAL-DELTAS.md S1).
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaScreenHeader, WaSubScreenHeader } from '../WaScreenHeader';

describe('WaScreenHeader', () => {
  it('renders the large title with its trailing circles', () => {
    const { getByText } = render(
      <WaScreenHeader
        title="Chats"
        trailingButtons={[{ icon: 'add', onPress: () => {}, accent: true }]}
      />
    );
    expect(getByText('Chats')).toBeTruthy();
    expect(getByText('add')).toBeTruthy();
  });

  it('renders buttons only when no title is given (the You tab — S1.3)', () => {
    const { getByText, queryByText } = render(
      <WaScreenHeader trailingButtons={[{ icon: 'create-outline', onPress: () => {} }]} />
    );
    expect(getByText('create-outline')).toBeTruthy();
    expect(queryByText('You')).toBeNull();
  });

  it('renders the leading slot (Togather community switcher divergence)', () => {
    const { getByText } = render(
      <WaScreenHeader title="Chats" leadingSlot={<Text>DC</Text>} />
    );
    expect(getByText('DC')).toBeTruthy();
  });

  it('renders a search pill from a placeholder', () => {
    const onSearchPress = jest.fn();
    const { getByText } = render(
      <WaScreenHeader title="Chats" searchPlaceholder="Search" onSearchPress={onSearchPress} />
    );
    fireEvent.press(getByText('Search'));
    expect(onSearchPress).toHaveBeenCalled();
  });

  it('collapses to a centered nav title', () => {
    const { getByText } = render(<WaScreenHeader title="Chats" collapsed />);
    expect(getByText('Chats')).toBeTruthy();
  });
});

describe('WaSubScreenHeader', () => {
  it('renders a floating back circle and a centered title', () => {
    const onBack = jest.fn();
    const { getByText, getByLabelText } = render(
      <WaSubScreenHeader title="Community info" onBack={onBack} />
    );
    expect(getByText('Community info')).toBeTruthy();
    fireEvent.press(getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders the unread count beside the chevron', () => {
    const { getByText } = render(<WaSubScreenHeader onBack={() => {}} backBadge="62" />);
    expect(getByText('62')).toBeTruthy();
    expect(getByText('chevron-back')).toBeTruthy();
  });
});
