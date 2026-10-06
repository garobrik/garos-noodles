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
      // pages/+Layout.tsx renders content in a `max-w-[45rem]` column: 720px.
      // Build renditions never exceed that in either dimension.
      maxDimension: 720,
      // the rendered slot: full viewport minus the column padding, up to the
      // 688px inner width of the column
      sizes: '(max-width: 45rem) calc(100vw - 2rem), 43rem',
      quality: 80,
      // flip to true to compare against true lossless webp (~4.5x bigger);
      // `quality` only tunes lossy compression, 100 is NOT lossless
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
