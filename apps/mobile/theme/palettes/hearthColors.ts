/**
 * Hearth palette — warm dark serif with ember accent.
 * Derived from app/design-14.tsx ("Hearth"). Implements the full ThemeColors contract.
 */
import type { ThemeColors } from '../colors';

export const hearthColors: ThemeColors = {
  // Backgrounds
  background: '#15110E',
  backgroundSecondary: '#1A150F',
  surface: '#1E1915',
  surfaceSecondary: '#2A241F',

  // Text
  text: '#F5EEE3',
  textSecondary: '#9A8F80',
  textTertiary: '#6A6058',
  textInverse: '#15110E',

  // Borders
  border: 'rgba(245,238,227,0.08)',
  borderLight: 'rgba(245,238,227,0.04)',

  // Buttons
  buttonPrimary: '#E67A3C',
  buttonPrimaryText: '#15110E',
  buttonSecondary: '#2A241F',
  buttonSecondaryText: '#F5EEE3',
  buttonDisabled: '#2A241F',
  buttonDisabledText: '#6A6058',

  // Chat
  chatBubbleOwn: 'rgba(230,122,60,0.22)',
  chatBubbleOther: '#2A241F',
  chatBubbleOwnText: '#F5EEE3',
  chatBubbleOtherText: '#F5EEE3',

  // Status (semantic)
  error: '#FF6B4A',
  success: '#9AD38A',
  warning: '#F7A06B',

  // System
  tabBar: '#15110E',
  tabBarBorder: 'rgba(245,238,227,0.08)',
  tabBarInactive: '#6A6058',
  overlay: 'rgba(0,0,0,0.7)',
  shadow: '#000000',
  inputBackground: '#1E1915',
  inputBorder: 'rgba(245,238,227,0.08)',
  inputBorderFocused: 'rgba(230,122,60,0.40)',
  inputPlaceholder: '#6A6058',
  skeleton: '#2A241F',
  icon: '#9A8F80',
  iconSecondary: '#6A6058',
  link: '#E67A3C',
  destructive: '#FF6B4A',
  selectedBackground: 'rgba(230,122,60,0.14)',
  landing: '#15110E',
  modalBackground: '#1E1915',
  modalCloseBackground: 'rgba(30,25,21,0.9)',
};
