/**
 * Upload functions
 *
 * Functions for handling file uploads using Convex built-in storage
 * and Cloudflare R2 for presigned URL uploads.
 *
 * Convex File Storage: https://docs.convex.dev/file-storage
 */

import { v } from "convex/values";
import { mutation, query, action } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth, requireAuthFromToken } from "../lib/auth";
import { requireGroupLeaderOrCommunityAdmin } from "./groups/mutations";

// ============================================================================
// Constants
// ============================================================================

// Image file types (existing)
const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"];

const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
];

// Legacy aliases for backwards compatibility
const ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS;
const ALLOWED_CONTENT_TYPES = ALLOWED_IMAGE_CONTENT_TYPES;

// Document file types
const ALLOWED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
];

const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];

// Audio file types (includes .webm for web MediaRecorder voice memos)
const ALLOWED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".webm"];

const ALLOWED_AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
  "audio/aac",
  "audio/webm",
];

// Video file types
const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

const ALLOWED_VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

// Combined file types (for general file uploads)
const ALLOWED_FILE_EXTENSIONS = [
  ...ALLOWED_IMAGE_EXTENSIONS,
  ...ALLOWED_DOCUMENT_EXTENSIONS,
  ...ALLOWED_AUDIO_EXTENSIONS,
  ...ALLOWED_VIDEO_EXTENSIONS,
];

const ALLOWED_FILE_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  ...ALLOWED_DOCUMENT_CONTENT_TYPES,
  ...ALLOWED_AUDIO_CONTENT_TYPES,
  ...ALLOWED_VIDEO_CONTENT_TYPES,
];

// File size limits
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// ============================================================================
// Validators
// ============================================================================

export const folderValidator = v.union(
  v.literal("uploads"),
  v.literal("profiles"),
  v.literal("groups"),
  v.literal("meetings"),
  v.literal("chat")
);

export const entityTypeValidator = v.union(
  v.literal("user"),
  v.literal("group"),
  v.literal("meeting")
);

// ============================================================================
// Convex Storage Functions (Preferred)
// ============================================================================

/**
 * Generate an upload URL for Convex's built-in file storage
 *
 * This is the preferred method for file uploads. Clients upload directly
 * to Convex storage, then call confirmUpload with the storageId.
 *
 * Client-side usage:
 * 1. Call generateUploadUrl() to get an upload URL
 * 2. POST the file to that URL (returns { storageId })
 * 3. Call confirmUpload({ storageId, ... }) to associate the file
 */
export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<string> => {
    await requireAuth(ctx, args.token);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Confirm upload completed and associate file with an entity
 *
 * After uploading to Convex storage, call this to:
 * 1. Validate the upload
 * 2. Get a public URL for the file
 * 3. Optionally associate with a user, group, or meeting
 */
export const confirmUpload = mutation({
  args: {
    token: v.string(),
    storageId: v.id("_storage"),
    entityType: v.optional(entityTypeValidator),
    entityId: v.optional(v.string()),
    folder: v.optional(folderValidator),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    storageId: string;
    url: string;
  }> => {
    const authUserId = await requireAuth(ctx, args.token);

    // Get the file URL
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) {
      throw new Error(
        `[confirmUpload] Failed to retrieve URL for storage ID: ${args.storageId}`
      );
    }

    // If entity provided, update the corresponding record
    if (args.entityType && args.entityId) {
      switch (args.entityType) {
        case "user": {
          const entityId = args.entityId as Id<"users">;
          if (entityId !== authUserId) {
            throw new Error("Cannot update another user's profile photo");
          }
          await ctx.db.patch(entityId, { profilePhoto: url });
          break;
        }
        case "group": {
          const entityId = args.entityId as Id<"groups">;
          await requireGroupLeaderOrCommunityAdmin(
            ctx,
            entityId,
            authUserId,
            "update this group's preview image"
          );
          await ctx.db.patch(entityId, { preview: url });
          break;
        }
        case "meeting": {
          const entityId = args.entityId as Id<"meetings">;
          const meeting = await ctx.db.get(entityId);
          if (!meeting) {
            throw new Error("Meeting not found");
          }
          await requireGroupLeaderOrCommunityAdmin(
            ctx,
            meeting.groupId,
            authUserId,
            "update this meeting's cover image"
          );
          await ctx.db.patch(entityId, { coverImage: url });
          break;
        }
      }
    }

    return {
      success: true,
      storageId: args.storageId,
      url,
    };
  },
});

/**
 * Get a URL for a stored file
 */
export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<string | null> => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

/**
 * Delete a file from storage
 */
export const deleteFile = mutation({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireAuth(ctx, args.token);
    await ctx.storage.delete(args.storageId);
    return { success: true };
  },
});

// ============================================================================
// Cloudflare R2 Functions
// ============================================================================

/**
 * Get presigned URL for R2 upload (action - can call external APIs)
 *
 * Use this for all new image uploads. R2 is S3-compatible with:
 * - 10GB free storage
 * - Free egress
 * - Built-in CDN via Cloudflare
 * - Image transformations via cdn-cgi/image/
 *
 * Required environment variables:
 * - R2_ACCESS_KEY_ID
 * - R2_SECRET_ACCESS_KEY
 * - R2_BUCKET_NAME
 * - R2_PUBLIC_URL
 * - CLOUDFLARE_ACCOUNT_ID
 */
export const getR2UploadUrl = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    folder: folderValidator,
  },
  handler: async (ctx, args): Promise<{
    uploadUrl: string;
    key: string;
    publicUrl: string;
    storagePath: string; // Path to store in database (r2:prefix)
  }> => {
    await requireAuthFromTokenAction(ctx, args.token);
    // Validate file extension
    const ext = "." + args.fileName.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(
        `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
      );
    }

    // Validate content type
    if (!ALLOWED_CONTENT_TYPES.includes(args.contentType)) {
      throw new Error(
        `Invalid content type. Allowed: ${ALLOWED_CONTENT_TYPES.join(", ")}`
      );
    }

    // Get R2 configuration from environment
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
      throw new Error("R2 not configured. Missing environment variables.");
    }

    // Generate unique key with UUID
    const uuid = crypto.randomUUID();
    const sanitizedFileName = args.fileName
      .replace(/[^a-zA-Z0-9.-]/g, "_") // Replace special chars
      .slice(0, 50); // Limit length
    const key = `${args.folder}/${uuid}-${sanitizedFileName}`;

    // R2 uses S3-compatible API
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    const r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: args.contentType,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, {
      expiresIn: 3600, // 1 hour
    });

    return {
      uploadUrl,
      key,
      publicUrl: `${publicUrl}/${key}`,
      storagePath: `r2:${key}`, // This is what gets stored in the database
    };
  },
});

/**
 * Get presigned URL for R2 file upload (supports documents, audio, video)
 *
 * Similar to getR2UploadUrl but supports a wider range of file types
 * for chat attachments. Has a 50MB size limit.
 *
 * Supported file types:
 * - Documents: PDF, TXT, DOC, DOCX, XLS, XLSX, CSV
 * - Audio: MP3, WAV, M4A, AAC
 * - Video: MP4, MOV, WEBM
 * - Images: JPG, JPEG, PNG, GIF, WEBP, HEIC, HEIF
 */
export const getR2FileUploadUrl = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    folder: folderValidator,
  },
  handler: async (ctx, args): Promise<{
    uploadUrl: string;
    key: string;
    publicUrl: string;
    storagePath: string;
  }> => {
    await requireAuthFromTokenAction(ctx, args.token);
    // Validate file size
    if (args.fileSize > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`
      );
    }

    // Validate file extension
    const ext = "." + args.fileName.split(".").pop()?.toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
      throw new Error(
        `Invalid file type "${ext}". Allowed: ${ALLOWED_FILE_EXTENSIONS.join(", ")}`
      );
    }

    // Validate content type
    if (!ALLOWED_FILE_CONTENT_TYPES.includes(args.contentType)) {
      throw new Error(
        `Invalid content type "${args.contentType}".`
      );
    }

    // Get R2 configuration from environment
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
      throw new Error("R2 not configured. Missing environment variables.");
    }

    // Generate unique key with UUID
    const uuid = crypto.randomUUID();
    const sanitizedFileName = args.fileName
      .replace(/[^a-zA-Z0-9.-]/g, "_") // Replace special chars
      .slice(0, 50); // Limit length
    const key = `${args.folder}/${uuid}-${sanitizedFileName}`;

    // R2 uses S3-compatible API
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    const r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: args.contentType,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, {
      expiresIn: 3600, // 1 hour
    });

    return {
      uploadUrl,
      key,
      publicUrl: `${publicUrl}/${key}`,
      storagePath: `r2:${key}`,
    };
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a stored path to a full URL
 * Supports R2 and full URLs
 */
export const getMediaUrl = query({
  args: { path: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<string | null> => {
    if (!args.path) return null;

    // If it's already a full URL, return as-is
    if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
      return args.path;
    }

    // R2 storage (new format with r2: prefix)
    if (args.path.startsWith("r2:")) {
      const r2PublicUrl = process.env.R2_PUBLIC_URL;
      if (!r2PublicUrl) {
        console.warn("R2_PUBLIC_URL not configured");
        return null;
      }
      const r2Path = args.path.slice(3); // Remove "r2:" prefix
      return `${r2PublicUrl}/${r2Path}`;
    }

    // Unrecognized path format
    return null;
  },
});

