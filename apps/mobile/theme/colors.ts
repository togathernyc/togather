/**
 * Theme Color Tokens - THE single source of truth for all colors in the app.
 *
 * Every component references tokens from this file via `useTheme()`.
 * To adjust any color across the entire app, change one value here.
 *
 * No hardcoded hex colors anywhere in components. Period.
 */

export type ThemeColors = {
  // Backgrounds
  background: string;
  backgroundSecondary: string;
  surface: string;
  surfaceSecondary: string;

  // Text
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  // Borders
  border: string;
  borderLight: string;

  // Buttons
  buttonPrimary: string;
  buttonPrimaryText: string;
  buttonSecondary: string;
  buttonSecondaryText: string;
  buttonDisabled: string;
  buttonDisabledText: string;

  // Chat
  chatBubbleOwn: string;
  chatBubbleOther: string;
  chatBubbleOwnText: string;
  chatBubbleOtherText: string;

  // Status (semantic)
  error: string;
  success: string;
  warning: string;

  // System
  tabBar: string;
  tabBarBorder: string;
  tabBarInactive: string;
  overlay: string;
  shadow: string;
  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
  inputPlaceholder: string;
  skeleton: string;
  icon: string;
  iconSecondary: string;
  link: string;
  destructive: string;
  selectedBackground: string;
  landing: string;
  modalBackground: string;
  modalCloseBackground: string;
};

export const lightColors: ThemeColors = {
  // Backgrounds
  background: '#ffffff',
  backgroundSecondary: '#f2f2f7',
  surface: '#ffffff',
  surfaceSecondary: '#f5f5f5',

  // Text
  text: '#1a1a1a',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textInverse: '#ffffff',

  // Borders
  border: '#e0e0e0',
  borderLight: '#ecedf0',

  // Buttons
  buttonPrimary: '#222224',
  buttonPrimaryText: '#ffffff',
  buttonSecondary: '#fafafa',
  buttonSecondaryText: '#222224',
  buttonDisabled: '#ccccd1',
  buttonDisabledText: '#ffffff',

  // Chat
  chatBubbleOwn: '#e0efff',
  chatBubbleOther: '#E5E5EA',
  chatBubbleOwnText: '#1a1a1a',
  chatBubbleOtherText: '#1a1a1a',

  // Status
  error: '#FF3B30',
  success: '#34C759',
  warning: '#FF9500',

  // System
  tabBar: '#ffffff',
  tabBarBorder: '#e0e0e0',
  tabBarInactive: '#999999',
  overlay: 'rgba(0, 0, 0, 0.5)',
  shadow: '#000000',
  inputBackground: '#ffffff',
  inputBorder: '#ecedf0',
  inputBorderFocused: '#222224',
  inputPlaceholder: '#bdbdc1',
  skeleton: '#e0e0e0',
  icon: '#666666',
  iconSecondary: '#bdbdc1',
  link: '#007AFF',
  destructive: '#FF3B30',
  selectedBackground: '#f9f5ff',
  landing: '#1a1a1a',
  modalBackground: '#ffffff',
  modalCloseBackground: 'rgba(255, 255, 255, 0.9)',
};

export const darkColors: ThemeColors = {
  // Backgrounds
  background: '#0b141a',
  backgroundSecondary: '#111b21',
  surface: '#1f2c34',
  surfaceSecondary: '#1a2730',

  // Text
  text: '#e9edef',
  textSecondary: '#8696a0',
  textTertiary: '#667781',
  textInverse: '#1a1a1a',

  // Borders
  border: '#233138',
  borderLight: '#1a2730',

  // Buttons — inverted in dark mode
  buttonPrimary: '#e9edef',
  buttonPrimaryText: '#0b141a',
  buttonSecondary: '#1f2c34',
  buttonSecondaryText: '#e9edef',
  buttonDisabled: '#233138',
  buttonDisabledText: '#667781',

  // Chat
  chatBubbleOwn: '#005c4b',
  chatBubbleOther: '#1f2c34',
  chatBubbleOwnText: '#e9edef',
  chatBubbleOtherText: '#e9edef',

  // Status
  error: '#FF453A',
  success: '#30D158',
  warning: '#FF9F0A',

  // System
  tabBar: '#0b141a',
  tabBarBorder: '#233138',
  tabBarInactive: '#667781',
  overlay: 'rgba(0, 0, 0, 0.7)',
  shadow: '#000000',
  inputBackground: '#1f2c34',
  inputBorder: '#233138',
  inputBorderFocused: '#8696a0',
  inputPlaceholder: '#667781',
  skeleton: '#233138',
  icon: '#8696a0',
  iconSecondary: '#667781',
  link: '#53bdeb',
  destructive: '#FF453A',
  selectedBackground: '#1a2730',
  landing: '#0b141a',
  modalBackground: '#1f2c34',
  modalCloseBackground: 'rgba(31, 44, 52, 0.9)',
};

// Design-theme palettes
export { hearthColors } from './palettes/hearthColors';
export { consoleColors } from './palettes/consoleColors';
export { conservatoryColors } from './palettes/conservatoryColors';
