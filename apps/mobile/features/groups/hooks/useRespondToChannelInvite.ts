import { useState, useCallback } from "react";
import { Alert } from "react-native";
import { useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { errorMessage } from "@/utils/error-handling";

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

/**
 * Confirmation dialog for accepting an announcements share. Accepting has
 * group-wide side effects (member backfill + the group's own Announcements
 * channel turned off), so it always gets an explicit confirmation. When
 * `switchFromGroupName` is set the copy also warns about the automatic
 * switch away from the current share. Shared by this hook and
 * ChannelInfoScreen so the copy can't drift between the two entry points.
 */
export function confirmAnnouncementsShareAccept({
  ownerName,
  switchFromGroupName,
  onConfirm,
}: {
  ownerName: string;
  switchFromGroupName?: string | null;
  onConfirm: () => void;
}): void {
  Alert.alert(
    "Accept Announcements share?",
    `Accepting will add all members of this group to ${ownerName}'s Announcements and turn off this group's own Announcements channel. Leaders of both groups can post.` +
      (switchFromGroupName
        ? ` This group will stop receiving announcements from ${switchFromGroupName}.`
        : ""),
    [
      { text: "Cancel", style: "cancel" },
      { text: "Accept", onPress: onConfirm },
    ]
  );
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
        confirmAnnouncementsShareAccept({
          ownerName: invite.primaryGroupName ?? "the owning group",
          switchFromGroupName: invite.switchFromGroupName,
          onConfirm: () => void performAccept(),
        });
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
