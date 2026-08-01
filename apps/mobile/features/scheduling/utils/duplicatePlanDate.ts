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
import { chooseAsync, confirmAsync } from "@/utils/platformAlert";
import { errorMessage } from "@utils/error-handling";

/**
 * The `code` on the ConvexError this module recognises.
 *
 * MIRRORS `DUPLICATE_PLAN_DATE` in `apps/convex/functions/scheduling/events.ts`
 * — the two must stay identical or every date collision silently becomes an
 * unhandled error again. The literal cannot be imported: that module pulls in
 * `_generated/server`, and this codebase deliberately never imports Convex
 * runtime code into the mobile bundle (it mirrors constants instead — see
 * `chatSendErrors.ts`, `INBOX_EVENT_HIDE_AFTER_MS`). The pin is a test:
 * `__tests__/duplicatePlanDate.test.ts` reads the backend file and fails if
 * the two drift.
 */
export const DUPLICATE_PLAN_DATE = "DUPLICATE_PLAN_DATE";

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
  if (!data || data.code !== DUPLICATE_PLAN_DATE) return null;
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

/** What {@link savePlanDate} did with the value the picker produced. */
export type SavePlanDateOutcome = "saved" | "ignored" | "cancelled" | "failed";

/**
 * Persist a plan's new date, resolving the one thing that can go wrong: the
 * group already has a plan on the day the leader picked.
 *
 * Shared by every date editor (the roster grid's column header, the desktop
 * panel, and the full-screen editor) because they must not drift: the
 * full-screen editor is where BOTH "＋ Add date" and "Duplicate" push the
 * leader to set the new plan's date, and while it lacked this handling a
 * second service on an occupied Sunday was unreachable from it — the leader
 * got a raw ConvexError body instead (`.message` is a hybrid stacktrace with
 * the serialized payload embedded; only `.data` carries the object).
 *
 * @param date The picker's value. `null` — a dismissed native picker — is a
 *   no-op, as are the intermediate values a web `<input type="date">` fires
 *   per keystroke while the year is typed digit by digit ("0026" is a
 *   complete, valid date). Without that filter a keystroke could both strand
 *   the plan in the far past and pop a blocking confirm mid-typing.
 * @param save `updateEvent` bound to the plan.
 * @param onError Surface a failure — the caller owns the alert's title.
 */
export async function savePlanDate(args: {
  date: Date | null;
  save: (eventDate: number, allowSameDay?: boolean) => Promise<unknown>;
  onError: (message: string) => void;
}): Promise<SavePlanDateOutcome> {
  const { date, save, onError } = args;
  if (!date) return "ignored";
  const ms = date.getTime();
  if (Number.isNaN(ms)) return "ignored";
  const year = date.getFullYear();
  if (year < 2000 || year > 3000) return "ignored";

  try {
    await save(ms);
    return "saved";
  } catch (e) {
    // A group holds one plan per local day unless the leader says otherwise —
    // but moving a plan alongside an existing service is a real thing to want,
    // so ask instead of refusing.
    const duplicate = parseDuplicatePlanDate(e);
    if (!duplicate) {
      onError(errorMessage(e, "Please try again."));
      return "failed";
    }
    const ok = await confirmAsync({
      title: `Already a plan on ${duplicate.dayLabel}`,
      message: `"${duplicate.existingPlanTitle}" is already on that date. Move this plan there anyway, so the day has two?`,
      confirmText: "Move it there",
    });
    if (!ok) return "cancelled";
    try {
      await save(ms, true);
      return "saved";
    } catch (e2) {
      onError(errorMessage(e2, "Please try again."));
      return "failed";
    }
  }
}
