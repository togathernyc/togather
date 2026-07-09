import { Linking } from "react-native";
import { parseSubdomainFromLinkUrl } from "@/features/auth/utils/communitySubdomain";

// Web-only route roots that should never be handled by the app — they are
// served by the Vite web app (apps/web), not the Expo app. If a universal link
// intercepts one (e.g. because iOS is still using a stale cached AASA), bounce
// it to the browser instead of rendering a "Page Not Found" screen.
//
// Matched against the exact path OR any sub-path, so "/guides" and
// "/guides/branding" both bounce. Keep in sync with the AASA exclusions in
// apps/link-preview/cloudflare-worker.js and the web routes in
// apps/web/src/main.tsx.
const WEB_ONLY_ROOTS = [
  "/contribute",
  "/guides",
  "/developers",
  "/issue",
  "/legal",
  "/onboarding",
  "/admin",
  "/billing",
];

function isWebOnlyPath(pathname: string): boolean {
  return WEB_ONLY_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

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
    if (isWebOnlyPath(url.pathname)) {
      Linking.openURL(path);
      // Return root so the app doesn't navigate to a broken route
      return "/";
    }
  } catch {
    // Not a full URL — check raw path
    if (isWebOnlyPath(path)) {
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
