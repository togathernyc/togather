/**
 * SafeBlurView
 *
 * Drop-in replacement for expo-blur's BlurView that gracefully falls back to a
 * plain semi-opaque View when the native module's Fabric view adapter is not
 * available (e.g., on the New Architecture, or on older native builds receiving
 * OTA updates). Without this guard, a missing view adapter throws an Invariant
 * Violation at render time and hard-crashes the screen:
 * `ViewManagerAdapter_ExpoBlurView ... must be a function (received undefined)`.
 *
 * See ADR-013 for the native dependency gating strategy.
 */

import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import { isBlurSupported } from "@/features/chat/utils/fileTypes";

type BlurTint = "light" | "dark" | "default" | (string & {});

interface SafeBlurViewProps {
  intensity?: number;
  tint?: BlurTint;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

// Lazily resolve the real BlurView component
let _ResolvedBlur: React.ComponentType<any> | null = null;
let _resolved = false;

function getBlurView(): React.ComponentType<any> | null {
  if (_resolved) return _ResolvedBlur;
  _resolved = true;

  if (isBlurSupported()) {
    try {
      const mod = require("expo-blur");
      _ResolvedBlur = mod.BlurView;
    } catch {
      _ResolvedBlur = null;
    }
  }

  return _ResolvedBlur;
}

/**
 * Renders expo-blur's BlurView if the native view is available, otherwise
 * renders a plain View with a solid scrim approximating the requested tint.
 */
export function SafeBlurView({
  intensity = 50,
  tint = "default",
  style,
  children,
}: SafeBlurViewProps) {
  const RealBlur = getBlurView();

  if (RealBlur) {
    return (
      <RealBlur intensity={intensity} tint={tint} style={style}>
        {children}
      </RealBlur>
    );
  }

  // Fallback: approximate the blur with a solid scrim. Opacity scales with the
  // requested intensity (0–100) so heavier blur reads as a darker/lighter veil.
  const alpha = Math.min(Math.max(intensity / 100, 0), 1);
  const fallbackColor =
    tint === "light"
      ? `rgba(255, 255, 255, ${alpha})`
      : `rgba(0, 0, 0, ${alpha})`;

  return (
    <View style={[{ backgroundColor: fallbackColor }, style]}>{children}</View>
  );
}
