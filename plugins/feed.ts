import react from '@vitejs/plugin-react';
import { createServer, type PluginOption } from 'vite';
import { mdx } from './mdx.ts';
import { isPublished, SITE_TITLE, SITE_URL, type GeneratedFile, type SitePage } from './site.ts';

/* ------------------------------------------------------------------------
 * Rendering noodle content
 *
 * The feed carries each noodle's full content, i.e. its rendered mdx module.
 * The module is loaded through a vite module graph (the dev server while
 * `npm run dev` runs, a short-lived one during the build) and rendered to
 * html with react-dom/server.
 *
 * Both the components and the renderer must come from that same graph:
 * mixing e.g. development-compiled components with a production react-dom
 * build blows up in react's internals.
 * --------------------------------------------------------------------- */

const RENDER_MODULE_ID = 'virtual:site-render';
const RENDER_MODULE_RESOLVED = '\0' + RENDER_MODULE_ID;

type LoadModule = (id: string) => Promise<Record<string, unknown>>;

/** a page's rendered content, with urls pointing at the public site */
export type ContentRenderer = (page: SitePage) => Promise<string>;

/** Makes the react rendering entry points available to module loaders. */
export function renderModule(): PluginOption {
  return {
    name: 'site:render-module',
    resolveId(id) {
      return id === RENDER_MODULE_ID ? RENDER_MODULE_RESOLVED : undefined;
    },
    load(id) {
      if (id !== RENDER_MODULE_RESOLVED) return undefined;
      return [
        `export { renderToStaticMarkup } from 'react-dom/server';`,
        `export { createElement } from 'react';`,
      ].join('\n');
    },
  };
}

/**
 * Loads +Page.mdx modules through `loadModule` and renders them to html.
 * `toPublicUrl` maps the urls a module produces (asset imports, ...) to
 * public ones; everything is then made absolute so the feed stands on its
 * own wherever it's read.
 */
export async function createContentRenderer(
  loadModule: LoadModule,
  toPublicUrl: (url: string) => string,
): Promise<ContentRenderer> {
  const { renderToStaticMarkup, createElement } = (await loadModule(RENDER_MODULE_ID)) as {
    renderToStaticMarkup: (element: unknown) => string;
    createElement: (component: unknown) => unknown;
  };

  return async (page) => {
    const component = (await loadModule(page.module)).default;
    if (typeof component !== 'function') return '';
    return absolutize(renderToStaticMarkup(createElement(component)), page, toPublicUrl);
  };
}

// urls the browser (or feed reader) resolves against the page itself: page
// links, asset urls, ... everything else (http(s), mailto:, in-page anchors)
// is left alone
const isAbsoluteUrl = (url: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);

function absolutize(html: string, page: SitePage, toPublicUrl: (url: string) => string): string {
  return html.replace(/\b(src|href)="([^"]*)"/g, (match, attribute: string, url: string) => {
    if (isAbsoluteUrl(url)) return match;
    const resolved = toPublicUrl(url);
    const absolute = resolved.startsWith('/')
      ? SITE_URL + resolved
      : new URL(resolved, `${SITE_URL}${page.route}/`).href;
    return `${attribute}="${escapeXml(absolute)}"`;
  });
}

/**
 * Runs `withLoadModule` with a vite dev server whose only job is to load the
 * page modules. Used during the build, where no dev server exists: it runs
 * in production mode so the pages compile exactly like the built site.
 */
export async function withBuildLoadModule<T>(
  root: string,
  withLoadModule: (loadModule: LoadModule) => Promise<T>,
): Promise<T> {
  const server = await createServer({
    configFile: false,
    root,
    mode: 'production',
    plugins: [
      renderModule(),
      mdx({ previewLength: 1000 }),
      react({ include: /\.(jsx|js|mdx|md|tsx|ts)$/ }),
    ],
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  try {
    return await withLoadModule((id) => server.ssrLoadModule(id));
  } finally {
    await server.close();
  }
}

/* ------------------------------------------------------------------------
 * The feed itself
 *
 * Atom (RFC 4287) with paged feeds (RFC 5005): the newest entries at
 * `/atom.xml`, older ones at `/atom/2.xml`, `/atom/3.xml`, ... with each
 * page linking to the next/previous one.
 * --------------------------------------------------------------------- */

export const FEED_PATHNAME = '/atom.xml';
export const FEED_PAGE_SIZE = 10;

/** the feed page holding `page`-numbered entries, e.g. 1 -> `/atom.xml` */
export function feedPathname(page: number): string {
  return page === 1 ? FEED_PATHNAME : `/atom/${page}.xml`;
}

// `added: 2025/09/15` -> `2025-09-15T00:00:00Z`
function toEntryDate(added: string | undefined): string | undefined {
  const match = added?.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` : undefined;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function generateFeedFiles(
  pages: SitePage[],
  renderContent: ContentRenderer,
): Promise<GeneratedFile[]> {
  const noodles = pages
    .filter((page) => page.isNoodle && isPublished(page))
    .filter((page) => toEntryDate(page.frontmatter.added))
    .sort((a, b) => (b.frontmatter.added ?? '').localeCompare(a.frontmatter.added ?? ''));

  const pageCount = Math.max(1, Math.ceil(noodles.length / FEED_PAGE_SIZE));
  const contents = new Map<string, string>();
  for (const noodle of noodles) contents.set(noodle.route, await renderContent(noodle));

  const files: GeneratedFile[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const entries = noodles.slice((page - 1) * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE);
    files.push({
      pathname: feedPathname(page),
      contentType: 'application/atom+xml; charset=utf-8',
      body: toFeedXml(entries, contents, page, pageCount),
    });
  }
  return files;
}

function toFeedXml(
  entries: SitePage[],
  contents: Map<string, string>,
  page: number,
  pageCount: number,
): string {
  const self = SITE_URL + feedPathname(page);
  const dates = entries.map(({ frontmatter }) => toEntryDate(frontmatter.added) ?? '');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(SITE_TITLE)}</title>`,
    `  <id>${self}</id>`,
    `  <updated>${dates[0] ?? '1970-01-01T00:00:00Z'}</updated>`,
    '  <author>',
    '    <name>garo brik</name>',
    '    <email>garo@garobrik.ca</email>',
    `    <uri>${SITE_URL}/</uri>`,
    '  </author>',
    `  <link rel="self" type="application/atom+xml" href="${self}"/>`,
    `  <link rel="alternate" type="text/html" href="${SITE_URL}/"/>`,
    ...(page < pageCount
      ? [
          `  <link rel="next" type="application/atom+xml" href="${SITE_URL + feedPathname(page + 1)}"/>`,
        ]
      : []),
    ...(page > 1
      ? [
          `  <link rel="prev" type="application/atom+xml" href="${SITE_URL + feedPathname(page - 1)}"/>`,
        ]
      : []),
    ...entries.map((entry, index) =>
      toEntryXml(entry, contents.get(entry.route) ?? '', dates[index]),
    ),
    '</feed>',
    '',
  ].join('\n');
}

function toEntryXml(page: SitePage, content: string, date: string): string {
  const { frontmatter, route } = page;
  const url = `${SITE_URL}${route}/`;
  const title =
    frontmatter.title ?? frontmatter.metaTitle ?? route.split('/').filter(Boolean).pop();

  return [
    '  <entry>',
    `    <title>${escapeXml(title ?? route)}</title>`,
    `    <id>${url}</id>`,
    `    <link rel="alternate" type="text/html" href="${url}"/>`,
    `    <published>${date}</published>`,
    `    <updated>${date}</updated>`,
    ...(frontmatter.kind ? [`    <category term="${escapeXml(frontmatter.kind)}"/>`] : []),
    ...(frontmatter.description
      ? [`    <summary>${escapeXml(frontmatter.description)}</summary>`]
      : []),
    `    <content type="html">${escapeXml(content)}</content>`,
    '  </entry>',
  ].join('\n');
}
