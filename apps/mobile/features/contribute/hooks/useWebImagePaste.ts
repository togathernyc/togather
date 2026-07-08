/**
 * Web-only: attach a copied screenshot (Cmd/Ctrl+V) to a composer's image
 * attachments, mirroring the chat composer
 * (features/chat/components/MessageInput.tsx). react-native-web's <TextInput>
 * does NOT forward an `onPaste` JSX prop to the underlying <textarea> (it's not
 * on RN-Web's allowlist), so passing `onPaste` is silently dropped — we attach
 * a real DOM `paste` listener to the host node instead.
 *
 * Only image files are intercepted (with `preventDefault`); plain-text pastes
 * carry no image files and fall through to the browser's default behavior
 * untouched, so ordinary copy/paste keeps working.
 */
import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { getPastedImageFiles } from "@features/chat/utils/imageUpload";

/**
 * Decide what a paste event means for the composer. When the clipboard carries
 * image files we take over (`preventDefault`) and hand their object URLs to
 * `onImageUris`; otherwise we leave the event alone so a plain-text paste
 * behaves normally. Extracted as a pure function so the decision is unit
 * testable without a DOM.
 */
export function handleClipboardPaste(
  event: Pick<ClipboardEvent, "clipboardData" | "preventDefault">,
  onImageUris: (uris: string[]) => void,
): void {
  const files = getPastedImageFiles(event.clipboardData);
  if (files.length === 0) return; // let plain-text paste through
  event.preventDefault();
  onImageUris(files.map((file) => URL.createObjectURL(file)));
}

/**
 * Wire the `paste` listener onto a resolved DOM node and return a detach
 * function. Pure (no Platform/ref bookkeeping) so it's unit testable with a
 * fake node.
 */
export function attachImagePasteListener(
  node: HTMLElement,
  onImageUris: (uris: string[]) => void,
): () => void {
  const listener = (event: Event) =>
    handleClipboardPaste(event as ClipboardEvent, onImageUris);
  node.addEventListener("paste", listener);
  return () => node.removeEventListener("paste", listener);
}

/**
 * Returns a callback ref to place on the composer's <TextInput> (`ref={...}`).
 *
 * A callback ref — rather than a `useRef` + `useEffect` — because React invokes
 * it with the host node on mount and with `null` on unmount, so the listener
 * attaches and detaches exactly when the <textarea> appears or disappears. That
 * matters here: a /dev conversation can be archived and later restored, which
 * hides then remounts the composer *without* remounting the screen. An effect
 * keyed on a stable ref object would never re-run and would leave the fresh
 * <textarea> without a paste listener (or leave the listener bound to a stale,
 * detached node). The callback ref has no such blind spot.
 */
export function useWebImagePaste(
  onImageUris: (uris: string[]) => void,
): (node: unknown) => void {
  // Track the latest callback without changing the ref's identity (which would
  // otherwise detach/reattach the listener on every render).
  const onImageUrisRef = useRef(onImageUris);
  onImageUrisRef.current = onImageUris;

  const detachRef = useRef<(() => void) | null>(null);

  return useCallback((node: unknown) => {
    // Detach from any previous node first (unmount, or remount to a new node).
    if (detachRef.current) {
      detachRef.current();
      detachRef.current = null;
    }
    if (Platform.OS !== "web" || node == null) return;
    const el = node as unknown as HTMLElement;
    if (typeof el.addEventListener !== "function") return;

    detachRef.current = attachImagePasteListener(el, (uris) =>
      onImageUrisRef.current(uris),
    );
  }, []);
}
