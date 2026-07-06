import { useState, useCallback } from "react";
import { Alert } from "react-native";
import { useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

interface UseRespondToChannelInviteOptions {
  token: string | null;
  groupId: string;
}

/**
 * Optional invite metadata, used to show the announcements-specific accept
 * confirmation. Fields come straight off `listPendingInvitesForGroup` rows.
 */
export interface RespondInviteContext {
  channelType?: string;
  primaryGroupName?: string;
  /**
   * Name of the group whose shared Announcements channel this group is
   * currently an accepted secondary of, if any — accepting a new
   * announcements share automatically switches away from it.
   */
  switchFromGroupName?: string | null;
}

/** ConvexError carries its payload on `.data`; production `.message` is a
 *  generic "Server Error" string, so prefer `.data.message` when present. */
function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: string } } | null)?.data;
  if (typeof data?.message === "string") return data.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Hook to handle responding to shared channel invitations.
 * Encapsulates the mutation, loading state, and confirmation flow.
 */
export function useRespondToChannelInvite({
  token,
  groupId,
}: UseRespondToChannelInviteOptions) {
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  const respondMutation = useMutation(
    api.functions.messaging.sharedChannels.respondToChannelInvite
  );

  const handleRespond = useCallback(
    async (
      channelId: Id<"chatChannels">,
      response: "accepted" | "declined",
      invite?: RespondInviteContext
    ) => {
      if (!token || !groupId) return;

      if (response === "declined") {
        Alert.alert(
          "Decline Invitation",
          "Are you sure you want to decline this shared channel invitation?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Decline",
              style: "destructive",
              onPress: async () => {
                setRespondingTo(`${channelId}-decline`);
                try {
                  await respondMutation({
                    token,
                    channelId,
                    groupId: groupId as Id<"groups">,
                    response: "declined",
                  });
                } catch (error) {
                  Alert.alert("Error", errorMessage(error, "Failed to decline."));
                } finally {
                  setRespondingTo(null);
                }
              },
            },
          ]
        );
        return;
      }

      const performAccept = async () => {
        setRespondingTo(`${channelId}-accept`);
        try {
          await respondMutation({
            token,
            channelId,
            groupId: groupId as Id<"groups">,
            response: "accepted",
          });
        } catch (error) {
          Alert.alert("Error", errorMessage(error, "Failed to accept."));
        } finally {
          setRespondingTo(null);
        }
      };

      // Accepting an announcements share has group-wide side effects (member
      // backfill + own Announcements channel turned off), so confirm first.
      if (invite?.channelType === "announcements") {
        const ownerName = invite.primaryGroupName ?? "the owning group";
        Alert.alert(
          "Accept Announcements share?",
          `Accepting will add all members of this group to ${ownerName}'s Announcements and turn off this group's own Announcements channel. Leaders of both groups can post.` +
            (invite.switchFromGroupName
              ? ` This group will stop receiving announcements from ${invite.switchFromGroupName}.`
              : ""),
          [
            { text: "Cancel", style: "cancel" },
            { text: "Accept", onPress: () => void performAccept() },
          ]
        );
        return;
      }

      await performAccept();
    },
    [token, groupId, respondMutation]
  );

  return {
    respondingTo,
    handleRespond,
  };
}
