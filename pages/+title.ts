import type { PageContext } from 'vike/types';

export default function title({ config }: PageContext) {
  return (
    config.frontmatter?.metaTitle ??
    config.frontmatter?.title ??
    `garo's noodle garden`
  );
}
