/**
 * Envelope encryption for third-party finance credentials (ADR-033 §3).
 *
 * The bring-your-own-cards model asks a community to hand us an API key for
 * THEIR card issuer. That key can move their money, so it can never sit in
 * the database the way `communityIntegrations` stores its credentials today
 * (plaintext, schema.ts) — a database dump, a mis-scoped query, or a
 * too-broad admin surface would leak spending power for every community at
 * once. Every provider credential goes through this module first.
 *
 * The scheme is deliberately boring: AES-256-GCM, a fresh random 96-bit IV
 * per encryption, and a single master key from the `CREDENTIALS_MASTER_KEY`
 * environment variable. GCM is authenticated, so a tampered ciphertext fails
 * to decrypt rather than returning garbage — the property that lets a caller
 * treat a successful `decryptCredential` as "this is exactly what we stored".
 *
 * Every ciphertext is additionally BOUND to the row it belongs to, via GCM's
 * additional authenticated data (see `CredentialContext`). Authenticity alone
 * would not stop a valid credential from being read out of the wrong row and
 * spending the wrong community's money; the binding upgrades a successful
 * decrypt from "this is what we stored" to "this is what we stored HERE".
 *
 * Web Crypto (`crypto.subtle`), not Node's `crypto`: this runs in the same
 * restricted V8 isolate that forced lib/finance/increase.ts to hand-roll its
 * webhook HMAC instead of using a Node/SDK helper. No `Buffer` either — the
 * base64 helpers below are the same `btoa`/`atob` shape increase.ts uses.
 *
 * KEY ROTATION is a v2 concern, but the format is rotation-ready now: every
 * ciphertext carries the `keyVersion` that produced it, so a future rotation
 * decrypts with the old key and re-encrypts with the new one, row by row,
 * without a flag day. Today exactly one version exists.
 */

/** The only key version in circulation. Stamped on every ciphertext we write. */
export const CURRENT_KEY_VERSION = 1;

/** AES-GCM's recommended IV size — 96 bits. Never reused across encryptions. */
const IV_BYTES = 12;

/** AES-256 needs exactly 32 bytes of key material. */
const MASTER_KEY_BYTES = 32;

/**
 * What a ciphertext is BOUND to (AES-GCM additional authenticated data).
 *
 * GCM's auth tag proves a ciphertext wasn't altered. It does not prove the
 * ciphertext belongs where you found it: a valid `(ciphertext, iv)` pair
 * copied from another `cardProviderConnections` row — a mis-scoped query, a
 * bad row update, a restored backup — decrypts perfectly, and community A
 * would silently start moving money with community B's credential. Binding
 * the row's immutable identity as AAD closes that: decryption with different
 * context fails the tag, exactly like tampering.
 *
 * Every field here must be IMMUTABLE for the life of the row. `communityId`
 * and `provider` never change; `purpose` distinguishes the two secrets a
 * single row holds, so a webhook secret can't be swapped in for an API key.
 * `accountLabel` and `status` are deliberately absent — they are editable,
 * and binding to an editable field would make a rename undecryptable.
 */
export interface CredentialContext {
  communityId: string;
  provider: string;
  purpose: "apiKey" | "webhookSecret";
}

/**
 * Serialize the context to the exact bytes both sides authenticate.
 *
 * JSON with the keys written out in a fixed order rather than
 * `JSON.stringify(obj)` over a literal: object key order is a property of how
 * the object was BUILT, and a caller assembling the context field-by-field in
 * a different order would produce different AAD and a credential that no
 * longer decrypts. Spelling the order out here makes it ours, not theirs.
 */
function contextBytes(context: CredentialContext): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([context.communityId, context.provider, context.purpose]),
  );
}

/**
 * A credential at rest. Every field is base64 except `keyVersion`, so the
 * whole thing round-trips through Convex's `v.string()` / `v.number()`
 * validators without a bytes type.
 */
export interface EncryptedCredential {
  /** Base64 AES-256-GCM ciphertext, with GCM's 16-byte auth tag appended (Web Crypto's default). */
  ciphertext: string;
  /** Base64 initialization vector — unique per encryption, stored alongside the ciphertext. */
  iv: string;
  /** Which master key encrypted this. See CURRENT_KEY_VERSION. */
  keyVersion: number;
}

// ============================================================================
// base64 <-> bytes (no Buffer — see the module header)
// ============================================================================

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// Master key
// ============================================================================

/**
 * Read + validate the master key.
 *
 * Read at CALL time, not module load (the lazy-env pattern from
 * lib/finance/increase.ts's `getIncreaseApiKey`): importing this module must
 * never fail codegen or a deploy in an environment that has no finance
 * traffic and therefore no key.
 *
 * The error messages name the variable and say what's wrong with it, because
 * the person who sees them is an operator mid-setup, not an end user. A
 * silently-wrong key would surface much later as an undecryptable credential.
 */
async function getMasterKey(usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const raw = process.env.CREDENTIALS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_MASTER_KEY environment variable is not configured — provider credentials cannot be encrypted or decrypted without it",
    );
  }

  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64ToBytes(raw.trim());
  } catch {
    throw new Error(
      "CREDENTIALS_MASTER_KEY is not valid base64 — it must be 32 random bytes, base64-encoded",
    );
  }
  if (keyBytes.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `CREDENTIALS_MASTER_KEY must decode to exactly ${MASTER_KEY_BYTES} bytes (AES-256), got ${keyBytes.length}`,
    );
  }

  return await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    [usage === "encrypt" ? "encrypt" : "decrypt"],
  );
}

// ============================================================================
// encrypt / decrypt
// ============================================================================

/**
 * Encrypt a credential for storage. The returned triple is what the caller
 * writes to the row (`credentialCiphertext` / `credentialIv` / `keyVersion`
 * on `cardProviderConnections`); nothing else about the plaintext should be
 * persisted, not even a length or a prefix.
 */
export async function encryptCredential(
  plaintext: string,
  context: CredentialContext,
): Promise<EncryptedCredential> {
  const key = await getMasterKey("encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: contextBytes(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Decrypt a stored credential.
 *
 * Throws on ANY failure — wrong master key, tampered ciphertext, corrupted
 * IV, unknown key version. That is the intended contract: a caller must never
 * be able to proceed with a credential it isn't sure of, so there is no
 * "returns null on failure" variant to accidentally ignore. The thrown
 * message never contains ciphertext or key material.
 */
export async function decryptCredential(
  credential: EncryptedCredential,
  context: CredentialContext,
): Promise<string> {
  if (credential.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(
      `Credential was encrypted with key version ${credential.keyVersion}, but only version ${CURRENT_KEY_VERSION} is available — a key rotation is incomplete`,
    );
  }

  const key = await getMasterKey("decrypt");
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = base64ToBytes(credential.iv);
    ciphertext = base64ToBytes(credential.ciphertext);
  } catch {
    throw new Error("Stored credential is not valid base64 — it is corrupted");
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: contextBytes(context) },
      key,
      ciphertext,
    );
  } catch {
    // GCM's authentication tag failed. The master key is wrong, the stored
    // bytes were altered, or this ciphertext belongs to a DIFFERENT row than
    // the context says (see CredentialContext). We deliberately don't try to
    // tell the caller which, because every answer is "do not use this
    // credential".
    throw new Error(
      "Stored credential could not be decrypted — wrong master key, tampered ciphertext, or a credential that does not belong to this connection",
    );
  }
  return new TextDecoder().decode(plaintext);
}
