import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// AES-256-GCM encryption for OAuth tokens at rest (doc Sections 4 & 10).
// Key comes from OAUTH_ENC_KEY as "base64:<32-byte key>". Ciphertext is
// stored as "<iv>.<authTag>.<data>", each part base64. NEVER log raw tokens.

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM

function getKey(): Buffer {
  const raw = process.env.OAUTH_ENC_KEY;
  if (!raw) throw new Error("OAUTH_ENC_KEY is not set");
  const b64 = raw.startsWith("base64:") ? raw.slice("base64:".length) : raw;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      "OAUTH_ENC_KEY must decode to 32 bytes (256 bits). Generate with: " +
        "node -e \"console.log('base64:'+require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed ciphertext");
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
