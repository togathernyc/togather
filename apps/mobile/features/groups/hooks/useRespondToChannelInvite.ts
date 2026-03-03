import { useState, useCallback } from "react";
import { Alert } from "react-native";
import { useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

interface UseRespondToChannelInviteOptions {
  token: string | null;
  groupId: string;
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
      response: "accepted" | "declined"
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
                  const message =
                    error instanceof Error
                      ? error.message
                      : "Failed to decline.";
                  Alert.alert("Error", message);
                } finally {
                  setRespondingTo(null);
                }
              },
            },
          ]
        );
        return;
      }

      setRespondingTo(`${channelId}-accept`);
      try {
        await respondMutation({
          token,
          channelId,
          groupId: groupId as Id<"groups">,
          response: "accepted",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to accept.";
        Alert.alert("Error", message);
      } finally {
        setRespondingTo(null);
      }
    },
    [token, groupId, respondMutation]
  );

  return {
    respondingTo,
    handleRespond,
  };
}
