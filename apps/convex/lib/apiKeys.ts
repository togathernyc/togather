/**
 * API key generation and hashing helpers.
 *
 * Keys are issued to external integrations (e.g. an attendance dashboard) and
 * authenticate calls to the public HTTP API in `http.ts`.
 *
 * Security model:
 * - The raw key is returned to the admin exactly once at creation time.
 * - Only a SHA-256 hash of the raw key is stored (the `apiKeys.keyHash` field).
 * - Verification re-hashes the presented key and looks it up by hash, so the
 *   database never holds a usable secret.
 *
 * Both the create mutation and the HTTP verification path hash with the same
 * function, so they must stay in sync — keep all hashing here.
 */

/** Prefix that identifies a Togather API key. */
export const API_KEY_PREFIX = "tgk_";

/** Number of random bytes in the secret portion of a key (256 bits of entropy). */
const KEY_RANDOM_BYTES = 32;

/** Length of the displayable prefix stored alongside the hash. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

/**
 * Generate a new API key.
 *
 * Returns the raw key (shown to the admin once) and the display prefix that we
 * persist so the key can be recognized in the UI without exposing the secret.
 */
export function generateApiKey(): { raw: string; prefix: string } {
  const bytes = new Uint8Array(KEY_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const raw = `${API_KEY_PREFIX}${hex}`;
  return { raw, prefix: raw.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/**
 * Hash a raw API key with SHA-256 and return the hex digest.
 *
 * Used both when storing a freshly created key and when verifying an incoming
 * request, so the two paths produce identical hashes for the same raw key.
 */
export async function hashApiKey(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
