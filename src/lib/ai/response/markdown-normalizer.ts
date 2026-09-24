export class MarkdownNormalizer {
  /**
   * Normalizes presentation whitespace without altering markdown meaning or stripping valid syntax.
   */
  static normalize(text: string): string {
    if (!text) return "";

    return text
      // 1. CRLF to LF
      .replace(/\r\n/g, "\n")
      // 2. Strip trailing whitespaces on each line
      .replace(/[ \t]+$/gm, "")
      // 3. Normalize multiple consecutive horizontal rules (e.g. --- \n ---)
      .replace(/(?:^|\n)(?:[-*_]{3,}[ \t]*\n)+/g, "\n---\n")
      // 4. Collapse excessive blank lines (more than 2 consecutive newlines)
      .replace(/\n{3,}/g, "\n\n")
      // 5. Trim leading and trailing whitespace
      .trim();
  }
}
