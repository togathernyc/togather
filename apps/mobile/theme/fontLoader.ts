/**
 * Theme font loader.
 *
 * Native (iOS/Android): loads the required TTF variants for the active theme via
 * expo-font. Returns `{ loaded: false }` until all TTFs are registered, so the
 * provider can hold the tree until text renders in the right typeface.
 *
 * Web: expo-font's web shim technically works, but we instead inject the
 * appropriate Google Fonts <link> so CSS handles weight selection naturally
 * (matching how the static design explorations load fonts in useWebFonts).
 * Web always returns `loaded: true` immediately — the <link> swap is async but
 * non-blocking, and pre-paint text renders in the fallback CSS stack.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Font from 'expo-font';
import type { ThemePreference } from './preferences';

// ---- Native font asset registration ---------------------------------------

// Lazy requires so the bundler only pulls in what's needed for the active theme.
// Each map registers weights at keys that match the strings in fonts.ts.
function hearthNativeFonts(): Record<string, number> {
  const {
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  } = require('@expo-google-fonts/fraunces');
  const {
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  } = require('@expo-google-fonts/dm-sans');
  return {
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  };
}

function consoleNativeFonts(): Record<string, number> {
  const {
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  } = require('@expo-google-fonts/jetbrains-mono');
  const {
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  } = require('@expo-google-fonts/manrope');
  return {
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  };
}

function conservatoryNativeFonts(): Record<string, number> {
  const {
    Literata_400Regular,
    Literata_500Medium,
    Literata_600SemiBold,
    Literata_700Bold,
  } = require('@expo-google-fonts/literata');
  const {
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  } = require('@expo-google-fonts/manrope');
  return {
    Literata_400Regular,
    Literata_500Medium,
    Literata_600SemiBold,
    Literata_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  };
}

function getNativeFontMap(preference: ThemePreference): Record<string, number> | null {
  switch (preference) {
    case 'hearth':
      return hearthNativeFonts();
    case 'console':
      return consoleNativeFonts();
    case 'conservatory':
      return conservatoryNativeFonts();
    default:
      return null; // system fonts only
  }
}

// ---- Web font <link> injection -------------------------------------------

const WEB_FONT_HREFS: Record<ThemePreference, string | null> = {
  auto: null,
  light: null,
  dark: null,
  hearth:
    'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;700&display=swap',
  console:
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Manrope:wght@400;500;700&display=swap',
  conservatory:
    'https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,500;7..72,600;7..72,700&family=Manrope:wght@400;500;700&display=swap',
};

const WEB_LINK_ID = 'togather-theme-fonts';

function applyWebFontLink(preference: ThemePreference): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const href = WEB_FONT_HREFS[preference];
  const existing = document.getElementById(WEB_LINK_ID) as HTMLLinkElement | null;
  if (!href) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    if (existing.href !== href) existing.href = href;
    return;
  }
  const link = document.createElement('link');
  link.id = WEB_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// ---- Hook -----------------------------------------------------------------

/**
 * Loads the fonts for the active theme preference.
 *
 * - Native: resolves `loaded` to `true` once all TTFs are registered (or an
 *   error occurs; in which case we fall back to system fonts gracefully).
 * - Web: `loaded` is `true` immediately; the <link> is injected as a side effect.
 * - Default/light/dark themes: no fonts to load, `loaded` is `true` immediately.
 */
export function useThemeFonts(preference: ThemePreference): { loaded: boolean } {
  const needsNativeLoad = Platform.OS !== 'web' && (
    preference === 'hearth' || preference === 'console' || preference === 'conservatory'
  );
  const [nativeLoaded, setNativeLoaded] = useState(!needsNativeLoad);

  // Web <link> injection (side-effect, non-blocking)
  useEffect(() => {
    applyWebFontLink(preference);
  }, [preference]);

  // Native TTF registration
  useEffect(() => {
    if (!needsNativeLoad) {
      setNativeLoaded(true);
      return;
    }
    const map = getNativeFontMap(preference);
    if (!map) {
      setNativeLoaded(true);
      return;
    }
    let cancelled = false;
    setNativeLoaded(false);
    Font.loadAsync(map)
      .then(() => {
        if (!cancelled) setNativeLoaded(true);
      })
      .catch((err) => {
        // Fail open: if font loading errors, render in system fonts rather than
        // blocking the app. expo-font logs the error internally.
        if (__DEV__) console.warn('[useThemeFonts] load failed', err);
        if (!cancelled) setNativeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [preference, needsNativeLoad]);

  return { loaded: nativeLoaded };
}
