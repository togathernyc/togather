/**
 * Conservatory palette — pastel glass with teal accent.
 * Derived from app/design-28.tsx ("Conservatory"). Implements the full ThemeColors contract.
 * Note: the design's translucent `glass*` tokens are opaquified here for surfaces
 * used across the app that don't sit over a photo backdrop.
 */
import type { ThemeColors } from '../colors';

export const conservatoryColors: ThemeColors = {
  // Backgrounds
  background: '#E4E8DE',
  backgroundSecondary: '#D8DED2',
  surface: '#F0F2EC',
  surfaceSecondary: '#F7F8F4',

  // Text
  text: '#1B2620',
  textSecondary: '#4C5A51',
  textTertiary: '#8A9489',
  textInverse: '#F0F2EC',

  // Borders
  border: 'rgba(27,38,32,0.10)',
  borderLight: 'rgba(27,38,32,0.05)',

  // Buttons
  buttonPrimary: '#1C6B5E',
  buttonPrimaryText: '#F0F2EC',
  buttonSecondary: '#F0F2EC',
  buttonSecondaryText: '#1B2620',
  buttonDisabled: 'rgba(27,38,32,0.10)',
  buttonDisabledText: '#8A9489',

  // Chat
  chatBubbleOwn: 'rgba(28,107,94,0.14)',
  chatBubbleOther: '#F0F2EC',
  chatBubbleOwnText: '#1B2620',
  chatBubbleOtherText: '#1B2620',

  // Status (semantic)
  error: '#A43A3A',
  success: '#1C6B5E',
  warning: '#B08B3C',

  // System
  tabBar: '#E4E8DE',
  tabBarBorder: 'rgba(27,38,32,0.10)',
  tabBarInactive: '#8A9489',
  overlay: 'rgba(27,38,32,0.5)',
  shadow: '#1B2620',
  inputBackground: '#F7F8F4',
  inputBorder: 'rgba(27,38,32,0.10)',
  inputBorderFocused: '#1C6B5E',
  inputPlaceholder: '#8A9489',
  skeleton: 'rgba(27,38,32,0.08)',
  icon: '#4C5A51',
  iconSecondary: '#8A9489',
  link: '#1C6B5E',
  destructive: '#A43A3A',
  selectedBackground: 'rgba(28,107,94,0.14)',
  landing: '#1B2620',
  modalBackground: '#F0F2EC',
  modalCloseBackground: 'rgba(240,242,236,0.9)',
};
