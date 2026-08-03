import { CardProviderScreen } from "@features/finance/leader/CardProviderScreen";

/**
 * `/finance-setup/card-provider` — connect (or disconnect) the community's own
 * card issuer (ADR-033 Phase 3).
 *
 * WHY HERE AND NOT `/(user)/you/admin/*`. The entry point for this screen is
 * the "Card provider" quick link in `features/admin/components/SettingsContent`,
 * next to the existing "Community Finance" one — and `SettingsContent` renders
 * in BOTH shells (inside `/(user)/you/admin/community` when the WhatsApp shell
 * flag is on, inside the legacy `AdminScreen` when it's off). A route under
 * `you/admin` is wrapped in `YouSubScreen`, which redirects to the profile tab
 * whenever that flag is off — so a flag-off admin tapping the quick link would
 * be bounced instead of landing here. `/finance-setup` is the flag-free,
 * `UserRoute`-guarded route group the sibling quick link already opens, so the
 * two community-finance destinations live together and work in either shell.
 *
 * Access is gated by the screen itself, not this file: financial-controls
 * access is "primary admin OR an active grant", which no client-side hook can
 * answer. See CardProviderScreen.tsx.
 */
export default CardProviderScreen;
