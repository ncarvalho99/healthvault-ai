import { describe, it } from "node:test";
import assert from "node:assert";
import { normalizeBaseUrl } from "../../src/lib/ai/provider/omniroute-provider";

describe("OmniRoute URL Normalization", () => {
  it("should normalize URLs ending with /v1", () => {
    const input = "https://omniroute-local.nclabs.dev/v1";
    const res = normalizeBaseUrl(input);

    assert.strictEqual(res.baseUrl, "https://omniroute-local.nclabs.dev/v1");
    assert.strictEqual(res.modelsUrl, "https://omniroute-local.nclabs.dev/v1/models");
    assert.strictEqual(res.chatUrl, "https://omniroute-local.nclabs.dev/v1/chat/completions");
  });

  it("should normalize URLs ending with /v1/ (trailing slash)", () => {
    const input = "https://omniroute-local.nclabs.dev/v1/";
    const res = normalizeBaseUrl(input);

    assert.strictEqual(res.baseUrl, "https://omniroute-local.nclabs.dev/v1");
    assert.strictEqual(res.modelsUrl, "https://omniroute-local.nclabs.dev/v1/models");
    assert.strictEqual(res.chatUrl, "https://omniroute-local.nclabs.dev/v1/chat/completions");
  });

  it("should append /v1 if missing and prevent duplicate /v1/v1", () => {
    const input = "https://omniroute-local.nclabs.dev";
    const res = normalizeBaseUrl(input);

    assert.strictEqual(res.baseUrl, "https://omniroute-local.nclabs.dev/v1");
    assert.strictEqual(res.modelsUrl, "https://omniroute-local.nclabs.dev/v1/models");
    assert.strictEqual(res.chatUrl, "https://omniroute-local.nclabs.dev/v1/chat/completions");
    assert.strictEqual(res.modelsUrl.includes("/v1/v1"), false);
  });
});
