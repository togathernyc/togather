/**
 * Deep links into the Togather app used throughout the guides.
 *
 * `APP_BASE` is the web base URL for the Togather app (the Expo web build that
 * hosts admin, onboarding, and community settings). Adjust this single constant
 * if the app moves to a different host. The mobile apps also register the
 * `togather://` custom scheme, so the same paths resolve on device.
 *
 * Paths mirror the Expo Router routes in `apps/mobile/app` with route groups
 * (`(auth)`, `(tabs)`, `(user)`) stripped, which is how they resolve on web. If a
 * route changes in the app, update it here and every guide picks up the value.
 */
export const APP_BASE =
  (import.meta.env.VITE_APP_BASE_URL as string | undefined) ?? "https://app.togather.nyc";

/** Custom URL scheme registered by the mobile apps (apps/mobile/app.json). */
export const APP_SCHEME = "togather://";

/**
 * Named in-app destinations. Web links use `APP_BASE`; on a phone with the app
 * installed the same path can be opened via the `togather://` scheme.
 */
export const appLinks = {
  /** Community switcher (`(auth)/select-community`) — request/join a community. */
  communitySwitcher: `${APP_BASE}/select-community`,
  /** Admin settings screen (`(tabs)/admin`). */
  admin: `${APP_BASE}/admin`,
  /** Branding lives in the admin settings screen (Basic Information / Branding Colors). */
  branding: `${APP_BASE}/admin`,
  /** Group types live in the admin settings screen (Group Types section). */
  groupTypes: `${APP_BASE}/admin`,
  /** Community-wide events (`(user)/admin/community-wide-events`). */
  communityWideEvents: `${APP_BASE}/admin/community-wide-events`,
  /** Church feature flags incl. prayer (`(user)/admin/features`). */
  features: `${APP_BASE}/admin/features`,
  /** Groups tab (`(tabs)/groups`). */
  groups: `${APP_BASE}/groups`,
} as const;
