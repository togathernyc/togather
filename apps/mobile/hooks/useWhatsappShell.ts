/**
 * useWhatsappShell
 *
 * Single source of truth for whether the WhatsApp-style 4-tab shell
 * (Chats · Events · Prayer · You) is active for the current user, per
 * docs/plans/church-migration-ui-redesign/README.md §9.5 ("everything
 * behind one flag").
 *
 * Composes three flag sources:
 *   - PostHog flag `"whatsapp-shell"` (`useFeatureFlag`) — the rollout
 *     lever, targeted per community/cohort so pilot churches can run the
 *     new shell while everyone else keeps today's app.
 *   - Convex `featureFlags` force-on `"whatsapp-shell-on"`
 *     (`useConvexFeatureFlag`) — a staff-managed global enable for
 *     environments where PostHog isn't set up (e.g. staging). System-wide:
 *     it cannot target individual communities; use PostHog for that.
 *   - Convex `featureFlags` kill-switch `"whatsapp-shell-kill"` — a
 *     staff-managed global override that, when on, forces the shell off
 *     everywhere regardless of the other two sources.
 *
 * Enabled when (PostHog says on OR the Convex force-on is on) AND the
 * kill-switch is confirmed off. Defaults to `false` while the Convex flags
 * are still loading (or errored) — flag-off is the safe default, never
 * flag-on.
 */
import { useFeatureFlag } from "./useFeatureFlag";
import { useConvexFeatureFlag } from "./useConvexFeatureFlag";

const POSTHOG_FLAG_KEY = "whatsapp-shell";
const FORCE_ON_FLAG_KEY = "whatsapp-shell-on";
const KILL_SWITCH_FLAG_KEY = "whatsapp-shell-kill";

export function useWhatsappShell(): boolean {
  const posthogEnabled = useFeatureFlag(POSTHOG_FLAG_KEY);
  const { enabled: forceOnEnabled, loaded: forceOnLoaded } =
    useConvexFeatureFlag(FORCE_ON_FLAG_KEY);
  const { enabled: killSwitchEnabled, loaded: killSwitchLoaded } =
    useConvexFeatureFlag(KILL_SWITCH_FLAG_KEY);

  // Convex flag state isn't confirmed yet — stay on the current shell
  // rather than risk showing the new one before we know it's not been
  // force-disabled (or flashing it off for force-on users).
  if (!killSwitchLoaded || !forceOnLoaded) return false;

  return (posthogEnabled || forceOnEnabled) && !killSwitchEnabled;
}
