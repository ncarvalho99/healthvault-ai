import { describe, it } from "node:test";
import assert from "node:assert";
import { checkRateLimit, resetRateLimit } from "../../src/lib/security";

describe("Security & Rate Limiting", () => {
  it("should allow requests within limit and block when exceeded", () => {
    const key = "test-rate-limit-" + Date.now();

    // 3 allowed attempts
    const r1 = checkRateLimit(key, 3, 60);
    assert.strictEqual(r1.success, true);
    assert.strictEqual(r1.remaining, 2);

    const r2 = checkRateLimit(key, 3, 60);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.remaining, 1);

    const r3 = checkRateLimit(key, 3, 60);
    assert.strictEqual(r3.success, true);
    assert.strictEqual(r3.remaining, 0);

    // 4th attempt should be blocked
    const r4 = checkRateLimit(key, 3, 60);
    assert.strictEqual(r4.success, false);
    assert.strictEqual(r4.remaining, 0);
    assert.ok(r4.retryAfterSeconds && r4.retryAfterSeconds > 0);

    // Reset should clear limit
    resetRateLimit(key);
    const r5 = checkRateLimit(key, 3, 60);
    assert.strictEqual(r5.success, true);
  });
});
