/**
 * Pick + upload pictures for the contribute composer (ADR-029 chat-first
 * filing). Wraps expo-image-picker and the chat feature's R2 upload hook so
 * both the submit screen and the conversation reply box share one flow.
 *
 * Attachments upload as they're picked; `storagePaths` are the successfully
 * uploaded R2 paths ("r2:…") to hand to submit/postMessage. Local URIs drive
 * the optimistic thumbnails while uploads are in flight.
 */
import { useCallback, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { notify } from "@/utils/platformAlert";
import { useImageUpload } from "@features/chat/hooks/useImageUpload";

export interface ImageAttachment {
  /** Stable local id for keys/removal. */
  id: string;
  /** Local device URI — shown as the thumbnail while (and after) uploading. */
  localUri: string;
  /** R2 storage path once uploaded; undefined while in flight or on failure. */
  storagePath?: string;
  uploading: boolean;
  failed: boolean;
}

export interface UseImageAttachments {
  attachments: ImageAttachment[];
  /** Open the library and upload the chosen pictures. */
  pick: () => Promise<void>;
  remove: (id: string) => void;
  reset: () => void;
  /** True while any attachment is still uploading. */
  uploading: boolean;
  /** R2 paths for the successfully uploaded pictures. */
  storagePaths: string[];
}

export function useImageAttachments(): UseImageAttachments {
  const { uploadImage } = useImageUpload();
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const nextId = useRef(0);

  const pick = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 0.8,
    });
    if (result.canceled) return;

    const picked = result.assets.map((asset) => {
      const id = `att-${nextId.current++}`;
      return { id, localUri: asset.uri };
    });
    setAttachments((prev) => [
      ...prev,
      ...picked.map((p) => ({
        id: p.id,
        localUri: p.localUri,
        uploading: true,
        failed: false,
      })),
    ]);

    await Promise.all(
      picked.map(async ({ id, localUri }) => {
        try {
          const { url, error } = await uploadImage(localUri);
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id
                ? error
                  ? { ...a, uploading: false, failed: true }
                  : { ...a, uploading: false, storagePath: url }
                : a,
            ),
          );
          if (error) {
            notify("Upload failed", "That picture couldn't be uploaded.");
          }
        } catch {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id ? { ...a, uploading: false, failed: true } : a,
            ),
          );
          notify("Upload failed", "That picture couldn't be uploaded.");
        }
      }),
    );
  }, [uploadImage]);

  const remove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const reset = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    pick,
    remove,
    reset,
    uploading: attachments.some((a) => a.uploading),
    storagePaths: attachments
      .filter((a) => a.storagePath)
      .map((a) => a.storagePath as string),
  };
}
