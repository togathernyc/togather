import { CommunityFinanceHomeScreen } from "@features/finance/leader/CommunityFinanceHomeScreen";

/**
 * `/finance-setup` — the community's Finance home.
 *
 * This route used to be the onboarding checklist and only that, which meant a
 * community whose setup was finished opened it to four ticked boxes and no way
 * onward. The home ABSORBS that checklist (it still takes the screen over
 * while giving isn't live, so the setup flow and Stripe's return URL are
 * unchanged) and becomes the parent of `/finance-setup/card-provider` and
 * `/finance-setup/financial-controls` — both of which keep their own routes,
 * so existing deep links still land.
 */
export default CommunityFinanceHomeScreen;
