/**
 * Console palette — warm light monospace/terminal with tan accent.
 * Derived from app/design-20.tsx ("Console"). Implements the full ThemeColors contract.
 */
import type { ThemeColors } from '../colors';

export const consoleColors: ThemeColors = {
  // Backgrounds
  background: '#F4EFE4',
  backgroundSecondary: '#EBE5D6',
  surface: '#FBF7EC',
  surfaceSecondary: '#FFFCF3',

  // Text
  text: '#1C1A16',
  textSecondary: '#5F594E',
  textTertiary: '#9A9387',
  textInverse: '#FBF7EC',

  // Borders
  border: 'rgba(28,26,22,0.10)',
  borderLight: 'rgba(28,26,22,0.05)',

  // Buttons
  buttonPrimary: '#1C1A16',
  buttonPrimaryText: '#FBF7EC',
  buttonSecondary: '#FBF7EC',
  buttonSecondaryText: '#1C1A16',
  buttonDisabled: 'rgba(28,26,22,0.10)',
  buttonDisabledText: '#9A9387',

  // Chat
  chatBubbleOwn: 'rgba(204,122,26,0.20)',
  chatBubbleOther: '#FBF7EC',
  chatBubbleOwnText: '#1C1A16',
  chatBubbleOtherText: '#1C1A16',

  // Status (semantic)
  error: '#B03030',
  success: '#5B7A3E',
  warning: '#CC7A1A',

  // System
  tabBar: '#FBF7EC',
  tabBarBorder: 'rgba(28,26,22,0.10)',
  tabBarInactive: '#9A9387',
  overlay: 'rgba(28,26,22,0.5)',
  shadow: '#1C1A16',
  inputBackground: '#FFFCF3',
  inputBorder: 'rgba(28,26,22,0.10)',
  inputBorderFocused: '#CC7A1A',
  inputPlaceholder: '#9A9387',
  skeleton: 'rgba(28,26,22,0.08)',
  icon: '#5F594E',
  iconSecondary: '#9A9387',
  link: '#CC7A1A',
  destructive: '#B03030',
  selectedBackground: 'rgba(204,122,26,0.12)',
  landing: '#1C1A16',
  modalBackground: '#FBF7EC',
  modalCloseBackground: 'rgba(251,247,236,0.9)',
};
