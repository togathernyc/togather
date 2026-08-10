/**
 * Server-side Cloudflare R2 object storage.
 *
 * The client upload pipeline (`functions/uploads.ts`) is presigned-URL only:
 * the *client* PUTs the bytes. Server-side flows that already hold the bytes
 * (e.g. copying a church's chart out of Planning Center, ADR-027 Phase 2) need
 * to PUT directly. This is the lowest-level R2 helper for that — it reuses the
 * same S3-compatible client, env vars, and `r2:<key>` storage-path convention
 * that `getR2FileUploadUrl` and `getMediaUrl` use, so files land in the same
 * bucket and resolve through the same URL resolver.
 */

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Generate an R2 object key under `folder`, sanitizing the file name. */
function buildObjectKey(folder: string, fileName: string): string {
  const uuid = crypto.randomUUID();
  const sanitized = fileName
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .slice(0, 50);
  return `${folder}/${uuid}-${sanitized}`;
}

/**
 * Upload bytes to R2 and return the database storage path (`r2:<key>`),
 * resolvable to a public URL via `getMediaUrl`.
 *
 * PROVENANCE (`grantTo`): this is the SECOND producer of `r2:` keys, alongside
 * the presigned-URL actions in `functions/uploads.ts`. Anything that treats an
 * `r2:` key as evidence of who uploaded it — today only `submitExpense`'s
 * receipt check — reads `uploadGrants`, and a key with no row there is refused.
 * So a server-side upload made ON BEHALF OF a member must pass `grantTo`, or
 * that member's own file would be rejected as not theirs. Uploads that belong
 * to the system rather than to a person (PCO song files, dev-assistant config)
 * pass nothing, deliberately: no row means no user can claim the key.
 *
 * @throws Error if R2 env vars are not configured.
 */
export async function putR2Object(args: {
  folder: string;
  fileName: string;
  contentType: string;
  body: ArrayBuffer;
  /** Attribute the resulting key to a user, so they can use it as a receipt. */
  grantTo?: { ctx: ActionCtx; userId: Id<"users"> };
}): Promise<{ key: string; storagePath: string }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 not configured. Missing environment variables.");
  }

  const key = buildObjectKey(args.folder, args.fileName);

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  await r2Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: new Uint8Array(args.body),
      ContentType: args.contentType,
    })
  );

  const storagePath = `r2:${key}`;

  if (args.grantTo) {
    // Best-effort, exactly like the presign path: the bytes are already in
    // R2, so throwing here would fail an upload that actually succeeded. A
    // missing row costs the user a re-upload, never a false accept.
    try {
      await args.grantTo.ctx.runMutation(
        internal.functions.uploads.recordUploadGrant,
        {
          storagePath,
          userId: args.grantTo.userId,
          folder: args.folder,
          contentType: args.contentType,
        },
      );
    } catch (error) {
      console.error(
        `[r2] could not record the upload grant for ${storagePath} — the object is stored, but it can't be used as a receipt`,
        error,
      );
    }
  }

  return { key, storagePath };
}
