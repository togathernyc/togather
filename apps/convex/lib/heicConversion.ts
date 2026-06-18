/**
 * Pure helpers for the HEIC→JPEG conversion pipeline (see
 * `functions/imageConversion.ts`).
 *
 * iPhone photos upload as HEIC, and Cloudflare's image transform mishandles the
 * HEIF orientation (irot/imir) boxes — it serves the thumbnail flipped/rotated
 * even though the original is correct. The durable fix is to re-encode HEIC to
 * an upright JPEG server-side. These string-only helpers are split out so they
 * can be unit-tested without the Node (`"use node"`) image-decoding runtime.
 */

/** Minimal shape of a chat message attachment relevant to conversion. */
export interface ConvertibleAttachment {
  type: string;
  url: string;
  name?: string;
  mimeType?: string;
}

/** True if `value` names a HEIC/HEIF file by extension. */
function hasHeicExtension(value: string | undefined): boolean {
  if (!value) return false;
  return /\.(heic|heif)$/i.test(value.trim());
}

/**
 * Whether an attachment is an image we should re-encode to JPEG.
 *
 * Matches on MIME type first (image/heic, image/heif) and falls back to the
 * file extension on either the stored url or the original file name, since the
 * client doesn't always set mimeType.
 */
export function isConvertibleHeicAttachment(att: ConvertibleAttachment): boolean {
  if (att.type !== "image") return false;
  const mime = att.mimeType?.toLowerCase().trim();
  if (mime === "image/heic" || mime === "image/heif") return true;
  return hasHeicExtension(att.url) || hasHeicExtension(att.name);
}

/**
 * Derive the JPEG file name for a converted attachment, preserving the original
 * base name where possible and swapping any .heic/.heif extension for .jpg.
 */
export function jpegFileName(
  att: Pick<ConvertibleAttachment, "name" | "url">,
  key: string
): string {
  const source = att.name?.trim() || key.split("/").pop() || "image";
  const base = source.replace(/\.(heic|heif)$/i, "");
  return `${base || "image"}.jpg`;
}
