/**
 * Shared notification deep-link resolution.
 *
 * Both push-notification taps (handled in NotificationProvider) and in-app
 * taps on the Notifications feed need to resolve a notification's `data`
 * payload to a screen. This helper centralizes that mapping so the two
 * surfaces stay in lockstep — a notification opens the same place whether the
 * user tapped it from the OS shade or from the in-app feed.
 *
 * It deliberately does NOT handle community-switching or chat prefetch — those
 * are push-only concerns that stay in NotificationProvider. The in-app feed is
 * always already inside the right community context.
 */
import { router } from "expo-router";
import type { Id } from "@services/api/convex";

/**
 * Side-effecting dependencies the resolver needs. NotificationProvider passes
 * its prefetch hook; the in-app feed passes a no-op (it has no channel cache
 * to warm and the chat screen will load its own data).
 */
export type NotificationNavDeps = {
  /** Warm a chat channel's message cache before navigating. */
  awaitPrefetch?: (channelId: Id<"chatChannels">, timeoutMs: number) => Promise<unknown>;
  /** Channel the user is currently viewing — skip nav if it matches. */
  activeChannelId?: string | null;
};

/**
 * Resolve a notification `data` payload to a navigation action and perform it.
 *
 * Mirrors the `type` switch that historically lived inline in
 * NotificationProvider.handleNotificationTap. iOS push payloads sometimes nest
 * fields under `data.data`, so every field is read from both levels.
 */
export async function resolveNotificationNavigation(
  data: Record<string, unknown>,
  deps: NotificationNavDeps = {},
): Promise<void> {
  const nestedData = data.data as Record<string, unknown> | undefined;
  const pick = (key: string) =>
    (data[key] ?? nestedData?.[key]) as unknown;

  const type = pick("type") as string | undefined;
  // Backend often sends a pre-computed deep link — prefer it when present.
  const url = pick("url") as string | undefined;
  const groupId = pick("groupId") as string | undefined;
  const channelId = pick("channelId") as string | undefined;
  const channelType = pick("channelType") as string | undefined;
  const channelSlug = pick("channelSlug") as string | undefined;

  // A pre-computed URL always wins.
  if (url) {
    router.push(url as never);
    return;
  }

  const navigateToGroup = (gId: string) => {
    router.push(`/groups/${gId}` as never);
  };

  switch (type) {
    case "join_request_received":
      router.push("/(tabs)/admin" as never);
      break;
    case "join_request_approved":
    case "group_creation_approved":
    case "role_changed":
      if (groupId) navigateToGroup(groupId);
      break;
    case "new_message":
    case "mention": {
      // If already viewing this channel, skip navigation to avoid a re-mount flash.
      if (channelId && deps.activeChannelId === channelId) break;

      const resolvedSlug =
        channelSlug ||
        (channelType === "main"
          ? "general"
          : channelType === "leaders"
            ? "leaders"
            : channelType);
      const groupName = pick("groupName") as string | undefined;

      if (channelId && groupId) {
        await deps.awaitPrefetch?.(channelId as Id<"chatChannels">, 3000);
        if (!resolvedSlug) {
          router.push({
            pathname: `/inbox/${channelId}`,
            params: { groupId, ...(groupName ? { groupName } : {}) },
          } as never);
          break;
        }
        router.push({
          pathname: `/inbox/${groupId}/${resolvedSlug}`,
          params: { channelId, ...(groupName ? { groupName } : {}) },
        } as never);
      } else if (groupId) {
        router.push({
          pathname: `/inbox/${groupId}/${resolvedSlug || "general"}`,
        } as never);
      } else if (channelId) {
        router.push({ pathname: `/inbox/${channelId}` } as never);
      } else {
        router.push("/(tabs)/chat" as never);
      }
      break;
    }
    case "event_rsvp_received":
    case "event_blast":
    case "event_invite":
    case "event_updated":
    case "meeting_reminder": {
      const shortId = pick("shortId") as string | undefined;
      if (shortId) router.push(`/e/${shortId}?source=app` as never);
      break;
    }
    case "attendance_confirmation": {
      const shortId = pick("shortId") as string | undefined;
      const route = pick("route") as string | undefined;
      if (route) {
        router.push(route as never);
      } else if (shortId) {
        router.push(`/e/${shortId}?confirmAttendance=true&source=app` as never);
      }
      break;
    }
    case "followup_assigned": {
      const groupMemberId = pick("groupMemberId") as string | undefined;
      if (groupId && groupMemberId) {
        router.push(`/followup/${groupId}/${groupMemberId}` as never);
      }
      break;
    }
    case "admin_broadcast": {
      const deepLinkUrl = pick("url") as string | undefined;
      router.push((deepLinkUrl ?? "/(tabs)/admin") as never);
      break;
    }
    default:
      // Unknown / no-op type: leave the user on the feed.
      break;
  }
}
