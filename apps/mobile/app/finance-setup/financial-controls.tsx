import { FinancialControlsScreen } from "@features/finance/leader/FinancialControlsScreen";

/**
 * `/finance-setup/financial-controls` — who can run this community's money
 * (ADR-033 §5).
 *
 * Lives under `/finance-setup` for the same reason as `card-provider.tsx` —
 * see that file's header for why a `/(user)/you/admin/*` route would strand
 * admins whose community doesn't have the WhatsApp shell flag on.
 */
export default FinancialControlsScreen;
