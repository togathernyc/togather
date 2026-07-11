/**
 * Plan Route
 *
 * Route: /dev/plan/[id]
 * The AI plan for one contribution, full-screen (phones / narrow web). On
 * desktop web the plan opens as a right-side panel inside the conversation
 * instead (see ContributionDetailScreen), so this route is effectively the
 * narrow-viewport presentation — parseDevRoute treats it as a standalone
 * surface (no sidebar).
 */

import { PlanScreen } from "@features/contribute/components/PlanView";

export default PlanScreen;
