/**
 * Client half of the duplicate-plan-date guard.
 *
 * The backend (`scheduling/events.ts`) refuses to put a second plan on a local
 * calendar day a group already has one on, throwing a typed
 * `DUPLICATE_PLAN_DATE` ConvexError rather than silently creating the
 * duplicate. It is an error and not idempotent reuse because two services on
 * one Sunday is normal — so the leader has to be ASKED, not overruled.
 *
 * These helpers turn that error into the question and back into an intent.
 * Kept out of the components so the parsing (which reaches into an untyped
 * error payload) and the wording are unit-testable without mounting the grid.
 */
import { chooseAsync } from "@/utils/platformAlert";

/** The payload `assertPlanDateFree` attaches to the thrown ConvexError. */
export type DuplicatePlanDate = {
  /** The plan already on that day (the earliest-created one). */
  existingPlanId: string;
  existingPlanTitle: string;
  existingEventDate: number;
  /** "Sun, Aug 3", already rendered in the community's timezone. */
  dayLabel: string;
  /** How many other plans sit on that day. Usually 1. */
  existingCount: number;
};

/** What the leader decided when told the date is taken. */
export type DuplicatePlanChoice = "open-existing" | "add-another" | "cancel";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Recognise the typed duplicate-date error and pull out what the prompt needs.
 * Returns `null` for anything else, so callers fall through to their normal
 * error handling.
 *
 * `data` arrives as an object from a real Convex client; some transports hand
 * back the JSON string it was wired as, so both are accepted.
 */
export function parseDuplicatePlanDate(e: unknown): DuplicatePlanDate | null {
  const err = asRecord(e);
  if (!err) return null;

  let payload = err.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const data = asRecord(payload);
  if (!data || data.code !== "DUPLICATE_PLAN_DATE") return null;
  if (
    typeof data.existingPlanId !== "string" ||
    typeof data.existingPlanTitle !== "string" ||
    typeof data.existingEventDate !== "number" ||
    typeof data.dayLabel !== "string"
  ) {
    return null;
  }

  return {
    existingPlanId: data.existingPlanId,
    existingPlanTitle: data.existingPlanTitle,
    existingEventDate: data.existingEventDate,
    dayLabel: data.dayLabel,
    existingCount:
      typeof data.existingCount === "number" ? data.existingCount : 1,
  };
}

/** The body copy shown when a date is already planned. */
export function duplicatePlanMessage(info: DuplicatePlanDate): string {
  const others =
    info.existingCount > 1
      ? ` (${info.existingCount} plans are on that date.)`
      : "";
  return `"${info.existingPlanTitle}" is already on ${info.dayLabel}.${others} Open it, or add a second plan for the same day — for example a 9 AM and an 11 AM service?`;
}

/**
 * Ask the leader what they meant. "Open it" is the primary action: an
 * accidental second tap is far more common than a genuine second service, and
 * opening the plan they already have is the non-destructive answer.
 */
export async function promptDuplicatePlanDate(
  info: DuplicatePlanDate,
): Promise<DuplicatePlanChoice> {
  const choice = await chooseAsync({
    title: `Already a plan on ${info.dayLabel}`,
    message: duplicatePlanMessage(info),
    primaryText: "Open the existing plan",
    secondaryText: "Add another anyway",
  });
  if (choice === "primary") return "open-existing";
  if (choice === "secondary") return "add-another";
  return "cancel";
}
