/**
 * Envelope-encryption tests for provider credentials (ADR-033 §3).
 *
 * lib/finance/credentialCrypto.ts is what stands between a church's card-
 * issuer API key and a database dump, so the properties asserted here are the
 * ones that make the storage claim true, not just "it round-trips":
 *
 * - a wrong master key FAILS rather than returning garbage,
 * - a tampered ciphertext FAILS (GCM's auth tag, not a checksum we hope for),
 * - a missing/malformed key throws a message an operator can act on,
 * - two encryptions of the same plaintext differ (a fresh IV per call — a
 *   deterministic ciphertext would leak which communities share a vendor),
 * - a ciphertext lifted from ANOTHER row fails, because it is bound to its
 *   own community/provider/purpose as AAD.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-credential-crypto.test.ts
 */

import { expect, test, describe, afterEach } from "vitest";
import {
  encryptCredential,
  decryptCredential,
  CURRENT_KEY_VERSION,
  type CredentialContext,
} from "../lib/finance/credentialCrypto";

/** Two distinct, valid 32-byte base64 keys. */
const KEY_A = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY_B = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

/** The row every test below encrypts "for", unless it is testing the binding. */
const CTX: CredentialContext = {
  communityId: "community_a",
  provider: "privacy",
  purpose: "apiKey",
};

const ORIGINAL_KEY = process.env.CREDENTIALS_MASTER_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.CREDENTIALS_MASTER_KEY;
  } else {
    process.env.CREDENTIALS_MASTER_KEY = ORIGINAL_KEY;
  }
});

describe("encryptCredential / decryptCredential", () => {
  test("round-trips a credential", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const secret = "pk_live_a1b2c3d4e5f6-not-a-real-key";

    const stored = await encryptCredential(secret, CTX);
    expect(stored.keyVersion).toBe(CURRENT_KEY_VERSION);
    // The plaintext must not be recoverable by eye from what we persist.
    expect(stored.ciphertext).not.toContain(secret);

    await expect(decryptCredential(stored, CTX)).resolves.toBe(secret);
  });

  test("round-trips non-ASCII and empty plaintext", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    for (const value of ["", "clé-secrète-🔐", "a".repeat(4096)]) {
      const stored = await encryptCredential(value, CTX);
      await expect(decryptCredential(stored, CTX)).resolves.toBe(value);
    }
  });

  test("the same plaintext encrypts differently every time (fresh IV)", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const a = await encryptCredential("same-secret", CTX);
    const b = await encryptCredential("same-secret", CTX);

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // ...and both still decrypt. A unique IV that broke decryption would be
    // the worse bug.
    await expect(decryptCredential(a, CTX)).resolves.toBe("same-secret");
    await expect(decryptCredential(b, CTX)).resolves.toBe("same-secret");
  });

  test("decrypting with a DIFFERENT master key fails", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret-under-key-a", CTX);

    process.env.CREDENTIALS_MASTER_KEY = KEY_B;
    await expect(decryptCredential(stored, CTX)).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  test("a tampered ciphertext fails rather than decrypting to garbage", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret-to-tamper-with", CTX);

    // Flip one byte in the middle of the ciphertext.
    const bytes = Uint8Array.from(atob(stored.ciphertext), (c) =>
      c.charCodeAt(0),
    );
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const tampered = {
      ...stored,
      ciphertext: btoa(String.fromCharCode(...bytes)),
    };

    await expect(decryptCredential(tampered, CTX)).rejects.toThrow(
      /tampered with|could not be decrypted/,
    );
  });

  test("a tampered IV fails too", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret-with-good-iv", CTX);

    const ivBytes = Uint8Array.from(atob(stored.iv), (c) => c.charCodeAt(0));
    ivBytes[0] ^= 0xff;
    await expect(
      decryptCredential(
        {
          ...stored,
          iv: btoa(String.fromCharCode(...ivBytes)),
        },
        CTX,
      ),
    ).rejects.toThrow(/could not be decrypted/);
  });

  test("a non-base64 stored ciphertext is refused as corrupt, not passed to WebCrypto", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret", CTX);

    await expect(
      decryptCredential({ ...stored, ciphertext: "!!! not base64 @@@" }, CTX),
    ).rejects.toThrow(/corrupted/);
    await expect(
      decryptCredential({ ...stored, iv: "!!! not base64 @@@" }, CTX),
    ).rejects.toThrow(/corrupted/);
  });

  test("a truncated ciphertext fails closed rather than decoding short", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret-to-truncate", CTX);

    // Drop the tail — GCM's 16-byte auth tag lives there, so this is the
    // shape a partial write or a truncating column would produce. It must
    // throw, never return a prefix of the plaintext.
    const bytes = Uint8Array.from(atob(stored.ciphertext), (c) =>
      c.charCodeAt(0),
    );
    const truncated = btoa(
      String.fromCharCode(...bytes.slice(0, Math.max(1, bytes.length - 8))),
    );
    await expect(
      decryptCredential({ ...stored, ciphertext: truncated }, CTX),
    ).rejects.toThrow(/could not be decrypted/);
  });

  /**
   * The failure path is the one an operator reads in a log line, so it must
   * not be the thing that leaks what the encryption protects. Asserted here
   * rather than trusted from a code read: an error message is exactly the
   * kind of string a later "make this easier to debug" edit widens.
   */
  test("no failure message leaks key material, ciphertext, or plaintext", async () => {
    const secret = "pk_live_leak_canary_do_not_log";
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential(secret, CTX);

    const messages: string[] = [];
    process.env.CREDENTIALS_MASTER_KEY = KEY_B;
    await decryptCredential(stored, CTX).catch((e) => messages.push(String(e)));
    await decryptCredential({ ...stored, keyVersion: 99 }, CTX).catch((e) =>
      messages.push(String(e)),
    );
    delete process.env.CREDENTIALS_MASTER_KEY;
    await encryptCredential(secret, CTX).catch((e) => messages.push(String(e)));
    process.env.CREDENTIALS_MASTER_KEY = "not base64 !!! @@@";
    await encryptCredential(secret, CTX).catch((e) => messages.push(String(e)));

    expect(messages).toHaveLength(4);
    for (const message of messages) {
      expect(message).not.toContain(secret);
      expect(message).not.toContain(KEY_A);
      expect(message).not.toContain(KEY_B);
      expect(message).not.toContain(stored.ciphertext);
      expect(message).not.toContain(stored.iv);
    }
  });

  /**
   * The property GCM's auth tag alone does NOT give you. A ciphertext that
   * authenticates is proof it wasn't altered — not proof it belongs in the row
   * you found it in. Without the AAD binding, a mis-scoped query or a bad row
   * update would hand community A a perfectly valid decrypt of community B's
   * money-moving credential, and every existing test above would still pass.
   */
  test("a ciphertext from another row does not decrypt under this row's context", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("community-a-api-key", CTX);

    const otherRows: CredentialContext[] = [
      { ...CTX, communityId: "community_b" }, // another church
      { ...CTX, provider: "bill" }, // same church, other issuer
      { ...CTX, purpose: "webhookSecret" }, // same row, other secret
    ];
    for (const context of otherRows) {
      await expect(decryptCredential(stored, context)).rejects.toThrow(
        /could not be decrypted/,
      );
    }

    // ...and the row it really belongs to is unaffected.
    await expect(decryptCredential(stored, CTX)).resolves.toBe(
      "community-a-api-key",
    );
  });

  test("context is bound by value, not by object identity or key order", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret", CTX);

    // A caller that assembles the same facts in a different literal order
    // must still decrypt — otherwise the binding would be a latent
    // time-bomb that fires the first time someone reorders a struct.
    await expect(
      decryptCredential(stored, {
        purpose: "apiKey",
        provider: "privacy",
        communityId: "community_a",
      }),
    ).resolves.toBe("secret");
  });

  test("an unknown keyVersion is refused before any decrypt is attempted", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret", CTX);

    await expect(
      decryptCredential({ ...stored, keyVersion: 99 }, CTX),
    ).rejects.toThrow(/key rotation is incomplete/);
  });
});

describe("CREDENTIALS_MASTER_KEY validation", () => {
  test("a missing key throws, naming the variable", async () => {
    delete process.env.CREDENTIALS_MASTER_KEY;
    await expect(encryptCredential("secret", CTX)).rejects.toThrow(
      /CREDENTIALS_MASTER_KEY environment variable is not configured/,
    );
  });

  test("a key of the wrong length throws, saying how long it must be", async () => {
    // 16 bytes — valid base64, wrong size for AES-256.
    process.env.CREDENTIALS_MASTER_KEY = btoa(
      String.fromCharCode(...new Uint8Array(16).fill(1)),
    );
    await expect(encryptCredential("secret", CTX)).rejects.toThrow(
      /must decode to exactly 32 bytes/,
    );
  });

  test("a non-base64 key throws", async () => {
    process.env.CREDENTIALS_MASTER_KEY = "not base64 !!! @@@";
    await expect(encryptCredential("secret", CTX)).rejects.toThrow(
      /CREDENTIALS_MASTER_KEY/,
    );
  });

  test("decrypt is gated on the key too, not just encrypt", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret", CTX);

    delete process.env.CREDENTIALS_MASTER_KEY;
    await expect(decryptCredential(stored, CTX)).rejects.toThrow(
      /CREDENTIALS_MASTER_KEY environment variable is not configured/,
    );
  });
});
