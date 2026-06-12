/**
 * Deep links into the Togather app used throughout the guides.
 *
 * `APP_BASE` is the web base URL for the Togather app (the Expo web build that
 * hosts admin, onboarding, and community settings). Adjust this single constant
 * if the app moves to a different host. The mobile apps also register the
 * `togather://` custom scheme, so the same paths resolve on device.
 *
 * NOTE: These are best-effort defaults. If a path changes in the app, update it
 * here and every guide picks up the new value.
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
  /** Community switcher — where a church can request to create a community. */
  communitySwitcher: `${APP_BASE}/communities`,
  /** Admin home. */
  admin: `${APP_BASE}/admin`,
  /** Community branding / appearance settings. */
  branding: `${APP_BASE}/admin/settings/branding`,
  /** Group types management. */
  groupTypes: `${APP_BASE}/admin/group-types`,
  /** Community-wide events. */
  communityWideEvents: `${APP_BASE}/admin/events`,
  /** Church feature flags (prayer, etc.). */
  features: `${APP_BASE}/admin/settings/features`,
  /** Groups list. */
  groups: `${APP_BASE}/groups`,
} as const;
