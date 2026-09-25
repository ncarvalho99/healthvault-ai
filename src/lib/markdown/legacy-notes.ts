/**
 * Normalizes legacy text formatting (e.g. === PROTOCOLO === or --- FARMACOLOGIA ---)
 * for display into clean Markdown headings without mutating stored database records.
 *
 * Patterns are anchored to a whole line and exclude "|" so Markdown table separators
 * (|---|---|) and horizontal rules are left untouched.
 */
export function normalizeLegacyNotes(raw: string): string {
  if (!raw) return "";

  let text = raw.replace(/\r\n/g, "\n");

  // "=== TITLE ===" or "=== TITLE" on its own line → ## TITLE
  text = text.replace(/^[ \t]*===[ \t]*([^=|\n]+?)[ \t]*(?:===)?[ \t]*$/gm, "\n## $1\n");

  // "--- SECTION ---" on its own line → ### SECTION
  text = text.replace(/^[ \t]*---[ \t]*([^-|\n]+?)[ \t]*---[ \t]*$/gm, "\n### $1\n");

  // Clean excessive blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
