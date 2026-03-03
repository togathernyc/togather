/**
 * Dev Tools Escape Hatch Hook
 *
 * Provides a way for users to enable developer tools in production
 * by tapping on the version number 5 times in quick succession.
 *
 * This is useful for:
 * - Testing production-only issues
 * - Debugging user-reported problems
 * - Accessing developer features without a dev build
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEV_TOOLS_ENABLED_KEY = "togather_dev_tools_enabled";
const REQUIRED_TAPS = 5;
const TAP_TIMEOUT_MS = 3000; // Reset after 3 seconds of inactivity

interface UseDevToolsEscapeHatchReturn {
  /** Whether dev tools should be shown (enabled via escape hatch) */
  isEnabled: boolean;
  /** Call this when user taps on the version number */
  handleVersionTap: () => void;
  /** Current tap count (for UI feedback if needed) */
  tapCount: number;
  /** Disable the escape hatch */
  disable: () => Promise<void>;
}

export function useDevToolsEscapeHatch(): UseDevToolsEscapeHatchReturn {
  const [isEnabled, setIsEnabled] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load stored state on mount
  useEffect(() => {
    const loadState = async () => {
      try {
        const stored = await AsyncStorage.getItem(DEV_TOOLS_ENABLED_KEY);
        if (stored === "true") {
          setIsEnabled(true);
        }
      } catch (error) {
        console.error("Failed to load dev tools state:", error);
      }
    };
    loadState();
  }, []);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
    };
  }, []);

  const handleVersionTap = useCallback(() => {
    // Clear existing timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    // Use functional update to avoid stale closure over tapCount
    setTapCount((prevCount) => {
      const newTapCount = prevCount + 1;

      // Check if we've reached the required number of taps
      if (newTapCount >= REQUIRED_TAPS) {
        // Enable dev tools
        const enable = async () => {
          try {
            await AsyncStorage.setItem(DEV_TOOLS_ENABLED_KEY, "true");
            setIsEnabled(true);
            setTapCount(0);
            Alert.alert(
              "Developer Mode Enabled",
              "Developer tools are now visible in the Profile screen. Go back to Profile to see the changes.",
              [{ text: "OK" }]
            );
          } catch (error) {
            console.error("Failed to enable dev tools:", error);
          }
        };
        enable();
        return 0; // Reset immediately
      } else {
        // Set timeout to reset tap count
        tapTimeoutRef.current = setTimeout(() => {
          setTapCount(0);
        }, TAP_TIMEOUT_MS);

        return newTapCount;
      }
    });
  }, []); // Remove tapCount from dependencies

  const disable = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(DEV_TOOLS_ENABLED_KEY);
      setIsEnabled(false);
    } catch (error) {
      console.error("Failed to disable dev tools:", error);
    }
  }, []);

  return {
    isEnabled,
    handleVersionTap,
    tapCount,
    disable,
  };
}

/**
 * Check if dev tools escape hatch is enabled (non-hook version)
 * Useful for components that only need to read the value
 */
export async function isDevToolsEscapeHatchEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(DEV_TOOLS_ENABLED_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}
