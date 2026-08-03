/**
 * Lightweight text hardening for user-generated content (posts).
 * Strips null/control chars and naive HTML tags; keeps newlines/tabs.
 */
export function sanitizeUserText(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    // Keep tab (9), LF (10); drop other C0 controls and DEL
    if (
      code === 0 ||
      (code < 32 && code !== 9 && code !== 10) ||
      code === 127
    ) {
      continue;
    }
    out += ch;
  }
  return out.replace(/<\/?[a-zA-Z][^>]*>/g, '').normalize('NFC');
}
