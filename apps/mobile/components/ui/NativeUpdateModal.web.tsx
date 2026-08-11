/**
 * NativeUpdateModal (Web) - No-op
 *
 * The native modal force-blocks the app when the R2 release manifest reports a
 * newer *native* build than the one the user installed. That question is
 * meaningless on web: togather.nyc always serves the latest deployed export, so
 * there is nothing for a visitor to update, and the modal's only action ("Open
 * App Store") sends them to an iOS binary that has no bearing on the page they
 * are looking at.
 *
 * Without this stub the native component shipped in the web export and compared
 * the version baked into the deployed bundle against the iOS manifest. Bumping
 * that manifest to 1.0.22 put every web visitor behind an undismissable
 * "Update Required" dialog on /signin — the sign-in page is served by this
 * Expo web export, not by apps/web (see apps/link-preview/cloudflare-worker.js).
 */
export function NativeUpdateModal() {
  return null;
}
