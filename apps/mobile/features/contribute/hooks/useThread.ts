/**
 * useThread — the live conversation thread for one contribution, ascending
 * by createdAt. New assistant/system messages stream in reactively.
 */
import { useAuthenticatedQuery } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { contributionsApi } from "./contributionsApi";
import type { ThreadMessage } from "../types";

export function useThread(id: Id<"devBugs"> | null): {
  messages: ThreadMessage[] | undefined;
  isLoading: boolean;
} {
  const messages = useAuthenticatedQuery(contributionsApi.getThread, id ? { id } : "skip");
  return { messages, isLoading: messages === undefined };
}
