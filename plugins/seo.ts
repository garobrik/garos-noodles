import fs from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';
import type { PluginOption } from 'vite';

// Single source of truth for the site's public origin. Used by robots.txt,
// sitemap.xml and the atom feeds.
export const SITE_URL = 'https://garobrik.ca';

const PAGES_DIR = 'pages';

// Noodle pages live in this vike route group (see components/Noodles.tsx).
const NOODLE_GROUP = '(noodle)';

export type Frontmatter = {
  title?: string;
  metaTitle?: string;
  description?: string;
  draft?: boolean;
  publish?: 'listed' | 'unlisted';
  added?: string;
};

export type SitePage = {
  /** vike page id, e.g. `/pages/(noodle)/hello-world` */
  pageId: string;
  /** public route, e.g. `/hello-world` */
  route: string;
  isNoodle: boolean;
  frontmatter: Frontmatter;
};

async function findPageFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function traverse(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await traverse(fullPath);
      } else if (entry.isFile() && /^\+Page\.[a-z]+$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  await traverse(dir);
  return files;
}

function parseFrontmatter(source: string): Frontmatter {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return (parse(match[1]) as Frontmatter | null) ?? {};
}

// Maps a page file to its public route, e.g.:
//   pages/index/+Page.mdx                        -> /
//   pages/about/+Page.mdx                        -> /about
//   pages/(noodle)/hello-world/+Page.mdx         -> /hello-world
function routeForPageFile(file: string, pagesDir: string): string {
  const relDir = path.relative(pagesDir, path.dirname(file));
  const segments = relDir
    .split(path.sep)
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment));
  if (segments[segments.length - 1] === 'index') segments.pop();
  return '/' + segments.join('/');
}

export function isPublished(page: SitePage): boolean {
  if (!page.isNoodle) return true;
  return page.frontmatter.draft !== true && page.frontmatter.publish === 'listed';
}

export function toLastmod(added: string | undefined): string | undefined {
  if (!added || !/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(added)) return undefined;
  return added.replaceAll('/', '-');
}

export async function collectPages(root: string): Promise<SitePage[]> {
  const pagesDir = path.join(root, PAGES_DIR);
  const files = await findPageFiles(pagesDir);

  const pages: SitePage[] = [];
  for (const file of files.sort()) {
    const relDir = path.relative(pagesDir, path.dirname(file));
    // Anything under a `_`-prefixed directory (e.g. `_error`) isn't a public
    // page.
    if (relDir.split(path.sep).some((segment) => segment.startsWith('_'))) continue;
    pages.push({
      // the vike page id is the page's directory, prefixed with the pages dir
      pageId: `/${PAGES_DIR}/${relDir.split(path.sep).join('/')}`,
      route: routeForPageFile(file, pagesDir),
      isNoodle: relDir.split(path.sep)[0] === NOODLE_GROUP,
      frontmatter: parseFrontmatter(await fs.readFile(file, 'utf8')),
    });
  }

  return pages;
}

function toSitemapXml(pages: SitePage[]): string {
  const entries = pages
    .map((page) => ({
      // Prerendered pages are written as `<route>/index.html`, so URLs carry a
      // trailing slash (the root is just `/`).
      loc: page.route === '/' ? `${SITE_URL}/` : `${SITE_URL}${page.route}/`,
      lastmod: toLastmod(page.frontmatter.added),
    }))
    .sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0))
    .map(({ loc, lastmod }) =>
      [
        '  <url>',
        `    <loc>${loc}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        '  </url>',
      ].join('\n'),
    );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

function toRobotsTxt(): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n');
}

export type GeneratedFile = {
  /** the file's url path, e.g. `/sitemap.xml` */
  pathname: string;
  contentType: string;
  body: string;
};

export async function generateStaticFiles(root: string): Promise<GeneratedFile[]> {
  const publicPages = (await collectPages(root)).filter(isPublished);
  return [
    {
      pathname: '/robots.txt',
      contentType: 'text/plain; charset=utf-8',
      body: toRobotsTxt(),
    },
    {
      pathname: '/sitemap.xml',
      contentType: 'application/xml; charset=utf-8',
      body: toSitemapXml(publicPages),
    },
  ];
}

/**
 * Generates the site's static SEO files (robots.txt, sitemap.xml) as part of
 * vite's build: they end up in the client output next to the prerendered
 * pages. While `npm run dev` runs they're served straight from this plugin and
 * rebuilt on every request, so they track content edits without a restart.
 */
export function seo(): PluginOption {
  let root = process.cwd();

  return {
    name: 'seo',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const pathname = (req.url ?? '').split('?')[0];
          const file = (await generateStaticFiles(root)).find((f) => f.pathname === pathname);
          if (!file) return next();
          res.statusCode = 200;
          res.setHeader('Content-Type', file.contentType);
          res.end(file.body);
        } catch (error) {
          next(error as Error);
        }
      });
    },
    async closeBundle() {
      // these files belong to the static site, so only write them for the
      // client build (vite's builder also runs one for the server side)
      if (!this.environment || this.environment.config.build.ssr) return;

      const outDir = path.resolve(root, this.environment.config.build.outDir);
      for (const file of await generateStaticFiles(root)) {
        const target = path.join(outDir, file.pathname);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.body);
      }
    },
  };
}
