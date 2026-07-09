/**
 * SafeBlurView
 *
 * Drop-in replacement for expo-blur's BlurView that gracefully falls back to
 * a plain translucent View when the native module is not available (e.g., on
 * native builds where ExpoBlurView's Fabric view adapter crashes at render, or
 * older native builds receiving OTA updates).
 *
 * See ADR-013 for the native dependency gating strategy.
 */

import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import { isBlurSupported } from "@/features/chat/utils/fileTypes";

type BlurTint = "light" | "dark" | "default" | string;

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

/** Solid background approximating the blur tint when the native view is absent. */
function fallbackBackground(tint: BlurTint): string {
  if (tint === "light") return "rgba(255, 255, 255, 0.85)";
  return "rgba(0, 0, 0, 0.6)"; // dark / default
}

/**
 * Renders expo-blur's BlurView if the native module is available, otherwise
 * renders a plain translucent View so overlays still dim their backdrop
 * instead of crashing.
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

  return (
    <View style={[{ backgroundColor: fallbackBackground(tint) }, style]}>
      {children}
    </View>
  );
}
