import { describe, it } from "node:test";
import assert from "node:assert";
import { normalizeLegacyNotes } from "../../src/lib/markdown/legacy-notes";

describe("normalizeLegacyNotes", () => {
  it("keeps Markdown tables intact", () => {
    const table = "| Macro | Meta diária |\n|---|---|\n| **Calorias** | 2.230 kcal |\n| **Proteína** | 215 g |";
    assert.strictEqual(normalizeLegacyNotes(table), table);
  });

  it("keeps aligned table separators and horizontal rules intact", () => {
    const text = "| a | b |\n|:---|---:|\n| 1 | 2 |\n\n---\n\nTexto";
    assert.strictEqual(normalizeLegacyNotes(text), text);
  });

  it("still converts legacy section markers on their own line", () => {
    const out = normalizeLegacyNotes("=== PROTOCOLO ===\nTexto\n--- FARMACOLOGIA ---\nMais");
    assert.ok(out.includes("## PROTOCOLO"));
    assert.ok(out.includes("### FARMACOLOGIA"));
  });
});
