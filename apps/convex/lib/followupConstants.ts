/**
 * Shared constants for follow-up functionality
 *
 * Used by both memberFollowups.ts and groups/mutations.ts for consistent validation.
 */

/**
 * Valid custom field slot names for memberFollowupScores.
 * These map to schema fields: customText1-5, customNum1-5, customBool1-5.
 */
export const VALID_CUSTOM_SLOTS = new Set([
  "customText1",
  "customText2",
  "customText3",
  "customText4",
  "customText5",
  "customNum1",
  "customNum2",
  "customNum3",
  "customNum4",
  "customNum5",
  "customBool1",
  "customBool2",
  "customBool3",
  "customBool4",
  "customBool5",
  "customBool6",
  "customBool7",
  "customBool8",
  "customBool9",
  "customBool10",
]);
