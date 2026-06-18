/**
 * Dismiss every delivered OS push notification belonging to a chat channel.
 *
 * `expo-notifications` only auto-clears the single notification a user taps.
 * When several pushes from the SAME channel are stacked in the OS tray, the
 * siblings linger after the user has read the channel. Every chat push already
 * carries its channel id at `content.data.channelId` (set backend-side in
 * `apps/convex/functions/messaging/events.ts`); this helper uses that id to
 * sweep the tray and remove the stragglers when the channel is opened.
 *
 * iOS push payloads sometimes nest fields under `data.data`, so the channel id
 * is read from both levels — mirroring `resolveNotificationNavigation.ts`.
 *
 * This is a best-effort, fire-and-forget cleanup: it must NEVER throw into a
 * screen render, so the whole body is guarded.
 */
import * as Notifications from "expo-notifications";

/** Read a channel id from a notification's data payload (top-level or nested). */
function extractChannelId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const nested = record.data as Record<string, unknown> | undefined;
  const channelId = record.channelId ?? nested?.channelId;
  return typeof channelId === "string" ? channelId : undefined;
}

/**
 * Remove all delivered notifications for `channelId` from the OS tray.
 *
 * @param channelId The `Id<"chatChannels">` of the opened channel.
 */
export async function dismissChannelNotifications(channelId: string): Promise<void> {
  if (!channelId) return;

  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter(
          (notification) =>
            extractChannelId(notification.request.content.data) === channelId,
        )
        .map((notification) =>
          Notifications.dismissNotificationAsync(notification.request.identifier).catch(
            () => {},
          ),
        ),
    );
  } catch {
    // Tray cleanup is best-effort — never surface an error into the UI.
  }
}
