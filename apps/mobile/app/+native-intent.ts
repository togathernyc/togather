import { Linking } from "react-native";
import { parseSubdomainFromLinkUrl } from "@/features/auth/utils/communitySubdomain";

// Web-only paths that should never be handled by the app.
// If iOS universal links intercept these, bounce them to the browser.
const WEB_ONLY_PREFIXES = ["/onboarding/", "/admin/", "/billing/"];

/**
 * Intercepts incoming universal link URLs before Expo Router strips the hostname.
 *
 * When a user taps `https://fount.togather.nyc/nearme`, Expo Router extracts only
 * the path (`/nearme`) for routing, discarding the hostname that contains the
 * community subdomain. This hook appends `?subdomain=fount` to the URL so the
 * subdomain arrives as a route parameter in the destination screen.
 *
 * Called by Expo Router for both cold starts (initial: true) and warm starts
 * (initial: false), so it handles all deep link scenarios.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  // Bounce web-only URLs back to the browser
  try {
    const url = new URL(path);
    if (WEB_ONLY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      Linking.openURL(path);
      // Return root so the app doesn't navigate to a broken route
      return "/";
    }
  } catch {
    // Not a full URL — check raw path
    if (WEB_ONLY_PREFIXES.some((p) => path.startsWith(p))) {
      return "/";
    }
  }

  const subdomain = parseSubdomainFromLinkUrl(path);
  if (!subdomain) return path;

  try {
    const url = new URL(path);
    // Don't duplicate if already present
    if (url.searchParams.has("subdomain")) return path;
    url.searchParams.set("subdomain", subdomain);
    return url.toString();
  } catch {
    return path;
  }
}
