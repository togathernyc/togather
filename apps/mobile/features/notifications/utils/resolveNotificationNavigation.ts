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
import { DOMAIN_CONFIG } from "@togather/shared";
import type { Id } from "@services/api/convex";

/**
 * Normalize a pre-computed notification link into something expo-router can
 * navigate to in-app. Some backend notifications stored an absolute app URL
 * (e.g. `https://togather.nyc/scheduling/assignment/x`); expo-router treats an
 * absolute `https://…` URL as an external link and hands it to the browser
 * instead of routing within the app. Strip our own origin down to a relative
 * path so the tap opens the app. Non-app (genuinely external) URLs pass
 * through untouched.
 */
function toInAppLink(url: string): string {
  const origin = DOMAIN_CONFIG.appUrl;
  return url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
}

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
    router.push(toInAppLink(url) as never);
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
    case "shared_channel_invite":
      // Open the channel info screen for the invited group so the leader can
      // inspect, accept, or decline the shared channel. `groupId` here is the
      // invited (secondary) group. channelId disambiguates same-slug invites
      // (slugs aren't unique across owning groups). Fall back to the group page
      // for older notifications that predate the channelSlug payload.
      if (groupId && channelSlug) {
        router.push(
          (channelId
            ? `/inbox/${groupId}/${channelSlug}/info?channelId=${channelId}`
            : `/inbox/${groupId}/${channelSlug}/info`) as never,
        );
      } else if (groupId) {
        navigateToGroup(groupId);
      }
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
      router.push("/people" as never);
      break;
    }
    case "dev_contribution_update": {
      // Contributor dev dashboard (ADR-029): open the conversation thread.
      const bugId = pick("bugId") as string | undefined;
      if (bugId) router.push(`/(user)/dev/${bugId}` as never);
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
