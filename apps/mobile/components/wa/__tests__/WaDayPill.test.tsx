/**
 * WaDayPill contrast (WA-VISUAL-DELTAS.md §S4.3).
 *
 * The pill floats on the patterned chat wallpaper, so its fill has to be a
 * SOLID capsule — the earlier translucent fill let the doodles bleed through
 * and the pill washed out. These assertions pin the fill/typography so a
 * future polish pass can't quietly re-introduce transparency.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { WaDayPill } from '../WaDayPill';

describe('WaDayPill', () => {
  it('renders the label', () => {
    const { getByText } = render(<WaDayPill label="Fri, Jul 17" />);
    expect(getByText('Fri, Jul 17')).toBeTruthy();
  });

  it('fills the capsule with a solid (non-translucent) color', () => {
    const { getByTestId } = render(<WaDayPill label="Yesterday" />);
    const style = StyleSheet.flatten(getByTestId('wa-day-pill').props.style);
    expect(style.backgroundColor).toBe('#FFFFFF');
    expect(String(style.backgroundColor)).not.toMatch(/rgba/);
  });

  it('lifts the capsule off the wallpaper with a subtle shadow', () => {
    const { getByTestId } = render(<WaDayPill label="Today" />);
    const style = StyleSheet.flatten(getByTestId('wa-day-pill').props.style);
    expect(style.shadowOpacity).toBeGreaterThan(0);
    expect(style.borderRadius).toBe(999);
  });

  it('renders the label at the §S7 13pt day-pill size', () => {
    const { getByText } = render(<WaDayPill label="Today" />);
    const style = StyleSheet.flatten(getByText('Today').props.style);
    expect(style.fontSize).toBe(13);
    expect(style.fontWeight).toBe('500');
  });
});
