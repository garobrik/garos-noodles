import { compile } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import type { PluginOption } from 'vite';
import type { PluggableList, Plugin } from 'unified';
import type { Root, Text, Parent, Node } from 'mdast';
import { visitParents, EXIT } from 'unist-util-visit-parents';

export type MDXOptions = {
  previewLength: number;
};

const remarkTruncate: Plugin<[MDXOptions?], Root> = (
  options = { previewLength: 300 },
) => {
  const maxChars = options.previewLength;
  return (tree: Node) => {
    let charCount = 0;
    let truncated = false;

    visitParents(tree, (node, ancestors) => {
      if (truncated) return EXIT;

      if (node.type === 'text') {
        const textNode = node as Text;
        const chars = textNode.value.length;

        if (charCount + chars > maxChars) {
          const remaining = maxChars - charCount;
          textNode.value = textNode.value.slice(0, remaining) + '...';
          truncated = true;

          // Remove all subsequent content by walking up the tree
          for (let i = ancestors.length - 1; i >= 0; i--) {
            const parent = ancestors[i] as Parent;
            const child = i === ancestors.length - 1 ? node : ancestors[i + 1];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const index = parent.children.indexOf(child as any);

            if (index !== -1) {
              parent.children = parent.children.slice(0, index + 1);
            }
          }

          return EXIT;
        }
        charCount += chars;
      }
    });
  };
};

export function mdx(options: MDXOptions): PluginOption {
  let development = false;

  return {
    name: 'mdx',
    enforce: 'pre',
    config(_, env) {
      development = env.mode === 'development';
    },
    async transform(code, path) {
      // Only handle .mdx files
      const [filepath, query] = path.split('?');
      if (!filepath.endsWith('.mdx')) return null;

      const remarkPlugins: PluggableList = [
        remarkFrontmatter,
        remarkMdxFrontmatter,
      ];

      if (query === 'preview') {
        remarkPlugins.push([remarkTruncate, options]);
      }

      const compiled = await compile(code, {
        remarkPlugins,
        development,
      });

      return {
        code: String(compiled),
        map: null,
      };
    },
  };
}
