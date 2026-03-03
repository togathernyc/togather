/**
 * Upload functions
 *
 * Functions for handling file uploads using Convex built-in storage
 * and S3 for specific use cases that require presigned URLs.
 *
 * Convex File Storage: https://docs.convex.dev/file-storage
 */

import { v } from "convex/values";
import { mutation, query, action } from "../_generated/server";
import { requireAuth, requireAuthFromToken } from "../lib/auth";

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

// Audio file types
const ALLOWED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac"];

const ALLOWED_AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
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
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

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
    await requireAuth(ctx, args.token);

    // Get the file URL
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) {
      throw new Error(
        `[confirmUpload] Failed to retrieve URL for storage ID: ${args.storageId}`
      );
    }

    // If entity provided, update the corresponding record
    if (args.entityType && args.entityId) {
      // TODO: Implement entity updates based on type
      // This would update user.profilePhoto, group.preview, or meeting.coverImage
      // For now, just return success with the URL
      //
      // Example implementation:
      // switch (args.entityType) {
      //   case "user":
      //     const userId = args.entityId as Id<"users">;
      //     await ctx.db.patch(userId, { profilePhoto: url });
      //     break;
      //   case "group":
      //     const groupId = args.entityId as Id<"groups">;
      //     await ctx.db.patch(groupId, { preview: url });
      //     break;
      //   case "meeting":
      //     const meetingId = args.entityId as Id<"meetings">;
      //     await ctx.db.patch(meetingId, { coverImage: url });
      //     break;
      // }
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
// S3 Presigned URL Functions (For Legacy/External Integration)
// ============================================================================

/**
 * Get presigned URL for S3 upload (action - can call external APIs)
 *
 * Use this when you need:
 * - Specific S3 bucket paths
 * - Integration with existing S3 infrastructure
 * - Image compression pipeline
 *
 * NOTE: This requires AWS credentials to be set as environment variables:
 * - AWS_REGION
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 * - AWS_S3_BUCKET
 */
export const getS3PresignedUrl = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    folder: folderValidator,
  },
  handler: async (_ctx, args): Promise<{
    uploadUrl: string;
    key: string;
    publicUrl: string;
  }> => {
    await requireAuthFromToken(args.token);
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

    // Get AWS configuration from environment
    const region = process.env.AWS_REGION || "us-east-1";
    const bucket = process.env.AWS_S3_BUCKET;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("AWS S3 not configured. Missing environment variables.");
    }

    // Generate unique key with UUID hash
    const hash = crypto.randomUUID().slice(0, 8);
    const baseName = args.fileName.replace(/\.[^.]+$/, "");
    const key = `${args.folder}/${baseName}_${hash}${ext}`;

    // Import AWS SDK dynamically (it's a heavy dependency)
    // Note: @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner must be installed
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: args.contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    }); // 1 hour

    return {
      uploadUrl,
      key,
      publicUrl: `https://${bucket}.s3.amazonaws.com/${key}`,
    };
  },
});

/**
 * Get presigned download URL for S3 file (action - can call external APIs)
 *
 * Generates a temporary download URL for private files stored in S3.
 * URL is valid for 1 hour.
 */
export const getS3DownloadUrl = action({
  args: {
    token: v.string(),
    key: v.string(),
  },
  handler: async (_ctx, args): Promise<{ url: string }> => {
    await requireAuthFromToken(args.token);
    // Get AWS configuration from environment
    const region = process.env.AWS_REGION || "us-east-1";
    const bucket = process.env.AWS_S3_BUCKET;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("AWS S3 not configured. Missing environment variables.");
    }

    // Import AWS SDK dynamically
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: args.key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

    return { url };
  },
});

// ============================================================================
// Cloudflare R2 Functions (New - Preferred)
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
  handler: async (_ctx, args): Promise<{
    uploadUrl: string;
    key: string;
    publicUrl: string;
    storagePath: string; // Path to store in database (r2:prefix)
  }> => {
    await requireAuthFromToken(args.token);
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
 * for chat attachments. Has a 10MB size limit enforced on the client.
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
  handler: async (_ctx, args): Promise<{
    uploadUrl: string;
    key: string;
    publicUrl: string;
    storagePath: string;
  }> => {
    await requireAuthFromToken(args.token);
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
 * Supports R2 (new), S3 (legacy), and full URLs
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

    // Legacy S3 path (backwards compatibility)
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION || "us-east-1";
    const compressedBucketUrl = process.env.AWS_S3_COMPRESSED_BUCKET_URL;

    // Priority 1: Use compressed bucket URL (for optimized images)
    if (compressedBucketUrl) {
      return `${compressedBucketUrl.replace(/\/$/, "")}/${args.path}`;
    }

    // Priority 2: Fall back to regular bucket URL
    if (bucket) {
      return `https://${bucket}.s3.${region}.amazonaws.com/${args.path}`;
    }

    return null;
  },
});

