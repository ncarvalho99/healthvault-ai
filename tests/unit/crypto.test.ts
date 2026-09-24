import { describe, it } from "node:test";
import assert from "node:assert";
import { encryptApiKey, decryptApiKey, maskApiKey } from "../../src/lib/ai/crypto";

describe("AES-256-GCM Crypto Service", () => {
  it("should encrypt and successfully decrypt API keys without data corruption", () => {
    const rawApiKey = "sk-live-omniroute-secret-key-1234567890-abcdef";
    const encrypted = encryptApiKey(rawApiKey);

    assert.notStrictEqual(encrypted, rawApiKey);
    assert.strictEqual(encrypted.split(":").length, 3); // iv:authTag:ciphertext

    const decrypted = decryptApiKey(encrypted);
    assert.strictEqual(decrypted, rawApiKey);
  });

  it("should generate unique ciphertexts for identical plaintext (probabilistic IV)", () => {
    const key = "same-secret-token";
    const enc1 = encryptApiKey(key);
    const enc2 = encryptApiKey(key);

    assert.notStrictEqual(enc1, enc2);
    assert.strictEqual(decryptApiKey(enc1), key);
    assert.strictEqual(decryptApiKey(enc2), key);
  });

  it("should reject tampered or corrupted ciphertext", () => {
    const raw = "super-secret";
    const encrypted = encryptApiKey(raw);
    const [iv, tag, cipher] = encrypted.split(":");

    // Tamper with ciphertext
    const tampered = `${iv}:${tag}:${cipher.slice(0, -2)}ff`;
    assert.throws(() => {
      decryptApiKey(tampered);
    });
  });

  it("should mask API keys for safe UI display", () => {
    const key = "sk-ant-api03-abcdef1234567890";
    const masked = maskApiKey(key);
    assert.ok(masked.startsWith("sk-"));
    assert.ok(masked.endsWith("7890"));
    assert.ok(masked.includes("••••••••"));
  });
});
