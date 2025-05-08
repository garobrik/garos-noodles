import vikeReact from 'vike-react/config';
import type { Config } from 'vike/types';
import { Noodle } from '../components/Noodles';

export default {
  extends: vikeReact,
  prerender: true,
  meta: {
    Page: {
      env: { server: true, client: false },
    },
    frontmatter: {
      env: { server: true, client: false },
    },
  },
} satisfies Config;

declare global {
  namespace Vike {
    interface Config {
      frontmatter?: Noodle;
    }
  }
}
