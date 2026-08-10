/**
 * Thread-aware chat timeline derivation.
 *
 * The chat now orders top-level messages by `createdAt` (see the `getMessages`
 * backend query), so replying to a message no longer floats the real message to
 * the bottom. To keep recent thread activity visible without moving the real
 * message, we float a "ghost" pointer — an echo of the original message — at
 * the thread's latest activity slot (`lastActivityAt`).
 *
 * This module holds the *pure* derivation so it can be unit-tested independently
 * of React / FlatList: given the server messages (already ordered by
 * `createdAt`), it returns an ordered timeline of "message" and "ghost" entries.
 * The component layer adds date separators, sender grouping, optimistic
 * messages, and inverts the list for rendering.
 */

/** Minimal message shape the derivation needs. */
export interface ThreadTimelineMessage {
  createdAt: number;
  isDeleted: boolean;
  threadReplyCount?: number;
  lastActivityAt?: number;
}

export type ThreadTimelineEntry<M> =
  | { kind: 'message'; message: M }
  | { kind: 'ghost'; message: M };

/**
 * A message floats a ghost pointer when it has at least one reply AND its
 * `lastActivityAt` is later than its own `createdAt` (i.e. it was actually
 * bumped by a reply). Deleted originals never float a ghost — the thread
 * pointer would dangle with no message to scroll back to.
 */
export function shouldFloatGhost(msg: ThreadTimelineMessage): boolean {
  return (
    !msg.isDeleted &&
    (msg.threadReplyCount ?? 0) > 0 &&
    msg.lastActivityAt !== undefined &&
    msg.lastActivityAt > msg.createdAt
  );
}

/**
 * Build the ordered timeline of message + ghost entries.
 *
 * - Every message stays at its `createdAt` position (input order is preserved
 *   for messages since the server already sorts by `createdAt`).
 * - Each eligible message additionally emits ONE ghost entry positioned at its
 *   `lastActivityAt` (deduplicated — replying multiple times never stacks
 *   ghosts, because the count/bump live on the single parent message).
 * - At an equal timestamp a real message sorts before a ghost; ties beyond that
 *   preserve input order for stability.
 */
export function buildThreadAwareTimeline<M extends ThreadTimelineMessage>(
  messages: M[],
): Array<ThreadTimelineEntry<M>> {
  const events: Array<{ ts: number; order: number; entry: ThreadTimelineEntry<M> }> = [];

  messages.forEach((message, order) => {
    events.push({ ts: message.createdAt, order, entry: { kind: 'message', message } });
    if (shouldFloatGhost(message)) {
      events.push({ ts: message.lastActivityAt!, order, entry: { kind: 'ghost', message } });
    }
  });

  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.entry.kind !== b.entry.kind) return a.entry.kind === 'message' ? -1 : 1;
    return a.order - b.order;
  });

  return events.map((e) => e.entry);
}
