/**
 * Centralised classifier for chat-send rejections from the Convex backend.
 *
 * Convex throws errors as `ConvexError(message)` strings (see
 * `apps/convex/functions/messaging/messages.ts`). The frontend detects them
 * by substring match against `error.message`. This file is the only place
 * that knows those magic strings — every consumer should call
 * `classifyChatSendError` instead of grepping the message itself, so that
 * future changes to the backend wording (or a switch to structured codes)
 * have one update site.
 *
 * Soft-fail vs hard-fail:
 * - "soft": expected, user-recoverable. The optimistic message must be
 *   dismissed and a non-modal hint shown — DO NOT pop an Alert and DO NOT
 *   leave the message in `_status: "error"`. Leaving it there is what
 *   previously kept enough state churning to trigger
 *   "Maximum update depth exceeded" inside the navigator (Sentry crash on
 *   2026-04-29: GIF send to fresh DM → server rejection → composer kept
 *   the GIF + optimistic-error message + user reopened picker → loop).
 * - "hard": unexpected. Surface generically; let the optimistic message
 *   stay in `error` so the user can retry.
 */

export type ChatSendErrorKind =
  | "attachments_pending"
  | "text_too_long_pending"
  | "request_pending"
  | "profile_photo_self"
  | "profile_photo_recipient"
  | "blocked"
  | "unknown";

export interface ChatSendErrorClassification {
  kind: ChatSendErrorKind;
  /**
   * True when the error represents an expected user-facing condition that
   * should auto-dismiss the optimistic message and show an inline hint
   * rather than an Alert / persistent error row. See file header for why.
   */
  soft: boolean;
  /** Short user-facing message safe to render inline. */
  userMessage: string;
}

const KNOWN: Array<{
  match: (msg: string) => boolean;
  kind: ChatSendErrorKind;
  soft: boolean;
  userMessage: string;
}> = [
  {
    // messages.ts: `Cannot send attachments until the recipient accepts the request`
    match: (m) => m.includes("Cannot send attachments"),
    kind: "attachments_pending",
    soft: true,
    userMessage:
      "They'll need to accept your chat request before you can send photos or GIFs.",
  },
  {
    // messages.ts: `Messages must be N characters or fewer until the recipient accepts`
    match: (m) =>
      m.includes("characters or fewer until the recipient accepts"),
    kind: "text_too_long_pending",
    soft: true,
    userMessage:
      "Keep it under 1000 characters until they accept your chat request.",
  },
  {
    // messages.ts: `Accept the request before replying`
    match: (m) => m.includes("Accept the request before replying"),
    kind: "request_pending",
    soft: true,
    userMessage: "Accept the chat request before replying.",
  },
  {
    // messages.ts: `PROFILE_PHOTO_REQUIRED`
    match: (m) => m.includes("RECIPIENT_PROFILE_PHOTO_REQUIRED"),
    kind: "profile_photo_recipient",
    soft: true,
    userMessage:
      "The other person needs a profile photo before you can chat with them.",
  },
  {
    match: (m) => m.includes("PROFILE_PHOTO_REQUIRED"),
    kind: "profile_photo_self",
    soft: true,
    userMessage: "Add a profile photo before sending a message.",
  },
  {
    // messages.ts: `Cannot send message in this chat` (block enforcement)
    match: (m) => m.includes("Cannot send message in this chat"),
    kind: "blocked",
    soft: true,
    userMessage: "You can't send messages in this chat.",
  },
];

export function classifyChatSendError(
  error: unknown,
): ChatSendErrorClassification {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  for (const row of KNOWN) {
    if (row.match(message)) {
      return {
        kind: row.kind,
        soft: row.soft,
        userMessage: row.userMessage,
      };
    }
  }
  return {
    kind: "unknown",
    soft: false,
    userMessage: "Failed to send. Please try again.",
  };
}
