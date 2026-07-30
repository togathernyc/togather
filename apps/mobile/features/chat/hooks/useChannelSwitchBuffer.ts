/**
 * useChannelSwitchBuffer
 *
 * Removes the blank-surface flash when the chat room's channel tab strip
 * switches channels (General ↔ Helpers ↔ Announcements).
 *
 * The flash: `useMessages` restarts its Convex subscription with the new
 * `channelId`, so `useQuery` returns `undefined` for a beat and the hook
 * reports `messages: []` + `isLoading: true`. `MessageList` then takes its
 * "no data yet" branch, which returns a bare `<View>` — the FlatList
 * unmounts, the whole message area tears down to an empty surface, and the
 * new channel's list mounts fresh a moment later. On device that reads as a
 * hard blink between tabs.
 *
 * The fix follows the repo's dashboard principle — "re-filter in place,
 * never tear down into a spinner" — by holding something renderable across
 * the gap, in priority order:
 *
 *   1. **This channel's own last page**, if we've rendered it before in this
 *      chat-room session. Returning to a tab repaints its real content
 *      instantly, then the live subscription reconciles on top.
 *   2. **The previous channel's rendered list**, for a first visit to a tab
 *      we have nothing buffered for. The content swaps when the new
 *      channel's first page lands instead of blanking first. Flagged as
 *      `isSwitching` so the caller can treat it as read-only scenery (it
 *      belongs to a different channel than the composer targets).
 *
 * Scope, deliberately: the buffer is a `useRef` map owned by the mounting
 * component, so it lives and dies with the chat room. That keeps it
 * session-scoped memory with no cross-user lifetime — it is NOT offline
 * support and needs none of ADR-028's plumbing (no AsyncStorage store, no
 * `.web.ts` stub, no logout cleanup): per that ADR's rubric, caches exist so
 * users can *view* data where they predictably lack signal, whereas this
 * only spans the sub-second window between two live subscriptions.
 */

import { useEffect, useRef, useState } from 'react';
import type { Id } from '@services/api/convex';

/**
 * How many channels' last pages to keep. A chat room shows a handful of
 * tabs; this is a guard against unbounded growth, not a tuning knob.
 */
const MAX_BUFFERED_CHANNELS = 8;

/**
 * Longest we'll show a *different* channel's list. A switch normally
 * resolves in well under a second; if the socket is down the query never
 * resolves at all, and holding forever would strand the user staring at
 * (and unable to scroll) the channel they just left. Past this we fall back
 * to the plain loading/empty branches.
 */
const MAX_CROSS_CHANNEL_HOLD_MS = 2500;

interface ChannelSwitchBufferInput<T> {
  /** Gate. When false the hook is a pass-through (flag-off parity). */
  enabled: boolean;
  channelId: Id<'chatChannels'> | null;
  /** Messages the data layer currently reports for `channelId`. */
  messages: T[];
  /** True while `channelId`'s query has no result yet. */
  isLoading: boolean;
}

interface ChannelSwitchBufferResult<T> {
  /** What to render. */
  messages: T[];
  /** The channel `messages` actually belong to — may lag `channelId`. */
  channelId: Id<'chatChannels'> | null;
  /** True only while showing a *different* channel's list across the gap. */
  isSwitching: boolean;
}

export function useChannelSwitchBuffer<T>({
  enabled,
  channelId,
  messages,
  isLoading,
}: ChannelSwitchBufferInput<T>): ChannelSwitchBufferResult<T> {
  // Insertion-ordered map doubling as an LRU: re-inserting on write moves a
  // channel to the back, so `keys().next()` is always the coldest entry.
  const perChannelRef = useRef<Map<string, T[]>>(new Map());
  const lastRenderedRef = useRef<{
    channelId: Id<'chatChannels'> | null;
    messages: T[];
  }>({ channelId: null, messages: [] });

  // Channel whose cross-channel hold has timed out (see the constant).
  const [holdExpiredFor, setHoldExpiredFor] = useState<string | null>(null);

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (!enabled || !channelId) return;

    if (hasMessages) {
      const buffer = perChannelRef.current;
      buffer.delete(channelId);
      buffer.set(channelId, messages);
      while (buffer.size > MAX_BUFFERED_CHANNELS) {
        const coldest = buffer.keys().next();
        if (coldest.done) break;
        buffer.delete(coldest.value);
      }
      lastRenderedRef.current = { channelId, messages };
      return;
    }

    if (!isLoading) {
      // The live query confirmed this channel is empty (or the viewer lost
      // access). Drop the buffered page so a later revisit doesn't repaint
      // history that is no longer there — mirroring `useMessages`, which
      // clears its persisted cache on the same signal.
      perChannelRef.current.delete(channelId);
      lastRenderedRef.current = { channelId, messages: [] };
      return;
    }

    // Still loading with no live rows: if this channel repainted from its own
    // buffer, that IS what's on screen — track it, or a quick hop to a
    // first-time channel would hold whatever channel last supplied live data
    // (A→B(buffered)→C must scenery B, not flash back to A).
    const buffered = perChannelRef.current.get(channelId);
    if (buffered && buffered.length > 0) {
      lastRenderedRef.current = { channelId, messages: buffered };
    }
  }, [enabled, channelId, messages, hasMessages, isLoading]);

  // Pass-through: live data, a confirmed-empty channel, or flag-off.
  let resolved: ChannelSwitchBufferResult<T> = {
    messages,
    channelId,
    isSwitching: false,
  };

  if (enabled && !hasMessages && isLoading && channelId) {
    const buffered = perChannelRef.current.get(channelId);
    const previous = lastRenderedRef.current;

    if (buffered && buffered.length > 0) {
      // This channel's own content — fully interactive, not a switch.
      resolved = { messages: buffered, channelId, isSwitching: false };
    } else if (
      holdExpiredFor !== channelId &&
      previous.channelId &&
      previous.channelId !== channelId &&
      previous.messages.length > 0
    ) {
      resolved = {
        messages: previous.messages,
        channelId: previous.channelId,
        isSwitching: true,
      };
    }
  }

  // Bound how long a cross-channel hold can last. Only armed while actually
  // holding, and torn down the moment the real page arrives.
  useEffect(() => {
    if (!resolved.isSwitching || !channelId) return;
    const timer = setTimeout(
      () => setHoldExpiredFor(channelId),
      MAX_CROSS_CHANNEL_HOLD_MS
    );
    return () => clearTimeout(timer);
  }, [resolved.isSwitching, channelId]);

  // Re-arm once this channel finally has content, so a later switch back
  // isn't permanently disqualified by one bad network moment.
  useEffect(() => {
    if (hasMessages && holdExpiredFor === channelId) {
      setHoldExpiredFor(null);
    }
  }, [hasMessages, holdExpiredFor, channelId]);

  return resolved;
}
