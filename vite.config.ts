import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import vike from 'vike/plugin';
import { mdx } from './plugins/mdx.ts';
import { seo } from './plugins/seo.ts';

export default defineConfig({
  plugins: [
    seo(),
    vike({}),
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
