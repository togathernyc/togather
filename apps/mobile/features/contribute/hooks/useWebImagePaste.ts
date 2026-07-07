/**
 * Web-only: attach a copied screenshot (Cmd/Ctrl+V) to a composer's image
 * attachments, mirroring the chat composer
 * (features/chat/components/MessageInput.tsx). react-native-web's <TextInput>
 * does NOT forward an `onPaste` JSX prop to the underlying <textarea> (it's not
 * on RN-Web's allowlist), so passing `onPaste` is silently dropped — we attach
 * a real DOM `paste` listener to the host node instead. The RN-Web ref resolves
 * to the actual <textarea> element on web.
 *
 * Only image files are intercepted (with `preventDefault`); plain-text pastes
 * carry no image files and fall through to the browser's default behavior
 * untouched, so ordinary copy/paste keeps working.
 */
import { useEffect, type RefObject } from "react";
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

export function useWebImagePaste(
  ref: RefObject<unknown>,
  onImageUris: (uris: string[]) => void,
): void {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;

    const listener = (event: Event) =>
      handleClipboardPaste(event as ClipboardEvent, onImageUris);

    node.addEventListener("paste", listener);
    return () => node.removeEventListener("paste", listener);
  }, [ref, onImageUris]);
}
