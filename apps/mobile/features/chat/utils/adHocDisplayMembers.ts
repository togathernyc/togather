/**
 * Display members for an ad-hoc channel (1:1 DM / group chat).
 *
 * A 1:1 DM whose counterpart is gone — most often because the 30-day
 * `expireOldChatRequests` cron silently marked their never-answered request
 * `declined` + `leftAt` — has no active other member, so the inbox row, chat
 * header and chat-info title all degraded to a nameless "Conversation" with a
 * blank avatar (issue #426). The backend still knows who they are and returns
 * them as `formerMember`; this folds that into the list the UI *renders*.
 *
 * Display only: `formerMember` is deliberately not part of `otherMembers`, so
 * membership lists, counts and message fan-out keep excluding people who left.
 * Use this for names and avatars — never to decide who is in a channel.
 */

import type { Id } from "@services/api/convex";

type ActiveMember = {
  userId: Id<"users">;
  displayName: string;
  profilePhoto: string | null;
  notificationsDisabled: boolean;
};

type FormerMember = {
  userId: Id<"users">;
  displayName: string;
  profilePhoto: string | null;
};

export function adHocDisplayMembers(
  otherMembers: readonly ActiveMember[],
  formerMember: FormerMember | null | undefined,
): readonly ActiveMember[] {
  if (otherMembers.length > 0) return otherMembers;
  if (!formerMember) return [];
  return [
    {
      ...formerMember,
      // Someone who left this chat is not a notification target, so the
      // "notifications off" avatar badge would be misleading noise.
      notificationsDisabled: false,
    },
  ];
}
