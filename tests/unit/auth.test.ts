import { describe, it } from "node:test";
import assert from "node:assert";
import { hashPassword, verifyPassword, createSessionToken, verifySessionToken } from "../../src/lib/auth";

describe("Authentication & Token Service", () => {
  it("should securely hash and verify passwords", async () => {
    const raw = "SuperSecretPassword2026!";
    const hashed = await hashPassword(raw);

    assert.notStrictEqual(raw, hashed);
    assert.ok(hashed.startsWith("$2a$") || hashed.startsWith("$2b$"));

    const isMatch = await verifyPassword(raw, hashed);
    assert.strictEqual(isMatch, true);

    const isWrong = await verifyPassword("WrongPassword123!", hashed);
    assert.strictEqual(isWrong, false);
  });

  it("should sign and verify valid JWT session tokens", async () => {
    const payload = {
      userId: "test-user-uuid-1234",
      username: "operator",
      role: "ADMIN",
    };

    const token = await createSessionToken(payload, "1h");
    assert.ok(typeof token === "string");
    assert.ok(token.split(".").length === 3);

    const verified = await verifySessionToken(token);
    assert.ok(verified);
    assert.strictEqual(verified.userId, payload.userId);
    assert.strictEqual(verified.username, payload.username);
    assert.strictEqual(verified.role, payload.role);
  });

  it("should reject tampered or invalid tokens", async () => {
    const invalidToken = "invalid.token.payload";
    const verified = await verifySessionToken(invalidToken);
    assert.strictEqual(verified, null);
  });
});
