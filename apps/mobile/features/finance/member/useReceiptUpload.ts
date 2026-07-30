/**
 * Uploads a reimbursement receipt photo to R2.
 *
 * Mirrors `features/chat/hooks/useImageUpload.ts`'s upload flow exactly
 * (presigned R2 URL from Convex, then a direct PUT) but targets the
 * `"uploads"` folder rather than `"chat"` — that hook's folder is hardcoded,
 * and `functions/uploads.ts` (owned by another part of this change) isn't in
 * this task's file-ownership list to edit. Kept as its own hook, rather than
 * generalizing the chat one, to stay inside that boundary.
 */
import { useState, useCallback } from "react";
import { Platform } from "react-native";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import { useAuthenticatedAction, api } from "@services/api/convex";

export interface ReceiptUploadResult {
  /** The `r2:<key>` storage path expected by `submitExpense`'s `receiptKey`. */
  storagePath: string;
  error?: string;
}

export interface UseReceiptUploadResult {
  uploadReceipt: (imageUri: string) => Promise<ReceiptUploadResult>;
  uploading: boolean;
}

export function useReceiptUpload(): UseReceiptUploadResult {
  const [uploading, setUploading] = useState(false);
  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);

  const uploadReceipt = useCallback(
    async (imageUri: string): Promise<ReceiptUploadResult> => {
      setUploading(true);
      try {
        let filename: string;
        let contentType: string;
        let webBlob: Blob | null = null;

        if (Platform.OS === "web") {
          const response = await fetch(imageUri);
          webBlob = await response.blob();
          contentType = webBlob.type || "image/jpeg";
          const ext = contentType.split("/")[1] || "jpg";
          const rawName = imageUri.split("/").pop() || "receipt";
          filename = /\.\w+$/.test(rawName) ? rawName : `${rawName}.${ext}`;
        } else {
          filename = imageUri.split("/").pop() || "receipt.jpg";
          const match = /\.(\w+)$/.exec(filename);
          const ext = match ? match[1].toLowerCase() : "jpg";
          contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        }

        const { uploadUrl, storagePath } = await getR2UploadUrl({
          fileName: filename,
          contentType,
          folder: "uploads",
        });

        if (Platform.OS === "web") {
          const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            body: webBlob!,
            headers: { "Content-Type": contentType },
          });
          if (!uploadResponse.ok) {
            throw new Error(`Failed to upload receipt: ${uploadResponse.statusText}`);
          }
        } else {
          const uploadResult = await uploadAsync(uploadUrl, imageUri, {
            httpMethod: "PUT",
            uploadType: FileSystemUploadType.BINARY_CONTENT,
            headers: { "Content-Type": contentType },
          });
          if (uploadResult.status < 200 || uploadResult.status >= 300) {
            throw new Error(`Failed to upload receipt: ${uploadResult.status}`);
          }
        }

        return { storagePath };
      } catch (error) {
        console.error("[useReceiptUpload] Upload error:", error);
        return {
          storagePath: "",
          error: error instanceof Error ? error.message : "Failed to upload receipt",
        };
      } finally {
        setUploading(false);
      }
    },
    [getR2UploadUrl],
  );

  return { uploadReceipt, uploading };
}
