import vikeReact from 'vike-react/config';
import type { Config } from 'vike/types';
import Layout from '../layouts/LayoutDefault.js';

export default {
  Layout,
  title: `garo brik`,
  extends: vikeReact,
  prerender: true,
  meta: {
    Page: {
      env: { server: true, client: false },
    },
  },
} satisfies Config;
