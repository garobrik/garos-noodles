import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import vike from 'vike/plugin';
import { mdx } from './plugins/mdx';

export default defineConfig({
  plugins: [
    vike({}),
    mdx({ previewLength: 1000 }),
    react({ include: /\.(jsx|js|mdx|md|tsx|ts)$/ }),
    tailwindcss(),
  ],
  build: {
    target: 'es2022',
  },
});
