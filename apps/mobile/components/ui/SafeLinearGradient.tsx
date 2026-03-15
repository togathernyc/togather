/**
 * SafeLinearGradient
 *
 * Drop-in replacement for expo-linear-gradient's LinearGradient that
 * gracefully falls back to a plain View when the native module is not
 * available (e.g., on older native builds receiving OTA updates).
 *
 * See ADR-013 for the native dependency gating strategy.
 */

import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import { isLinearGradientSupported } from "@/features/chat/utils/fileTypes";

interface SafeLinearGradientProps {
  colors: string[];
  locations?: number[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

// Lazily resolve the real LinearGradient component
let _ResolvedGradient: React.ComponentType<any> | null = null;
let _resolved = false;

function getLinearGradient(): React.ComponentType<any> | null {
  if (_resolved) return _ResolvedGradient;
  _resolved = true;

  if (isLinearGradientSupported()) {
    try {
      const mod = require("expo-linear-gradient");
      _ResolvedGradient = mod.LinearGradient;
    } catch {
      _ResolvedGradient = null;
    }
  }

  return _ResolvedGradient;
}

/**
 * Renders expo-linear-gradient if the native module is available,
 * otherwise renders a plain View with the last gradient color as background.
 */
export function SafeLinearGradient({
  colors,
  locations,
  start,
  end,
  style,
  children,
}: SafeLinearGradientProps) {
  const RealGradient = getLinearGradient();

  if (RealGradient) {
    return (
      <RealGradient
        colors={colors}
        locations={locations}
        start={start}
        end={end}
        style={style}
      >
        {children}
      </RealGradient>
    );
  }

  // Fallback: use the last color as a solid background
  const fallbackColor = colors[colors.length - 1] ?? "transparent";

  return (
    <View style={[{ backgroundColor: fallbackColor }, style]}>
      {children}
    </View>
  );
}
