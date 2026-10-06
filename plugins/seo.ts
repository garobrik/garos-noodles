import fs from 'fs/promises';
import path from 'path';
import type { PluginOption } from 'vite';
import {
  createContentRenderer,
  generateFeedFiles,
  renderModule,
  withBuildLoadModule,
  type ContentRenderer,
} from './feed.ts';
import {
  collectPages,
  isPublished,
  toLastmod,
  SITE_URL,
  type GeneratedFile,
  type SitePage,
} from './site.ts';

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

export async function generateStaticFiles(
  root: string,
  renderContent: ContentRenderer,
): Promise<GeneratedFile[]> {
  const pages = await collectPages(root);
  const publicPages = pages.filter(isPublished);

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
    ...(await generateFeedFiles(pages, renderContent)),
  ];
}

/**
 * Generates the site's static SEO files (robots.txt, sitemap.xml, atom feeds)
 * as part of vite's build: they end up in the client output next to the
 * prerendered pages. While `npm run dev` runs they're served straight from
 * this plugin and rebuilt on every request, so they track content edits
 * without a restart.
 */
export function seo(): PluginOption {
  let root = process.cwd();
  // where the static site ends up (the client build's output dir)
  let clientOutDir = '';
  // built asset urls keyed by the source urls modules turn them into,
  // e.g. `/pages/(noodle)/hello-world/x.png` -> `/assets/static/x.B123.png`
  let builtAssetUrls = new Map<string, string>();

  const toPublicUrl = (url: string) =>
    builtAssetUrls.get(url) ?? builtAssetUrls.get(decodeURIComponent(url)) ?? url;

  return [
    renderModule(),
    {
      name: 'seo',
      configResolved(config) {
        root = config.root;
        clientOutDir = path.resolve(root, (config.environments?.client ?? config).build.outDir);
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          try {
            const pathname = (req.url ?? '').split('?')[0];
            const renderContent = await createContentRenderer(
              (id) => server.ssrLoadModule(id),
              toPublicUrl,
            );
            const file = (await generateStaticFiles(root, renderContent)).find(
              (f) => f.pathname === pathname,
            );
            if (!file) return next();
            res.statusCode = 200;
            res.setHeader('Content-Type', file.contentType);
            res.end(file.body);
          } catch (error) {
            next(error as Error);
          }
        });
      },
      writeBundle(_options, bundle) {
        // The pages' assets are emitted by the server build (vike moves them
        // into the client output afterwards), so that's where we learn which
        // hashed url each one ended up at.
        if (!this.environment?.config.build.ssr) return;
        for (const item of Object.values(bundle)) {
          if (item.type !== 'asset') continue;
          for (const original of item.originalFileNames) {
            builtAssetUrls.set('/' + original, '/' + item.fileName);
          }
        }
      },
      async closeBundle() {
        // generate once both builds are done: the feeds render the pages'
        // modules and need the asset urls collected along the way
        if (!this.environment?.config.build.ssr) return;

        const files = await withBuildLoadModule(root, async (loadModule) =>
          generateStaticFiles(root, await createContentRenderer(loadModule, toPublicUrl)),
        );

        for (const file of files) {
          const target = path.join(clientOutDir, file.pathname);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, file.body);
        }
      },
    },
  ];
}
