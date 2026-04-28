/**
 * useAdHocChannelManagement
 *
 * Thin wrapper around the ad-hoc DM management mutations Agent A is
 * landing in `apps/convex/functions/messaging/directMessages.ts`:
 *
 *   - renameAdHocChannel({ token, channelId, name })
 *   - addAdHocMembers({ token, channelId, userIds })
 *   - removeAdHocMember({ token, channelId, userId })
 *   - leaveAdHocChannel({ token, channelId })
 *
 * Returns auto-bound async functions; the caller supplies arguments and
 * the hook injects the auth token. Each function rejects when the token
 * is missing — the chat-info UI gates user-facing actions on
 * `currentUserId` upstream so this should not happen in practice.
 *
 * NOTE: Until Agent A's mutations land, the `api.functions.messaging.
 * directMessages.<name>` accessors are typed as `any` via a runtime
 * indexing pattern. TypeScript will start type-checking these calls
 * once the mutation specs appear in `_generated/api.d.ts`.
 */
import { useCallback } from "react";
import {
  useMutation,
  api,
  useStoredAuthToken,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";

// Indexed access avoids hard-coded "may not exist on type" errors while the
// backend mutations are being landed in parallel.
const directMessages = (
  api.functions.messaging.directMessages as unknown as Record<string, any>
);

export function useAdHocChannelManagement(channelId: Id<"chatChannels"> | null) {
  const token = useStoredAuthToken();

  const renameMutation = useMutation(directMessages.renameAdHocChannel);
  const addMembersMutation = useMutation(directMessages.addAdHocMembers);
  const removeMemberMutation = useMutation(directMessages.removeAdHocMember);
  const leaveMutation = useMutation(directMessages.leaveAdHocChannel);

  const requireReady = useCallback(() => {
    if (!token) throw new Error("Not authenticated");
    if (!channelId) throw new Error("Channel not loaded");
  }, [token, channelId]);

  const rename = useCallback(
    async (name: string) => {
      requireReady();
      return renameMutation({ token, channelId, name });
    },
    [renameMutation, token, channelId, requireReady],
  );

  const addMembers = useCallback(
    async (userIds: Id<"users">[]) => {
      requireReady();
      return addMembersMutation({ token, channelId, userIds });
    },
    [addMembersMutation, token, channelId, requireReady],
  );

  const removeMember = useCallback(
    async (userId: Id<"users">) => {
      requireReady();
      return removeMemberMutation({ token, channelId, userId });
    },
    [removeMemberMutation, token, channelId, requireReady],
  );

  const leave = useCallback(async () => {
    requireReady();
    return leaveMutation({ token, channelId });
  }, [leaveMutation, token, channelId, requireReady]);

  return { rename, addMembers, removeMember, leave };
}
