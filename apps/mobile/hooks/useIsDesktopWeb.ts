import { useState, useEffect } from "react";
import { Platform, Dimensions } from "react-native";

const DESKTOP_BREAKPOINT = 768;

function getIsDesktopWeb(): boolean {
  if (Platform.OS !== "web") return false;
  return Dimensions.get("window").width >= DESKTOP_BREAKPOINT;
}

/**
 * Returns true when running on web with viewport width >= 768px.
 * Responds to window resize events.
 */
export function useIsDesktopWeb(): boolean {
  const [isDesktop, setIsDesktop] = useState(getIsDesktopWeb);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setIsDesktop(window.width >= DESKTOP_BREAKPOINT);
    });

    return () => subscription.remove();
  }, []);

  return isDesktop;
}
