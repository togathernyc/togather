/**
 * The opaque chrome tones (WA-VISUAL-DELTAS.md §S4).
 *
 * The chat page's safe-area strips — status bar above the header,
 * home-indicator below the composer — are `padding` on containers, so the
 * wallpaper layer can't reach them and a *translucent* chrome fill would
 * composite over the app's root background instead of the wallpaper. Flattened
 * tones are what those strips paint.
 *
 * These tests pin the flattening so the strips can never drift away from the
 * bars they're supposed to continue.
 */
import { lightColors, darkColors } from '../../../theme/colors';
import {
  WA_CHAT_CHROME_DARK,
  WA_CHAT_CHROME_LIGHT,
  WA_COMPOSER_BAR_DARK,
  WA_COMPOSER_BAR_LIGHT,
  waChatChromeOpaque,
  waComposerBarOpaque,
} from '../waChatChrome';

/** Independent re-implementation of the blend, so the test isn't a tautology. */
function blend(overlay: string, baseHex: string): string {
  const nums = overlay.match(/[\d.]+/g)!.map(Number);
  const [r, g, b, alpha] = nums;
  const base = [1, 3, 5].map((i) => parseInt(baseHex.slice(i, i + 2), 16));
  return (
    '#' +
    [r, g, b]
      .map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha)))
      .map((c) => c.toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

describe('waChatChromeOpaque / waComposerBarOpaque', () => {
  it('flattens the header chrome over the wallpaper in both themes', () => {
    expect(waChatChromeOpaque(lightColors.chatWallpaper, false)).toBe(
      blend(WA_CHAT_CHROME_LIGHT, lightColors.chatWallpaper)
    );
    expect(waChatChromeOpaque(darkColors.chatWallpaper, true)).toBe(
      blend(WA_CHAT_CHROME_DARK, darkColors.chatWallpaper)
    );
    // Pinned so a refactor can't quietly change the shipped tone.
    expect(waChatChromeOpaque(lightColors.chatWallpaper, false)).toBe('#EFE9E1');
    expect(waChatChromeOpaque(darkColors.chatWallpaper, true)).toBe('#101A20');
  });

  it('flattens the composer bar over the wallpaper in both themes', () => {
    expect(waComposerBarOpaque(lightColors.chatWallpaper, false)).toBe(
      blend(WA_COMPOSER_BAR_LIGHT, lightColors.chatWallpaper)
    );
    expect(waComposerBarOpaque(darkColors.chatWallpaper, true)).toBe(
      blend(WA_COMPOSER_BAR_DARK, darkColors.chatWallpaper)
    );
    expect(waComposerBarOpaque(lightColors.chatWallpaper, false)).toBe('#EFE9E1');
    expect(waComposerBarOpaque(darkColors.chatWallpaper, true)).toBe('#10191F');
  });

  it('never lands on the root background — that IS the bug being fixed', () => {
    // Light: the white band under the composer. Dark: the near-black bands at
    // both edges against the lighter chat chrome.
    for (const tone of [
      waChatChromeOpaque(lightColors.chatWallpaper, false),
      waComposerBarOpaque(lightColors.chatWallpaper, false),
    ]) {
      expect(tone.toLowerCase()).not.toBe(lightColors.background.toLowerCase());
    }
    for (const tone of [
      waChatChromeOpaque(darkColors.chatWallpaper, true),
      waComposerBarOpaque(darkColors.chatWallpaper, true),
    ]) {
      expect(tone.toLowerCase()).not.toBe(darkColors.background.toLowerCase());
      // …and it must be LIGHTER than the near-black wallpaper base, matching
      // the chrome the strip sits against.
      expect(parseInt(tone.slice(1), 16)).toBeGreaterThan(
        parseInt(darkColors.chatWallpaper.replace('#', ''), 16)
      );
    }
  });
});
