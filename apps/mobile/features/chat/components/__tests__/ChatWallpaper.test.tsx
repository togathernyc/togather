/**
 * ChatWallpaper (WA-VISUAL-DELTAS.md §S4.1).
 *
 * The wallpaper is a base color plus a *repeating* doodle tile. Both halves
 * matter: drop the tile and we're back to the flat tint the delta list called
 * out.
 *
 * The repeat is laid out explicitly in JS rather than via
 * `resizeMode="repeat"` — UIKit ignored that on device and stretched the sheet
 * into a flat smear (owner's recording, 2026-07-29). These tests pin the grid
 * so nobody "simplifies" it back to one stretched image.
 *
 * They also pin the tile SOURCE to an inline base64 data URI. As `require()`d
 * PNGs the tiles were expo-updates assets newer than the installed binary and
 * silently failed to resolve on device over OTA — flat cream again (owner
 * report, 2026-07-30). Anyone moving them back into `assets/` reintroduces it.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ChatWallpaper, WALLPAPER_TILE_SIZE } from '../ChatWallpaper';
import {
  WALLPAPER_TILE_DARK_URI,
  WALLPAPER_TILE_LIGHT_URI,
} from '../../chatWallpaperTiles';

// 390x844 (iPhone 14/15 logical size) — the viewport every WA-parity capture
// in docs/plans/church-migration-ui-redesign uses.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

describe('ChatWallpaper', () => {
  it('paints the wallpaper base color behind the tiles', () => {
    const { getByTestId } = render(<ChatWallpaper />);
    const style = StyleSheet.flatten(getByTestId('chat-wallpaper').props.style);
    // Light theme default from theme/colors.ts.
    expect(style.backgroundColor).toBe('#ECE5DD');
    expect(style.position).toBe('absolute');
  });

  it('tiles the doodle sheet across the window instead of stretching one image', () => {
    const { getAllByTestId } = render(<ChatWallpaper />);
    const tiles = getAllByTestId('chat-wallpaper-tile');
    // ceil(390/256) x ceil(844/256) = 2 x 4.
    const expected =
      Math.ceil(390 / WALLPAPER_TILE_SIZE) * Math.ceil(844 / WALLPAPER_TILE_SIZE);
    expect(tiles).toHaveLength(expected);
    expect(expected).toBe(8);
  });

  it('draws every tile at its authored size, 1:1 and unscaled', () => {
    const { getAllByTestId } = render(<ChatWallpaper />);
    for (const tile of getAllByTestId('chat-wallpaper-tile')) {
      const style = StyleSheet.flatten(tile.props.style);
      expect(style.width).toBe(WALLPAPER_TILE_SIZE);
      expect(style.height).toBe(WALLPAPER_TILE_SIZE);
      // No resize mode at all — the device bug we're routing around.
      expect(tile.props.resizeMode).toBeUndefined();
      expect(tile.props.source).toBeTruthy();
    }
  });

  it('draws the tile from an inlined data URI, never a bundled asset', () => {
    const { getAllByTestId } = render(<ChatWallpaper />);
    for (const tile of getAllByTestId('chat-wallpaper-tile')) {
      // A `require()`d PNG resolves to a number (or an {uri: 'http…'} in
      // dev) — either way it depends on an expo-updates asset that did not
      // arrive on device. Only a self-contained data URI is acceptable here.
      expect(tile.props.source).toEqual({ uri: WALLPAPER_TILE_LIGHT_URI });
      expect(tile.props.source.uri.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('ships both theme variants inline and they are different images', () => {
    for (const uri of [WALLPAPER_TILE_LIGHT_URI, WALLPAPER_TILE_DARK_URI]) {
      expect(uri.startsWith('data:image/png;base64,')).toBe(true);
      // A truncated/empty generation would still "start with" the prefix.
      expect(uri.length).toBeGreaterThan(5000);
    }
    expect(WALLPAPER_TILE_LIGHT_URI).not.toBe(WALLPAPER_TILE_DARK_URI);
  });

  it('never intercepts touches meant for the thread underneath', () => {
    const { getByTestId } = render(<ChatWallpaper />);
    expect(getByTestId('chat-wallpaper').props.pointerEvents).toBe('none');
  });
});
