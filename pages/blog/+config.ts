import type { Config } from 'vike/types';

export default {
  meta: {
    frontmatter: {
      env: { server: true, client: false },
    },
  },
} satisfies Config;

declare global {
  namespace Vike {
    interface Config {
      frontmatter?: {
        title?: string;
        description?: string;
      };
    }
  }
}
