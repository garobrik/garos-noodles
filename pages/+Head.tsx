// Environment: server
// Cumulative: applies to all pages, cannot be overridden.
// Preload fonts so they download in parallel with CSS/JS, avoiding
// FOUT pop-in when `font-display: swap` kicks in on first paint.
// Also emits `noindex` for unpublished noodles (drafts and unlisted pages).
import { usePageContext } from 'vike-react/usePageContext';

// Noodle pages live in this route group; non-noodle pages (index, about,
// error) are never unpublished.
const NOODLE_PAGE_ID_PREFIX = '/pages/(noodle)/';

export function Head() {
  const { pageId, config } = usePageContext();
  const frontmatter = config.frontmatter;
  const isUnpublishedNoodle =
    (pageId ?? '').startsWith(NOODLE_PAGE_ID_PREFIX) &&
    (frontmatter?.draft === true || frontmatter?.publish !== 'listed');
  return (
    <>
      {isUnpublishedNoodle && <meta name="robots" content="noindex" />}
      <link
        rel="alternate"
        type="application/atom+xml"
        title="garo's noodle garden"
        href="/atom.xml"
      />
      <link
        rel="preload"
        href="/fonts/fraunces-latin-full-normal.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        href="/fonts/fraunces-latin-full-italic.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        href="/fonts/literata-latin-opsz-normal.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
    </>
  );
}
