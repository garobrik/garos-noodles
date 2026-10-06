import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Plugin } from 'vite';

/**
 * Images that get the responsive webp treatment in the build pipeline. Other
 * asset types (gif, svg, ...) keep going through vite's plain asset handling.
 */
export const RESPONSIVE_IMAGE_RE = /\.(png|jpe?g)$/i;

export type ResponsiveImagesOptions = {
  /**
   * Cap for the largest dimension of every rendition, in CSS px. The build
   * pipeline never emits anything bigger than this, in either dimension.
   */
  maxDimension: number;
  /** WebP quality for lossy encoding; ignored when `lossless` is set. */
  quality: number;
  /**
   * Encode true lossless WebP instead of lossy — pixel-identical to the
   * resized rendition, notably bigger. (`quality: 100` is still lossy; this is
   * the switch that actually compares lossy vs lossless.)
   */
  lossless?: boolean;
  /**
   * Rendition ladder as descending fractions of `maxDimension`, applied to the
   * image's largest dimension. Sources smaller than a step are never enlarged,
   * and duplicate renditions collapse into one.
   */
  ladder?: number[];
  /** Value for the emitted `sizes` attribute; describes the rendered slot. */
  sizes: string;
};

type Rendition = { url: string; width: number; height: number };

const moduleFor = ({
  src,
  srcset,
  sizes,
  width,
  height,
}: {
  src: string;
  srcset: string;
  sizes: string;
  width?: number;
  height?: number;
}) => `export default ${JSON.stringify(src)};
export const srcset = ${JSON.stringify(srcset)};
export const sizes = ${JSON.stringify(sizes)};
export const width = ${width ?? 'undefined'};
export const height = ${height ?? 'undefined'};
`;

// The plugin instance that serves the build's prerender (ssr) pass is the only
// one that ever sees image modules — vike prerenders the pages and the client
// bundle is just a hydration shell — so the static output directory is shared
// between instances instead of being read from any single resolved config.
const outputState: { root: string; staticDir: string } = {
  root: process.cwd(),
  staticDir: 'dist/client',
};

/**
 * Build-pipeline-only image handling: every png/jpg import resolves to a
 * module whose default export is the url of the largest rendition and whose
 * named exports carry a webp `srcset`/`sizes` (plus intrinsic `width`/`height`)
 * for responsive <img> tags.
 *
 * In dev the original file is served untouched (same module shape), so the
 * responsive wiring only ever changes the final build.
 */
export const responsiveImages = ({
  maxDimension,
  quality,
  lossless = false,
  ladder = [1, 2 / 3, 1 / 3],
  sizes,
}: ResponsiveImagesOptions): Plugin => {
  let root = process.cwd();
  let base = '/';
  let dev = true;

  // renditions are written straight to the static output directory: page
  // content is prerendered and its module code only carries url strings, so
  // the bundler's asset pipeline never sees (and would drop) these files
  const written = new Set<string>();

  const writeRendition = async (fileName: string, data: Buffer) => {
    if (written.has(fileName)) return;
    written.add(fileName);
    const target = path.join(outputState.root, outputState.staticDir, fileName);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  };

  return {
    name: 'responsive-images',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      base = config.base;
      dev = config.command === 'serve';
      outputState.root = config.root;
      // vike writes the static site to dist/client (and the discarded server
      // bundle to dist/server); anything under dist/ itself is auxiliary
      if (config.build.outDir.endsWith('client')) outputState.staticDir = config.build.outDir;
    },

    async load(id) {
      const file = id.split('?')[0];
      if (!RESPONSIVE_IMAGE_RE.test(file)) return;

      if (dev) {
        const url = encodeURI(
          path.posix.join(base, path.relative(root, file).split(path.sep).join('/')),
        );
        const meta = await sharp(file).metadata();
        return moduleFor({ src: url, srcset: url, sizes, width: meta.width, height: meta.height });
      }

      const source = await fs.readFile(file);
      const name = path.basename(file).replace(/\.[^.]+$/, '');

      const byWidth = new Map<number, Rendition>();
      for (const fraction of ladder) {
        const target = Math.round(maxDimension * fraction);
        const data = await sharp(source)
          .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true })
          .webp({ quality, lossless })
          .toBuffer();
        const meta = await sharp(data).metadata();
        const width = meta.width ?? target;
        if (byWidth.has(width)) continue;

        const fileName = `assets/${name}-${width}w-${createHash('sha256')
          .update(data)
          .digest('hex')
          .slice(0, 8)}.webp`;
        await writeRendition(fileName, data);
        byWidth.set(width, {
          url: path.posix.join(base, fileName),
          width,
          height: meta.height ?? 0,
        });
      }

      const renditions = [...byWidth.values()].sort((a, b) => b.width - a.width);
      const [largest] = renditions;

      return moduleFor({
        src: largest.url,
        srcset: renditions.map(({ url, width }) => `${url} ${width}w`).join(', '),
        sizes,
        width: largest.width,
        height: largest.height,
      });
    },
  };
};
