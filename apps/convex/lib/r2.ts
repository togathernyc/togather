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

/**
 * Resolve a stored media path or full CDN URL to its R2 object key.
 *
 * Storage paths are `r2:<key>` (what `getR2FileUploadUrl` hands the client),
 * but some records hold the fully-resolved public URL, so handle both.
 * Returns null for anything that isn't an R2 object (e.g. legacy/external URLs).
 */
export function r2KeyFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("r2:")) return path.slice(3);
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl && path.startsWith(`${publicUrl}/`)) {
    return path.slice(publicUrl.length + 1);
  }
  return null;
}

/**
 * Read an R2 object's bytes (and content type) from the server.
 *
 * @throws Error if R2 env vars are not configured or the object is missing.
 */
export async function getR2Object(
  key: string
): Promise<{ body: ArrayBuffer; contentType?: string }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 not configured. Missing environment variables.");
  }

  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const res = await r2Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key })
  );
  if (!res.Body) {
    throw new Error(`R2 object not found or empty: ${key}`);
  }
  // AWS SDK v3 (Node) stream helper -> bytes
  const bytes = await (
    res.Body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray();
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return { body, contentType: res.ContentType };
}

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
 * @throws Error if R2 env vars are not configured.
 */
export async function putR2Object(args: {
  folder: string;
  fileName: string;
  contentType: string;
  body: ArrayBuffer;
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

  return { key, storagePath: `r2:${key}` };
}
