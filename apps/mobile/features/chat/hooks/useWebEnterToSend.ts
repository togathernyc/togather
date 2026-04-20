import { RefObject, useEffect } from 'react';
import { Platform, TextInput } from 'react-native';

/**
 * On web, bind an Enter-to-send keyboard handler to a TextInput's DOM node.
 * - Enter (no modifiers)        → calls `onSend` (if `canSend`) and prevents the default newline
 * - Shift+Enter                 → default (inserts newline)
 * - Ctrl/Meta/Alt + Enter       → ignored (do not send)
 * - Enter during IME composition → ignored (do not break CJK input)
 * - Native (iOS/Android)        → no-op
 *
 * Pass `enabled=false` to temporarily detach the listener, e.g. when a voice recorder
 * replaces the text input and the ref is no longer mounted.
 */
export function useWebEnterToSend(
  ref: RefObject<TextInput | null>,
  canSend: boolean,
  onSend: () => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;
    const node = ref.current as unknown as HTMLTextAreaElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const handler = (e: KeyboardEvent) => {
      if (!shouldSendOnEnter(e)) return;
      e.preventDefault();
      if (canSend) onSend();
    };
    node.addEventListener('keydown', handler);
    return () => node.removeEventListener('keydown', handler);
  }, [ref, canSend, onSend, enabled]);
}

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'
>;

/**
 * Pure predicate: true when an Enter keypress should trigger send.
 * Exported for unit tests.
 */
export function shouldSendOnEnter(e: KeyEventLike): boolean {
  if (e.key !== 'Enter') return false;
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.isComposing) return false;
  return true;
}
