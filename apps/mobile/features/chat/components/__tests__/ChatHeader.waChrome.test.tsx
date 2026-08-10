/**
 * Chat-room nav header (WA-VISUAL-DELTAS.md §2.2 + §S5.2).
 *
 * The red "Teams" group-type chip is explicitly on the §S5.2 kill list
 * ("colored chip — banned"), replaced by a plain gray member-count subtitle.
 * Flag-off must keep the chip exactly as it was.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

let mockShellEnabled = false;
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
  useWhatsappShellState: () => ({ enabled: mockShellEnabled, loaded: true }),
}));
jest.mock('@components/ui', () => ({ AppImage: () => null }));

import { ChatHeader } from '../ChatHeader';

const props = {
  displayName: 'Worship Team',
  displayType: 'Teams',
  displayImage: '',
  groupTypeId: 1,
  memberCount: 62,
  onBack: jest.fn(),
  onInfoPress: jest.fn(),
  onGroupPagePress: jest.fn(),
};

describe('ChatHeader', () => {
  beforeEach(() => {
    mockShellEnabled = false;
  });

  it('keeps the group-type chip when the shell flag is off', () => {
    const { getByText } = render(<ChatHeader {...props} />);
    expect(getByText('Teams')).toBeTruthy();
  });

  it('drops the colored group-type chip flag-on', () => {
    mockShellEnabled = true;
    const { queryByText } = render(<ChatHeader {...props} />);
    expect(queryByText('Teams')).toBeNull();
  });

  it('keeps the 17pt semibold title over a 13pt member-count subtitle flag-on', () => {
    mockShellEnabled = true;
    const { getByText } = render(<ChatHeader {...props} />);
    const title = StyleSheet.flatten(getByText('Worship Team').props.style);
    expect(title.fontSize).toBe(17);
    expect(title.fontWeight).toBe('600');
    const subtitle = StyleSheet.flatten(getByText('62 members').props.style);
    expect(subtitle.fontSize).toBe(13);
  });

  it('floats the bar translucently over the wallpaper flag-on', () => {
    mockShellEnabled = true;
    const { getByText } = render(<ChatHeader {...props} />);
    let node: any = getByText('Worship Team');
    let barStyle: any = null;
    while (node) {
      const style = StyleSheet.flatten(node.props?.style);
      if (style?.backgroundColor) barStyle = style;
      node = node.parent;
    }
    expect(String(barStyle.backgroundColor)).toMatch(/^rgba\(/);
  });
});
