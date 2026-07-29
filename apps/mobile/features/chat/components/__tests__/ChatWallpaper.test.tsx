/**
 * ChatWallpaper (WA-VISUAL-DELTAS.md §S4.1).
 *
 * The wallpaper is a base color plus a *repeating* doodle tile. Both halves
 * matter: drop the tile and we're back to the flat tint the delta list called
 * out; drop `resizeMode="repeat"` and the 512px sheet stretches to fill the
 * screen as one giant smear.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ChatWallpaper } from '../ChatWallpaper';

describe('ChatWallpaper', () => {
  it('paints the wallpaper base color behind the tile', () => {
    const { getByTestId } = render(<ChatWallpaper />);
    const style = StyleSheet.flatten(getByTestId('chat-wallpaper').props.style);
    // Light theme default from theme/colors.ts.
    expect(style.backgroundColor).toBe('#ECE5DD');
    expect(style.position).toBe('absolute');
  });

  it('tiles the doodle sheet rather than stretching it', () => {
    const { getByTestId } = render(<ChatWallpaper />);
    expect(getByTestId('chat-wallpaper-tile').props.resizeMode).toBe('repeat');
    expect(getByTestId('chat-wallpaper-tile').props.source).toBeTruthy();
  });

  it('never intercepts touches meant for the thread underneath', () => {
    const { getByTestId } = render(<ChatWallpaper />);
    expect(getByTestId('chat-wallpaper').props.pointerEvents).toBe('none');
  });
});
