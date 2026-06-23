/**
 * CenteredColumn — desktop/web max-width centering for rostering screens.
 *
 * On wide viewports (web in a desktop window) the rostering hub screens would
 * otherwise stretch a phone-shaped column edge-to-edge across 1440px, leaving a
 * sea of whitespace. This wraps a screen's content in a comfortable, centered
 * reading column on `isWide`; below the breakpoint it's a transparent pass-through
 * so mobile renders pixel-identically.
 *
 * Used by EventListScreen, EventEditorScreen, RosteringTeamsScreen, and
 * RosteringCrossTeamScreen. The shared breakpoint is `width >= 700`, matching
 * the roster grid (RosterGridScreen).
 */
import React from "react";
import { View, useWindowDimensions, type ViewStyle } from "react-native";

/** Shared desktop breakpoint for the rostering feature. */
export const ROSTERING_WIDE_BREAKPOINT = 700;

/** Comfortable reading width for the centered content column on desktop. */
const MAX_CONTENT_WIDTH = 820;

export function CenteredColumn({
  children,
  style,
}: {
  children: React.ReactNode;
  /** Extra style for the inner column (e.g. flex:1 for full-height screens). */
  style?: ViewStyle;
}) {
  const { width } = useWindowDimensions();
  const isWide = width >= ROSTERING_WIDE_BREAKPOINT;

  if (!isWide) {
    // Mobile: transparent pass-through — identical to having no wrapper.
    return <>{children}</>;
  }

  return (
    <View
      style={[
        { width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
        style,
      ]}
    >
      {children}
    </View>
  );
}
