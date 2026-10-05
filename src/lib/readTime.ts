/**
 * Minutes to read an article's HTML at 200 words a minute, at least 1.
 *
 * Shared by the library cards and the article page so a reader never sees two
 * different durations for the same article. Tags are replaced by a space, not
 * removed: "end.</p><p>Start" is two words, not one.
 */
export function readMinutes(html: string | null | undefined): number {
  if (!html) return 1;
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
