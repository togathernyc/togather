/**
 * useRespondToAssignment
 *
 * Shared accept/decline logic for the volunteer screens. Wraps
 * `scheduling.assignments.respondToAssignment`, tracks the in-flight
 * assignment id, and surfaces failures via an Alert.
 */
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

export function useRespondToAssignment() {
  const respondMutation = useAuthenticatedMutation(
    api.functions.scheduling.assignments.respondToAssignment,
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Accept or decline an assignment. Returns true on success. */
  const respond = useCallback(
    async (
      assignmentId: Id<"roleAssignments">,
      status: "confirmed" | "declined",
      declineNote?: string,
    ): Promise<boolean> => {
      setBusyId(assignmentId as string);
      try {
        await respondMutation({ assignmentId, status, declineNote });
        return true;
      } catch (e: any) {
        Alert.alert(
          "Couldn't respond",
          e?.message ?? "Please try again.",
        );
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [respondMutation],
  );

  /** Decline with an optional one-line note. */
  const declineWith = useCallback(
    (assignmentId: Id<"roleAssignments">, note?: string) =>
      respond(assignmentId, "declined", note?.trim() || undefined),
    [respond],
  );

  return { respond, declineWith, busyId };
}
