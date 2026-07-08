import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";

// Capture what putR2Object sends to R2 without touching the network.
const s3 = vi.hoisted(() => ({ sent: [] as Array<{ input: Record<string, unknown> }> }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(cmd: { input: Record<string, unknown> }) {
      s3.sent.push(cmd);
      return {};
    }
  },
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

const SECRET = "test-callback-secret";

/** Sign a raw body the way a routine does: hex HMAC-SHA256 with the secret. */
const sign = async (body: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/** A few raw bytes, base64-encoded — stands in for a mock PNG. */
const IMG_B64 = Buffer.from([1, 2, 3, 4]).toString("base64");

describe("POST /dev-assistant/upload", () => {
  beforeEach(() => {
    s3.sent.length = 0;
    process.env.DEV_ASSISTANT_CALLBACK_SECRET = SECRET;
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "akid";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET_NAME = "bucket";
    process.env.R2_PUBLIC_URL = "https://cdn.example.com";
  });

  afterEach(() => {
    delete process.env.R2_PUBLIC_URL;
    delete process.env.R2_BUCKET_NAME;
  });

  const postSigned = async (
    t: ReturnType<typeof convexTest>,
    payload: Record<string, unknown>,
  ): Promise<Response> => {
    const body = JSON.stringify(payload);
    return t.fetch("/dev-assistant/upload", {
      method: "POST",
      body,
      headers: { "x-togather-signature": await sign(body) },
    });
  };

  test("missing signature → 401", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/dev-assistant/upload", {
      method: "POST",
      body: JSON.stringify({ dataBase64: IMG_B64 }),
      headers: {},
    });
    expect(res.status).toBe(401);
    expect(s3.sent).toHaveLength(0);
  });

  test("invalid signature → 401", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/dev-assistant/upload", {
      method: "POST",
      body: JSON.stringify({ dataBase64: IMG_B64 }),
      headers: { "x-togather-signature": "deadbeef" },
    });
    expect(res.status).toBe(401);
    expect(s3.sent).toHaveLength(0);
  });

  test("unsupported contentType → 400", async () => {
    const t = convexTest(schema, modules);
    const res = await postSigned(t, {
      dataBase64: IMG_B64,
      contentType: "image/gif",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Unsupported contentType/);
    expect(s3.sent).toHaveLength(0);
  });

  test("missing dataBase64 → 400", async () => {
    const t = convexTest(schema, modules);
    const res = await postSigned(t, { contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Missing dataBase64/);
    expect(s3.sent).toHaveLength(0);
  });

  test("storage not configured (no R2_PUBLIC_URL) → 500, no upload", async () => {
    delete process.env.R2_PUBLIC_URL;
    const t = convexTest(schema, modules);
    const res = await postSigned(t, { dataBase64: IMG_B64 });
    expect(res.status).toBe(500);
    expect(s3.sent).toHaveLength(0);
  });

  test("valid signed upload → 200, stores to R2 and returns a public URL", async () => {
    const t = convexTest(schema, modules);
    const res = await postSigned(t, {
      dataBase64: IMG_B64,
      contentType: "image/png",
      fileName: "before-after.png",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url).toMatch(
      /^https:\/\/cdn\.example\.com\/dev-assistant\/.+-before-after\.png$/,
    );
    expect(s3.sent).toHaveLength(1);
    expect(s3.sent[0].input).toMatchObject({
      Bucket: "bucket",
      ContentType: "image/png",
    });
    // Bytes round-trip through base64 → ArrayBuffer → R2 body.
    const stored = Buffer.from(s3.sent[0].input.Body as Uint8Array).toString(
      "base64",
    );
    expect(stored).toBe(IMG_B64);
  });

  test("a full data: URI is tolerated (tail is decoded)", async () => {
    const t = convexTest(schema, modules);
    const res = await postSigned(t, {
      dataBase64: `data:image/png;base64,${IMG_B64}`,
      contentType: "image/png",
    });
    expect(res.status).toBe(200);
    const stored = Buffer.from(s3.sent[0].input.Body as Uint8Array).toString(
      "base64",
    );
    expect(stored).toBe(IMG_B64);
  });
});

describe("POST /dev-assistant/callback screenshots validation", () => {
  beforeEach(() => {
    process.env.DEV_ASSISTANT_CALLBACK_SECRET = SECRET;
  });

  test("rejects non-http(s) screenshots (e.g. a data: URI) with 400", async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({
      bugId: "bug1",
      routineRunId: "run1",
      status: "IN_REVIEW",
      screenshots: ["data:image/png;base64,AAAA"],
    });
    const res = await t.fetch("/dev-assistant/callback", {
      method: "POST",
      body,
      headers: { "x-togather-signature": await sign(body) },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/screenshots/);
  });

  test("a mistyped screenshots field (not an array) is rejected with 400", async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({
      bugId: "bug1",
      routineRunId: "run1",
      status: "IN_REVIEW",
      screenshots: "https://cdn.example.com/x.png",
    });
    const res = await t.fetch("/dev-assistant/callback", {
      method: "POST",
      body,
      headers: { "x-togather-signature": await sign(body) },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/screenshots/);
  });
});
