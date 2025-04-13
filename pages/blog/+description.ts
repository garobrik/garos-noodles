import type { PageContext } from 'vike/types';

export default function title(pageContext: PageContext) {
  return pageContext.config.frontmatter?.title;
}
