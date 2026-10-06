import fs from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';

// Single source of truth for the site's public origin. Used by robots.txt,
// sitemap.xml and the atom feeds.
export const SITE_URL = 'https://garobrik.ca';

// how the site titles itself when a page doesn't say otherwise (pages/+title.ts)
export const SITE_TITLE = "garo's noodle garden";

const PAGES_DIR = 'pages';

// Noodle pages live in this vike route group (see components/Noodles.tsx).
const NOODLE_GROUP = '(noodle)';

export type Frontmatter = {
  title?: string;
  metaTitle?: string;
  description?: string;
  kind?: string;
  draft?: boolean;
  publish?: 'listed' | 'unlisted';
  added?: string;
};

export type SitePage = {
  /** the page's module url, e.g. `/pages/(noodle)/hello-world/+Page.mdx` */
  module: string;
  /** public route, e.g. `/hello-world` */
  route: string;
  isNoodle: boolean;
  frontmatter: Frontmatter;
};

export type GeneratedFile = {
  /** the file's url path, e.g. `/sitemap.xml` */
  pathname: string;
  contentType: string;
  body: string;
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
      module: '/' + path.relative(root, file).split(path.sep).join('/'),
      route: routeForPageFile(file, pagesDir),
      isNoodle: relDir.split(path.sep)[0] === NOODLE_GROUP,
      frontmatter: parseFrontmatter(await fs.readFile(file, 'utf8')),
    });
  }

  return pages;
}
