import { getGroupTypeColorScheme } from '../../../constants/groupTypes';

/**
 * Gets the color scheme for a group type.
 * Works with any group type ID by using dynamic color generation.
 */
export function getGroupTypeColors(type: number): {
  bg: string;
  color: string;
} {
  return getGroupTypeColorScheme(type);
}

