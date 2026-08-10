/**
 * Reply-preview helpers for the "Replying to …" composer banner.
 *
 * The banner used to go blank when you replied to a message you'd *just sent*:
 * a just-sent message is still optimistic, and its id is a synthetic
 * `optimistic-…` string the server query can't resolve — so the fetched parent
 * came back empty (no name, no snippet). These helpers keep the banner filled
 * from the locally-known values while (for real messages) still letting the
 * fetched copy override once it resolves.
 */

/** True for the synthetic ids `useSendMessage` assigns to not-yet-confirmed sends. */
export function isOptimisticMessageId(
  id: string | null | undefined,
): boolean {
  return typeof id === "string" && id.startsWith("optimistic-");
}

interface ReplyPreviewSource {
  content?: string;
  senderName?: string;
}

/**
 * Build the banner's name + snippet. Prefer the fetched parent (authoritative,
 * reflects edits) but fall back to the locally-captured values so the banner is
 * never blank — e.g. when replying to a still-optimistic message the server
 * can't resolve. Empty string, never undefined, so the banner renders cleanly.
 */
export function resolveReplyPreview(
  fetched: ReplyPreviewSource | null | undefined,
  local: ReplyPreviewSource | null | undefined,
): { content: string; senderName: string } {
  return {
    content: fetched?.content ?? local?.content ?? "",
    senderName: fetched?.senderName ?? local?.senderName ?? "",
  };
}
