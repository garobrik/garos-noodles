import type { PageContext } from 'vike/types';

export default function description(pageContext: PageContext) {
  return pageContext.config.frontmatter?.description;
}
