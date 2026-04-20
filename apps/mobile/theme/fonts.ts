/**
 * Theme font tokens. Each palette pairs with a font set; `defaultFonts` uses the
 * platform's system fonts (current behavior).
 *
 * Font family names are Platform-aware:
 *   - native: the exact key we load via expo-font (see fontLoader.ts). We load
 *     one regular-weight variant per role; bold Text renders as faux-bold on iOS
 *     (and approximately so on Android) — a v1 trade-off documented in the plan.
 *   - web: a CSS font stack. Google Fonts <link> is injected by the provider so
 *     the browser picks any weight from the stack.
 */
import { Platform } from 'react-native';

export type ThemeFonts = {
  /** Display / headings */
  display: string;
  /** Body text — applied app-wide via Text.defaultProps */
  body: string;
  /** Monospace / code / tag-like text */
  mono: string;
};

const SYSTEM_SANS = Platform.select({ default: 'System', web: 'system-ui, sans-serif' })!;
const SYSTEM_MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
  web: 'ui-monospace, monospace',
})!;

/** Current behavior: system fonts everywhere. */
export const defaultFonts: ThemeFonts = {
  display: SYSTEM_SANS,
  body: SYSTEM_SANS,
  mono: SYSTEM_MONO,
};

/** Hearth — warm dark serif. Display: Fraunces; body: DM Sans. */
export const hearthFonts: ThemeFonts = {
  display: Platform.select({ default: 'Fraunces_600SemiBold', web: '"Fraunces", Georgia, serif' })!,
  body: Platform.select({ default: 'DMSans_400Regular', web: '"DM Sans", system-ui, sans-serif' })!,
  mono: SYSTEM_MONO,
};

/** Console — light terminal. Body: Manrope; display/mono: JetBrains Mono. */
export const consoleFonts: ThemeFonts = {
  display: Platform.select({ default: 'JetBrainsMono_600SemiBold', web: '"JetBrains Mono", ui-monospace, monospace' })!,
  body: Platform.select({ default: 'Manrope_400Regular', web: '"Manrope", system-ui, sans-serif' })!,
  mono: Platform.select({ default: 'JetBrainsMono_500Medium', web: '"JetBrains Mono", ui-monospace, monospace' })!,
};

/** Conservatory — pastel glass. Display: Literata; body: Manrope. */
export const conservatoryFonts: ThemeFonts = {
  display: Platform.select({ default: 'Literata_600SemiBold', web: '"Literata", Georgia, serif' })!,
  body: Platform.select({ default: 'Manrope_400Regular', web: '"Manrope", system-ui, sans-serif' })!,
  mono: SYSTEM_MONO,
};
