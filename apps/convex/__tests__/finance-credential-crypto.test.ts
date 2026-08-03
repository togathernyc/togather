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
 *   deterministic ciphertext would leak which communities share a vendor).
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-credential-crypto.test.ts
 */

import { expect, test, describe, afterEach } from "vitest";
import {
  encryptCredential,
  decryptCredential,
  CURRENT_KEY_VERSION,
} from "../lib/finance/credentialCrypto";

/** Two distinct, valid 32-byte base64 keys. */
const KEY_A = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY_B = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

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

    const stored = await encryptCredential(secret);
    expect(stored.keyVersion).toBe(CURRENT_KEY_VERSION);
    // The plaintext must not be recoverable by eye from what we persist.
    expect(stored.ciphertext).not.toContain(secret);

    await expect(decryptCredential(stored)).resolves.toBe(secret);
  });

  test("round-trips non-ASCII and empty plaintext", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    for (const value of ["", "clé-secrète-🔐", "a".repeat(4096)]) {
      const stored = await encryptCredential(value);
      await expect(decryptCredential(stored)).resolves.toBe(value);
    }
  });

  test("the same plaintext encrypts differently every time (fresh IV)", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const a = await encryptCredential("same-secret");
    const b = await encryptCredential("same-secret");

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // ...and both still decrypt. A unique IV that broke decryption would be
    // the worse bug.
    await expect(decryptCredential(a)).resolves.toBe("same-secret");
    await expect(decryptCredential(b)).resolves.toBe("same-secret");
  });

  test("decrypting with a DIFFERENT master key fails", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret-under-key-a");

    process.env.CREDENTIALS_MASTER_KEY = KEY_B;
    await expect(decryptCredential(stored)).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  test("a tampered ciphertext fails rather than decrypting to garbage", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret-to-tamper-with");

    // Flip one byte in the middle of the ciphertext.
    const bytes = Uint8Array.from(atob(stored.ciphertext), (c) =>
      c.charCodeAt(0),
    );
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const tampered = {
      ...stored,
      ciphertext: btoa(String.fromCharCode(...bytes)),
    };

    await expect(decryptCredential(tampered)).rejects.toThrow(
      /tampered with|could not be decrypted/,
    );
  });

  test("a tampered IV fails too", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret-with-good-iv");

    const ivBytes = Uint8Array.from(atob(stored.iv), (c) => c.charCodeAt(0));
    ivBytes[0] ^= 0xff;
    await expect(
      decryptCredential({
        ...stored,
        iv: btoa(String.fromCharCode(...ivBytes)),
      }),
    ).rejects.toThrow(/could not be decrypted/);
  });

  test("an unknown keyVersion is refused before any decrypt is attempted", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret");

    await expect(
      decryptCredential({ ...stored, keyVersion: 99 }),
    ).rejects.toThrow(/key rotation is incomplete/);
  });
});

describe("CREDENTIALS_MASTER_KEY validation", () => {
  test("a missing key throws, naming the variable", async () => {
    delete process.env.CREDENTIALS_MASTER_KEY;
    await expect(encryptCredential("secret")).rejects.toThrow(
      /CREDENTIALS_MASTER_KEY environment variable is not configured/,
    );
  });

  test("a key of the wrong length throws, saying how long it must be", async () => {
    // 16 bytes — valid base64, wrong size for AES-256.
    process.env.CREDENTIALS_MASTER_KEY = btoa(
      String.fromCharCode(...new Uint8Array(16).fill(1)),
    );
    await expect(encryptCredential("secret")).rejects.toThrow(
      /must decode to exactly 32 bytes/,
    );
  });

  test("a non-base64 key throws", async () => {
    process.env.CREDENTIALS_MASTER_KEY = "not base64 !!! @@@";
    await expect(encryptCredential("secret")).rejects.toThrow(
      /CREDENTIALS_MASTER_KEY/,
    );
  });

  test("decrypt is gated on the key too, not just encrypt", async () => {
    process.env.CREDENTIALS_MASTER_KEY = KEY_A;
    const stored = await encryptCredential("secret");

    delete process.env.CREDENTIALS_MASTER_KEY;
    await expect(decryptCredential(stored)).rejects.toThrow(
      /CREDENTIALS_MASTER_KEY environment variable is not configured/,
    );
  });
});
