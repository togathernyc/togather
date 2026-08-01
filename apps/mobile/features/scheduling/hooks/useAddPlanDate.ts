/**
 * useAddPlanDate
 *
 * Creating a draft plan at the roster's neutral default date, and resolving the
 * one thing that can go wrong with it: the group already has a plan that day.
 *
 * `nextSundayAtNine()` is DETERMINISTIC, so before the backend guard existed a
 * second tap of "＋ Add date" wrote a byte-identical second plan — the roster
 * grid then showed two indistinguishable columns, and a leader could author
 * tasks on one while being rostered on the other. The backend now rejects the
 * second plan with `DUPLICATE_PLAN_DATE` instead of silently writing it, and
 * this hook decides what that rejection means to the leader.
 *
 * Extracted from RosterGridScreen so both entry points (the ＋ button and the
 * quick-start fall-through) share one implementation and it can be tested
 * without mounting the 5k-line grid.
 */
import { useCallback } from "react";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import {
  parseDuplicatePlanDate,
  promptDuplicatePlanDate,
} from "../utils/duplicatePlanDate";

/** Next Sunday at 9:00 AM local time — the neutral default for a new plan. */
export function nextSundayAtNine(): Date {
  const d = new Date();
  const daysUntilSunday = (7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSunday);
  d.setHours(9, 0, 0, 0);
  return d;
}

/**
 * What to do when the default date is already planned.
 *
 *  - `"ask"` — put the choice to the leader. The ＋ Add date button: a second
 *    service on one Sunday (9 AM + 11 AM) is legitimate, so they decide.
 *  - `"open"` — go straight to the plan they already have. The quick-start
 *    fall-through: they asked to be set up, not for a second service.
 */
export type OnDuplicateDate = "ask" | "open";

export type AddPlanDateOutcome = "created" | "opened-existing" | "cancelled";

export function useAddPlanDate(args: {
  groupId: Id<"groups">;
  /** Navigate to a plan — used when the leader opens the one they have. */
  onOpenPlan: (planId: string) => void;
}) {
  const { groupId, onOpenPlan } = args;
  const createEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.createEvent,
  );

  /**
   * Create the plan. The title is left to the backend (`defaultPlanTitle`,
   * derived from the group) — the client used to send a literal "Untitled event
   * plan", which shipped through to serving mode's headers and read like a bug.
   *
   * Rethrows anything that isn't the duplicate-date collision, so callers keep
   * their existing error surfacing.
   */
  const addPlanDate = useCallback(
    async (onDuplicate: OnDuplicateDate): Promise<AddPlanDateOutcome> => {
      const date = nextSundayAtNine();
      const eventArgs = {
        groupId,
        eventDate: date.getTime(),
        times: [{ label: "9:00 AM", startsAt: date.getTime() }],
      };
      try {
        await createEvent(eventArgs);
        return "created";
      } catch (e) {
        const duplicate = parseDuplicatePlanDate(e);
        if (!duplicate) throw e;

        if (onDuplicate === "open") {
          onOpenPlan(duplicate.existingPlanId);
          return "opened-existing";
        }
        const choice = await promptDuplicatePlanDate(duplicate);
        if (choice === "open-existing") {
          onOpenPlan(duplicate.existingPlanId);
          return "opened-existing";
        }
        if (choice === "add-another") {
          await createEvent({ ...eventArgs, allowSameDay: true });
          return "created";
        }
        return "cancelled";
      }
    },
    [createEvent, groupId, onOpenPlan],
  );

  return { addPlanDate };
}
