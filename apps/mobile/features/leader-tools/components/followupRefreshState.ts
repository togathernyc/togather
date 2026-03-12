export type FollowupRefreshStateSnapshot =
  | {
      status?: "running" | "idle" | "failed";
      startedAt?: number;
      completedAt?: number;
      failedAt?: number;
      error?: string;
    }
  | null
  | undefined;

export function formatFollowupRefreshTimestamp(timestamp?: number | null): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getFollowupRefreshButtonLabel(
  isRefreshRequestPending: boolean,
  isRefreshRunning: boolean
): string {
  if (isRefreshRequestPending) return "Starting Refresh...";
  if (isRefreshRunning) return "Refresh In Progress...";
  return "Refresh People Table Now";
}
