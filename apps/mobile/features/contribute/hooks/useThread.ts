/**
 * useThread — the live conversation thread for one contribution, ascending
 * by createdAt. New assistant/system messages stream in reactively.
 * Pass null to skip (no id yet, or dev-dashboard access not confirmed).
 */
import { api, useAuthenticatedQuery } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { ThreadMessage } from "../types";

export function useThread(id: Id<"devBugs"> | null): {
  messages: ThreadMessage[] | undefined;
  isLoading: boolean;
} {
  const messages: ThreadMessage[] | undefined = useAuthenticatedQuery(
    api.functions.devAssistant.contributions.getThread,
    id ? { id } : "skip",
  );
  return { messages, isLoading: messages === undefined };
}
