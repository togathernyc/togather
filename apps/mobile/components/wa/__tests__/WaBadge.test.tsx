/**
 * Smoke tests for WaBadge, including S6.3's chevron-in-capsule variant.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { WaBadge } from '../WaBadge';

describe('WaBadge', () => {
  it('renders the count', () => {
    const { getByText } = render(<WaBadge count={7} />);
    expect(getByText('7')).toBeTruthy();
  });

  it('caps at 99+', () => {
    const { getByText } = render(<WaBadge count={214} />);
    expect(getByText('99+')).toBeTruthy();
  });

  it('draws no chevron by default (chat rows keep a plain capsule)', () => {
    const { queryByText } = render(<WaBadge count={7} />);
    expect(queryByText('›')).toBeNull();
  });

  it('draws the chevron INSIDE the capsule when showChevron is set (S6.3: "7 ›")', () => {
    const tree = render(<WaBadge count={7} showChevron />).toJSON() as any;
    // One capsule element, with the count and the chevron as its two
    // children — not a badge with a chevron parked next to it.
    const childTexts = (tree.children as any[]).map((c) => c.children?.[0]);
    expect(childTexts).toEqual(['7', '›']);
  });

  it('honors an explicit fill color', () => {
    const tree = render(<WaBadge count={1} color="#123456" />).toJSON() as any;
    const flat = Object.assign({}, ...[].concat(tree.props.style).filter(Boolean));
    expect(flat.backgroundColor).toBe('#123456');
  });
});
