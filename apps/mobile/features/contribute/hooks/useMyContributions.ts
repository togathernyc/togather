/**
 * useMyContributions — the current user's contributions, newest first.
 * Includes items that originated from the chat dev-assistant.
 */
import { useAuthenticatedQuery } from "@services/api/convex";
import { contributionsApi } from "./contributionsApi";
import type { Contribution } from "../types";

export function useMyContributions(): {
  contributions: Contribution[] | undefined;
  isLoading: boolean;
} {
  const contributions = useAuthenticatedQuery(contributionsApi.myContributions, {});
  return { contributions, isLoading: contributions === undefined };
}
