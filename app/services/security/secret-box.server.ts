import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts merchant-supplied secrets (their own AI provider API keys) at
// rest. The app never has its own AI credentials to hand out — every
// merchant brings their own — so protecting what they paste in is the
// whole point of this module.
//
// AES-256-GCM. Ciphertext is stored as base64(iv || authTag || data).

const ALGORITHM = "aes-256-gcm";

const IV_LENGTH = 12;

const AUTH_TAG_LENGTH = 16;

function loadKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is not configured on the app server. " +
        "Merchant AI provider credentials cannot be stored without it.",
    );
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).",
    );
  }

  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();

  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const key = loadKey();

  const combined = Buffer.from(ciphertext, "base64");

  const iv = combined.subarray(0, IV_LENGTH);

  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);

  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/** Last 4 characters, for a display hint like "sk-••••ab12". Never enough to reconstruct the key. */
export function lastFourOf(secret: string): string {
  return secret.slice(-4);
}
