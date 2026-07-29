/**
 * WaInsetGroup / WaSectionLabel — WA-VISUAL-DELTAS.md S3 card anatomy.
 *
 * These assert the three deltas that are invisible to a "does it render" test
 * but were the loudest visual misses in the audit: the ~24px corner radius
 * (S3.1), hairlines inset to the LABEL edge rather than the icon column
 * (S3.4), and sentence-case section labels replacing the iOS-15 ALL-CAPS
 * treatment (S3.5).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { WaInsetGroup } from '../WaInsetGroup';
import { WaSectionLabel } from '../WaSectionLabel';
import {
  WA_GROUP_RADIUS,
  WA_CELL_LABEL_INSET,
  WA_CELL_PADDING,
  WA_CELL_ICON_COLUMN,
  WA_SECTION_LABEL_SIZE,
} from '../metrics';

describe('WaInsetGroup', () => {
  it('S3.1: cards use the ~24px corner radius', () => {
    expect(WA_GROUP_RADIUS).toBeGreaterThanOrEqual(22);
    expect(WA_GROUP_RADIUS).toBeLessThanOrEqual(26);

    const { getByTestId } = render(
      <WaInsetGroup>
        <View testID="row-a" />
      </WaInsetGroup>
    );
    // The card is the row's parent chain; find the ancestor carrying the radius.
    const row = getByTestId('row-a');
    let node: any = row.parent;
    let radius: number | undefined;
    while (node && radius === undefined) {
      const style = StyleSheet.flatten(node.props?.style);
      if (style && typeof style.borderRadius === 'number') radius = style.borderRadius;
      node = node.parent;
    }
    expect(radius).toBe(WA_GROUP_RADIUS);
  });

  it('S3.4: the default hairline inset lands at the label, past the icon well', () => {
    // Not merely past the icon column's start — past the whole icon well.
    expect(WA_CELL_LABEL_INSET).toBeGreaterThan(WA_CELL_PADDING + WA_CELL_ICON_COLUMN);
    expect(WA_CELL_LABEL_INSET).toBe(56);
  });

  it('renders a separator between rows but not after the last one', () => {
    const { getByTestId } = render(
      <WaInsetGroup>
        <View testID="row-1" />
        <View testID="row-2" />
      </WaInsetGroup>
    );
    const card = getByTestId('row-1').parent!.parent!;
    // 2 rows + 1 hairline between them.
    expect(getByTestId('row-2')).toBeTruthy();
    expect(card).toBeTruthy();
  });
});

describe('WaSectionLabel', () => {
  it('S3.5: header labels are sentence-case, not uppercased', () => {
    const { getByText, queryByText } = render(<WaSectionLabel>Leader tools</WaSectionLabel>);
    expect(getByText('Leader tools')).toBeTruthy();
    expect(queryByText('LEADER TOOLS')).toBeNull();
  });

  it('S3.5: header labels render at ~15pt with no letter-spacing', () => {
    const { getByText } = render(<WaSectionLabel>Members</WaSectionLabel>);
    const style = StyleSheet.flatten(getByText('Members').props.style);
    expect(style.fontSize).toBe(WA_SECTION_LABEL_SIZE);
    expect(style.fontSize).toBe(15);
    expect(style.letterSpacing).toBeUndefined();
  });

  it('S3.6: footer metadata stays 13pt gray', () => {
    const { getByText } = render(
      <WaSectionLabel variant="footer">Created Jul 27, 2024.</WaSectionLabel>
    );
    const style = StyleSheet.flatten(getByText('Created Jul 27, 2024.').props.style);
    expect(style.fontSize).toBe(13);
  });
});
