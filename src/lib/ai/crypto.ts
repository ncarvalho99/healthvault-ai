import crypto from "node:crypto";

function getEncryptionKey(): Buffer {
  const envKey = process.env.APP_ENCRYPTION_KEY || process.env.JWT_SECRET || "healthvault_default_secure_encryption_key_2026";
  // Create deterministic 32-byte (256-bit) key via SHA-256
  return crypto.createHash("sha256").update(envKey).digest();
}

/**
 * Encrypts an API key using AES-256-GCM.
 * Output format: `ivHex:authTagHex:encryptedHex`
 */
export function encryptApiKey(plainKey: string): string {
  if (!plainKey) return "";
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plainKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted API key.
 */
export function decryptApiKey(encryptedPayload: string): string {
  if (!encryptedPayload) return "";
  
  // Format check
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted key format. Expected iv:authTag:ciphertext");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Masks an API key for safe display in UI (e.g. sk-••••••••1234)
 */
export function maskApiKey(plainOrEncrypted: string): string {
  if (!plainOrEncrypted) return "Não configurada";
  try {
    const plain = plainOrEncrypted.includes(":") ? decryptApiKey(plainOrEncrypted) : plainOrEncrypted;
    if (plain.length <= 8) return "••••••••";
    return `${plain.slice(0, 3)}••••••••${plain.slice(-4)}`;
  } catch {
    return "••••••••";
  }
}
