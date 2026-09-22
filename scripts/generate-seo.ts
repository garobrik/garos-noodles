import fs from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';

// Single source of truth for the site's public origin. Used by both
// robots.txt and sitemap.xml.
const SITE_URL = 'https://garobrik.ca';

const PAGES_DIR = path.join(process.cwd(), 'pages');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

// Noodle pages live in this vike route group (see components/Noodles.tsx).
const NOODLE_GROUP = '(noodle)';

type Frontmatter = {
  draft?: boolean;
  publish?: 'listed' | 'unlisted';
  added?: string;
};

type SitePage = {
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
//   pages/index/+Page.mdx                                  -> /
//   pages/about/+Page.mdx                                  -> /about
//   pages/(noodle)/hello-world/+Page.mdx                   -> /hello-world
//   pages/(noodle)/noodles/2025/12/12/gibson-measure/...   -> /noodles/2025/12/12/gibson-measure
function routeForPageFile(file: string): string {
  const relDir = path.relative(PAGES_DIR, path.dirname(file));
  const segments = relDir
    .split(path.sep)
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment));
  if (segments[segments.length - 1] === 'index') segments.pop();
  return '/' + segments.join('/');
}

function isPublished(page: SitePage): boolean {
  if (!page.isNoodle) return true;
  return page.frontmatter.draft !== true && page.frontmatter.publish === 'listed';
}

function toLastmod(added: string | undefined): string | undefined {
  if (!added || !/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(added)) return undefined;
  return added.replaceAll('/', '-');
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

async function main(): Promise<void> {
  const files = await findPageFiles(PAGES_DIR);

  const pages: SitePage[] = [];
  for (const file of files.sort()) {
    const relDir = path.relative(PAGES_DIR, path.dirname(file));
    // Anything under a `_`-prefixed directory (e.g. `_error`) isn't a public
    // page.
    if (relDir.split(path.sep).some((segment) => segment.startsWith('_'))) continue;
    pages.push({
      route: routeForPageFile(file),
      isNoodle: relDir.split(path.sep)[0] === NOODLE_GROUP,
      frontmatter: parseFrontmatter(await fs.readFile(file, 'utf8')),
    });
  }

  const publicPages = pages.filter(isPublished);
  const sitemap = toSitemapXml(publicPages);
  const robots = toRobotsTxt();

  await fs.writeFile(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap);
  await fs.writeFile(path.join(PUBLIC_DIR, 'robots.txt'), robots);

  console.log(
    `Wrote public/sitemap.xml (${publicPages.length} URLs) and public/robots.txt (${SITE_URL}).`,
  );
}

await main();
