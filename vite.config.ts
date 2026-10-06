import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import vike from 'vike/plugin';
import { fonts } from './plugins/fonts.ts';
import { mdx } from './plugins/mdx.ts';
import { responsiveImages } from './plugins/responsive-images.ts';
import { seo } from './plugins/seo.ts';

export default defineConfig({
  plugins: [
    seo(),
    vike({}),
    fonts(),
    responsiveImages({
      // squoosh-style: no resize (the browser scales, same as the original
      // png/jpg), webp quality 75 at encoder effort 4. Add `maxDimension` to
      // emit a downscaled ladder instead.
      // sizes: the rendered slot (pages/+Layout.tsx column: max-w-[45rem] =
      // 720px, minus its px-4 padding = 688px)
      sizes: '(max-width: 45rem) calc(100vw - 2rem), 43rem',
      quality: 75,
      effort: 4,
      // flip to true to compare against true lossless webp; `quality` only
      // tunes lossy compression, 100 is NOT lossless
      lossless: false,
    }),
    mdx({ previewLength: 1000 }),
    react({ include: /\.(jsx|js|mdx|md|tsx|ts)$/ }),
    tailwindcss(),
  ],
  build: {
    target: 'es2022',
  },
  server: {
    host: true,
  },
});
