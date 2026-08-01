/** Max distinct @mentions / #tags stored per post (design). */
export const MAX_TAGS = 10;

const MENTION_RE = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})\b/g;
const HASHTAG_RE = /#([\p{L}\p{N}_]{1,50})/gu;

/**
 * Extract @username handles (lowercase, deduped, max 10).
 * Requires 3–30 chars to match identity username rules.
 */
export function extractMentions(content: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) {
    const raw = m[1];
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
    if (found.length >= MAX_TAGS) break;
  }
  return found;
}

/** Extract #hashtags (lowercase, deduped, max 10). Preserves first-seen casing separately. */
export function extractHashtags(
  content: string,
): { tag: string; display: string }[] {
  const out: { tag: string; display: string }[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(HASHTAG_RE)) {
    const display = m[1];
    if (!display) continue;
    const tag = display.toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, display });
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
