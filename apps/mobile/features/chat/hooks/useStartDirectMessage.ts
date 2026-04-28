/**
 * useStartDirectMessage
 *
 * Wraps `createOrGetDirectChannel` for entry points outside the dedicated
 * "/inbox/new" picker (e.g. the Message button on someone else's profile).
 * Centralizes the navigation + error-classification logic so individual call
 * sites don't each re-implement the PROFILE_PHOTO_REQUIRED /
 * RECIPIENT_PROFILE_PHOTO_REQUIRED / NO_SHARED_COMMUNITY handling.
 *
 * The caller is expected to have already gated rendering on a community
 * context — `messageUser` requires a `communityId` and short-circuits with
 * "no_context" when one isn't provided.
 */
import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { ToastManager } from "@components/ui/Toast";
import { classifyProfilePhotoError } from "@features/chat/components/RequireProfilePhotoSheet";

export type StartDmOutcome =
  | { kind: "success"; channelId: Id<"chatChannels"> }
  | { kind: "needs_self_photo" }
  | { kind: "needs_recipient_photo" }
  | { kind: "no_shared_community" }
  | { kind: "no_context" }
  | { kind: "error"; message: string };

interface MessageUserInput {
  otherUserId: Id<"users">;
  /** First name of the other user — used in recipient-photo toast copy. */
  firstName?: string | null;
  /** Display name of the other user — used to seed the chat header on navigate. */
  displayName?: string | null;
  /** Profile photo of the other user — used to seed the chat header on navigate. */
  profilePhoto?: string | null;
}

export function useStartDirectMessage() {
  const router = useRouter();
  const { token, community } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;

  const createOrGetDirectChannel = useMutation(
    api.functions.messaging.directMessages.createOrGetDirectChannel,
  );

  const [isStarting, setIsStarting] = useState(false);

  const messageUser = useCallback(
    async ({
      otherUserId,
      firstName,
      displayName,
      profilePhoto,
    }: MessageUserInput): Promise<StartDmOutcome> => {
      if (!token || !communityId) {
        return { kind: "no_context" };
      }
      setIsStarting(true);
      try {
        const { channelId } = await createOrGetDirectChannel({
          token,
          communityId,
          recipientUserId: otherUserId,
        });
        // The Message button typically lives inside a modal-presented
        // profile screen (the (user) route group is `presentation: "modal"`
        // in `app/_layout.tsx`). Pushing without dismissing first lands the
        // chat *behind* the modal on iOS — broken navigation. Dismiss the
        // modal stack first, then push to the chat.
        if (router.canDismiss?.()) {
          router.dismissAll();
        }
        router.push({
          pathname: `/inbox/dm/${channelId}` as any,
          params: {
            groupName: displayName ?? "",
            imageUrl: profilePhoto ?? "",
          },
        });
        return { kind: "success", channelId };
      } catch (e) {
        const photoError = classifyProfilePhotoError(e);
        if (photoError === "self") {
          return { kind: "needs_self_photo" };
        }
        if (photoError === "recipient") {
          const name = (firstName ?? "").trim();
          ToastManager.error(
            name.length > 0
              ? `${name} hasn't added a profile photo yet.`
              : "They haven't added a profile photo yet.",
          );
          return { kind: "needs_recipient_photo" };
        }
        const message = e instanceof Error ? e.message : String(e ?? "");
        if (message.includes("NO_SHARED_COMMUNITY")) {
          ToastManager.error(
            "You can only message people in your community.",
          );
          return { kind: "no_shared_community" };
        }
        ToastManager.error("Couldn't start chat. Try again.");
        return { kind: "error", message };
      } finally {
        setIsStarting(false);
      }
    },
    [token, communityId, createOrGetDirectChannel, router],
  );

  return {
    messageUser,
    isStarting,
    /** True when the hook has the context needed to attempt a DM. */
    canMessage: Boolean(token && communityId),
  };
}
