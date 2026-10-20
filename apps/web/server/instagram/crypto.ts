import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Binary } from "mongodb";
import type { InstagramConfig } from "./config";

// AES-256-GCM token encryption (SYSTEM_DESIGN.md 12.1): unique 96-bit nonce, key version, and associated data
// binding the ciphertext to its owner and connection so a copied blob cannot be used elsewhere.

export type EncryptedSecret = { algorithm: "A256GCM"; keyVersion: number; nonce: Binary; ciphertext: Binary; tag: Binary };

const aad = (ownerId: string, connectionId: string) => Buffer.from(`namastevideo:instagram-token:v1:${ownerId}:${connectionId}`, "utf8");

export function encryptToken(config: Pick<InstagramConfig, "keys" | "currentKeyVersion">, ownerId: string, connectionId: string, token: string): EncryptedSecret {
  const key = config.keys.get(config.currentKeyVersion);
  if (!key) throw new Error("Instagram token key is not configured.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(ownerId, connectionId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { algorithm: "A256GCM", keyVersion: config.currentKeyVersion, nonce: new Binary(nonce), ciphertext: new Binary(ciphertext), tag: new Binary(cipher.getAuthTag()) };
}

export function decryptToken(config: Pick<InstagramConfig, "keys">, ownerId: string, connectionId: string, secret: EncryptedSecret): string {
  const key = config.keys.get(secret.keyVersion);
  if (!key || secret.algorithm !== "A256GCM") throw new Error("Instagram token cannot be decrypted with the configured keys.");
  const buffer = (value: Binary | Buffer | Uint8Array) => (value instanceof Binary ? Buffer.from(value.buffer) : Buffer.from(value));
  const decipher = createDecipheriv("aes-256-gcm", key, buffer(secret.nonce));
  decipher.setAAD(aad(ownerId, connectionId));
  decipher.setAuthTag(buffer(secret.tag));
  return Buffer.concat([decipher.update(buffer(secret.ciphertext)), decipher.final()]).toString("utf8");
}
