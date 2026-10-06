/* slug helpers shared by the heading-anchor plugin (plugins/mdx.ts) and the
 * hand-rendered page title (pages/(noodle)/+Layout.tsx) so both agree on ids */

/** turn heading text into a url fragment */
export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      // keep letters (any script) and digits, drop everything else
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** per-document slugger: repeated slugs get `-1`, `-2`, ... suffixes */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
