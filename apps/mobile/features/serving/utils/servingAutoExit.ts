/**
 * When serving mode should let go of the user by itself.
 *
 * Serving mode is persisted (`eventModeStore.isServingMode`) and nothing but
 * the Exit tab ever cleared it. That was survivable while an empty
 * `servingPlanIds` meant "don't filter": a volunteer who never tapped Exit just
 * saw their normal inbox. Now an empty list means "empty serving inbox", so
 * once the day's plans age out (`planEndsAt` = last service + 4h) they'd be
 * stranded with an empty Chats list, Runsheet and Tasks.
 *
 * Pure so the "resolved vs still loading" distinction is unit-testable without
 * mounting the inbox screen.
 */
export type ServingAutoExitInput = {
  /** Serving mode is on AND the community still has the feature enabled. */
  inServingMode: boolean;
  /** The upcoming plan opened early, or null when serving normally. */
  previewPlanId: string | null;
  /**
   * `getServingEligibility` has returned. False while it is loading OR skipped
   * — never exit on an unresolved query.
   */
  eligibilityResolved: boolean;
  /**
   * How many plans the serving surfaces would render. This is the value AFTER
   * the offline cache (`useCachedServingPlans`) has had its say, so a cold or
   * offline launch that still has cached plans keeps serving mode.
   */
  planCount: number;
};

export function shouldAutoExitServing({
  inServingMode,
  previewPlanId,
  eligibilityResolved,
  planCount,
}: ServingAutoExitInput): boolean {
  if (!inServingMode) return false;
  // A preview that can't be resolved is a different story: the Runsheet and
  // Tasks tabs explain it ("this event isn't available to preview anymore")
  // instead of silently dumping the user back into the normal inbox.
  if (previewPlanId) return false;
  if (!eligibilityResolved) return false;
  return planCount === 0;
}
