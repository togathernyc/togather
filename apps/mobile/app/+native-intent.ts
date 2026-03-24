import { parseSubdomainFromLinkUrl } from "@/features/auth/utils/communitySubdomain";

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
