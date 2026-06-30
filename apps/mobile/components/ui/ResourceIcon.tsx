/**
 * ResourceIcon - renders a group resource's icon across icon families.
 *
 * Resource icons are stored as a single string. To support icons that Ionicons
 * doesn't have (e.g. praying hands, palms-up), a name may be prefixed with a
 * family tag:
 *   - `"home-outline"`      -> Ionicons (default, backward compatible)
 *   - `"mci:hands-pray"`    -> MaterialCommunityIcons
 *
 * Both families ship inside `@expo/vector-icons`, so no new native dependency is
 * introduced. Keeping the parsing in one component means every render site
 * (toolbar, inbox, detail page, picker, public page) stays consistent.
 */
import React from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

const MCI_PREFIX = "mci:";

/**
 * Curated icon options shown in the resource icon picker. Plain strings render
 * with Ionicons; `mci:`-prefixed strings render with MaterialCommunityIcons.
 * Includes church/community use-cases (giving, prayer, home groups, worship)
 * that motivated the multi-family support.
 */
export const RESOURCE_ICON_OPTIONS = [
  "document-outline",
  "book-outline",
  "people-outline",
  "heart-outline",
  "star-outline",
  "school-outline",
  "information-circle-outline",
  "hand-right-outline",
  "megaphone-outline",
  "calendar-outline",
  "home-outline",
  "cash-outline",
  "gift-outline",
  "mci:hand-heart",
  "mci:hands-pray",
  "mci:meditation",
  "mci:human-handsup",
  "mci:church",
  "mci:cross",
  "mci:charity",
] as const;

export const DEFAULT_RESOURCE_ICON = "document-outline";

export interface ResourceIconProps {
  /** Icon name, optionally `mci:`-prefixed. Falls back to the default icon. */
  name?: string | null;
  size: number;
  color: string;
  style?: StyleProp<TextStyle>;
}

export function ResourceIcon({ name, size, color, style }: ResourceIconProps) {
  const resolved = name || DEFAULT_RESOURCE_ICON;

  if (resolved.startsWith(MCI_PREFIX)) {
    const glyph = resolved.slice(MCI_PREFIX.length);
    return (
      <MaterialCommunityIcons
        name={glyph as keyof typeof MaterialCommunityIcons.glyphMap}
        size={size}
        color={color}
        style={style}
      />
    );
  }

  return (
    <Ionicons
      name={resolved as keyof typeof Ionicons.glyphMap}
      size={size}
      color={color}
      style={style}
    />
  );
}
