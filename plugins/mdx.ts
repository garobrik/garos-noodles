import fsSync from 'fs';
import path from 'path';
import { compile } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import type { PluginOption } from 'vite';
import type { PluggableList, Plugin } from 'unified';
import type { Root, Text, Parent, Node } from 'mdast';
import { visitParents, EXIT } from 'unist-util-visit-parents';
import { createSlugger } from '../lib/slug.ts';

export type MDXOptions = {
  previewLength: number;
};

const remarkTruncate: Plugin<[MDXOptions?], Root> = (options = { previewLength: 300 }) => {
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

    // let consumers (components/Noodles.tsx) know whether they got a
    // cut-off preview or the whole noodle
    (tree as unknown as { children: LooseNode[] }).children.unshift(
      exportConstBoolean('truncated', truncated),
    );
  };
};

/* ------------------------------------------------------------------------
 * Images
 *
 * - markdown images (`![alt](./x.png)`) become ESM imports so vite picks the
 *   file up as an asset, like the hand-written `import x from './x.png'`
 *   style, and get `loading="lazy"` like every other image.
 * - JSX <img> tags get `loading="lazy"` unless the author asked for otherwise.
 * --------------------------------------------------------------------- */

// we hand-build a few mdx nodes here (import statements, <img> elements), and
// mdast's types don't model hand-built nodes well, so they live as loose shapes
// and only get cast when spliced into the tree
type LooseNode = { type: string; [key: string]: unknown };

type EstreeProgram = { type: 'Program'; sourceType: 'module'; body: LooseNode[] };

type MdxJsxAttribute = {
  type: 'mdxJsxAttribute';
  name: string;
  value:
    | string
    | { type: 'mdxJsxAttributeValueExpression'; value: string; data: { estree: EstreeProgram } };
};

type MdxJsxElement = {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string;
  attributes: MdxJsxAttribute[];
  children: LooseNode[];
};

type MdxjsEsmNode = {
  type: 'mdxjsEsm';
  value: string;
  data: { estree: EstreeProgram };
};

// urls vite (or the browser) handles for us: http(s), data:, mailto:, protocol-relative, in-page anchors
const isExternalUrl = (url: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);

// root-absolute urls point at public/ and work as-is
const isPublicUrl = (url: string) => url.startsWith('/');

// turn a content url into a module specifier vite can resolve relative to the file
const toModuleSpecifier = (url: string) => {
  const withoutHash = url.split('#')[0];
  return withoutHash.startsWith('.') ? withoutHash : './' + withoutHash;
};

const importDeclaration = (id: string, source: string): MdxjsEsmNode['data']['estree'] => ({
  type: 'Program',
  sourceType: 'module',
  body: [
    {
      type: 'ImportDeclaration',
      importKind: 'value',
      specifiers: [{ type: 'ImportDefaultSpecifier', local: { type: 'Identifier', name: id } }],
      source: { type: 'Literal', value: source, raw: JSON.stringify(source) },
    },
  ],
});

const identifierExpression = (id: string): EstreeProgram => ({
  type: 'Program',
  sourceType: 'module',
  body: [{ type: 'ExpressionStatement', expression: { type: 'Identifier', name: id } }],
});

const lazyAttribute: MdxJsxAttribute = { type: 'mdxJsxAttribute', name: 'loading', value: 'lazy' };

const hasAttribute = (element: MdxJsxElement, name: string) =>
  element.attributes.some((attribute) => attribute.name === name);

const ensureLazy = (element: MdxJsxElement) => {
  if (!hasAttribute(element, 'loading')) element.attributes.push({ ...lazyAttribute });
};

const remarkImages: Plugin<[string], Root> = (filePath) => (tree) => {
  const imports: MdxjsEsmNode[] = [];
  let counter = 0;

  // resolve a content url to a real file next to the mdx file
  const resolveAsset = (specifier: string) => {
    const file = specifier.split('?')[0];
    return path.resolve(path.dirname(filePath), file);
  };

  const isFile = (candidate: string) => {
    try {
      return fsSync.statSync(candidate).isFile();
    } catch {
      return false;
    }
  };

  // where possible turn a url into an asset import so vite bundles the file,
  // otherwise keep it as a plain url
  const srcAttribute = (url: string): MdxJsxAttribute => {
    const specifier = toModuleSpecifier(url);
    const id = `__mdxImageAsset${counter++}`;

    if (isFile(resolveAsset(specifier))) {
      const value = `import ${id} from ${JSON.stringify(specifier)};`;
      imports.push({ type: 'mdxjsEsm', value, data: { estree: importDeclaration(id, specifier) } });
      return {
        type: 'mdxJsxAttribute',
        name: 'src',
        value: {
          type: 'mdxJsxAttributeValueExpression',
          value: id,
          data: { estree: identifierExpression(id) },
        },
      };
    }

    console.warn(`\n[mdx] image not found, leaving url as-is: ${url} (in ${filePath})`);
    return { type: 'mdxJsxAttribute', name: 'src', value: url };
  };

  const srcFor = (url: string): MdxJsxAttribute =>
    isExternalUrl(url) || isPublicUrl(url)
      ? { type: 'mdxJsxAttribute', name: 'src', value: url }
      : srcAttribute(url);

  visitParents(tree, (node, ancestors) => {
    const loose = node as unknown as LooseNode;

    if (loose.type === 'mdxJsxFlowElement' || loose.type === 'mdxJsxTextElement') {
      const element = loose as unknown as MdxJsxElement;
      if (element.name !== 'img') return;
      ensureLazy(element);

      // hand written <img src="./x.png"> gets the same bundling as markdown images
      const index = element.attributes.findIndex(
        (attribute) => attribute.name === 'src' && typeof attribute.value === 'string',
      );
      const src = index === -1 ? undefined : element.attributes[index];
      if (src && typeof src.value === 'string') {
        element.attributes[index] = srcFor(src.value);
      }
      return;
    }

    if (node.type !== 'image') return;

    const image = node as unknown as { url: string; alt?: string | null; title?: string | null };
    const attributes: MdxJsxAttribute[] = [srcFor(image.url)];

    attributes.push({ type: 'mdxJsxAttribute', name: 'alt', value: image.alt ?? '' });
    if (image.title)
      attributes.push({ type: 'mdxJsxAttribute', name: 'title', value: image.title });
    attributes.push({ ...lazyAttribute });

    const replacement: LooseNode = {
      type: 'mdxJsxTextElement',
      name: 'img',
      attributes,
      children: [],
    };

    const parent = ancestors[ancestors.length - 1] as unknown as { children: LooseNode[] };
    const index = parent.children.indexOf(loose);
    if (index !== -1) parent.children[index] = replacement;
  });

  (tree.children as unknown as LooseNode[]).unshift(...(imports as unknown as LooseNode[]));
};

/* ------------------------------------------------------------------------
 * Heading anchors
 *
 * every heading gets a slug id and wraps its content in a self-link, so
 * headings are linkable (`#slug`) and anchor to themselves: hovering one
 * shows the familiar `#` and underlines it (styling lives in pages/style.css).
 * a heading that already contains a link can't wrap one around itself
 * (nested <a> is invalid), so it only gets the id and a trailing `#` link.
 * --------------------------------------------------------------------- */

const nodeText = (node: LooseNode): string => {
  if (typeof node.value === 'string' && (node.type === 'text' || node.type === 'inlineCode')) {
    return node.value;
  }
  return Array.isArray(node.children) ? node.children.map(nodeText).join('') : '';
};

const nodeHasLink = (node: LooseNode): boolean =>
  node.type === 'link' ||
  node.type === 'linkReference' ||
  (node.type === 'mdxJsxTextElement' && node.name === 'a') ||
  (Array.isArray(node.children) && node.children.some(nodeHasLink));

const anchorAttributes = (id: string, className: string, label?: string): MdxJsxAttribute[] => [
  { type: 'mdxJsxAttribute', name: 'href', value: `#${id}` },
  { type: 'mdxJsxAttribute', name: 'className', value: className },
  // only the bare `#` permalink needs a label; the self-link's text is the
  // heading text, and an aria-label here would leak into the heading's name
  ...(label ? [{ type: 'mdxJsxAttribute' as const, name: 'aria-label', value: label }] : []),
];

/* the `#` shown on hover — a real, aria-hidden node (css generated content
   would end up in the heading's accessible name) */
const hashMark = (): LooseNode => ({
  type: 'mdxJsxTextElement',
  name: 'span',
  attributes: [
    { type: 'mdxJsxAttribute', name: 'className', value: 'heading-hash' },
    { type: 'mdxJsxAttribute', name: 'aria-hidden', value: 'true' },
  ],
  children: [{ type: 'text', value: '#' }],
});

const remarkHeadingAnchors: Plugin<[], Root> = () => (tree) => {
  const slug = createSlugger();

  visitParents(tree, 'heading', (node) => {
    const heading = node as unknown as MdxJsxElement & { data?: Record<string, unknown> };
    const text = nodeText(heading as unknown as LooseNode);
    const id = slug(text);

    heading.data = { ...heading.data, hProperties: { id } };

    if (nodeHasLink(heading as unknown as LooseNode)) {
      heading.children.push({
        type: 'mdxJsxTextElement',
        name: 'a',
        attributes: anchorAttributes(id, 'heading-anchor', 'permalink'),
        children: [{ type: 'text', value: '#' }],
      });
      return;
    }

    heading.children = [
      {
        type: 'mdxJsxTextElement',
        name: 'a',
        attributes: anchorAttributes(id, 'heading-link'),
        children: [...heading.children, hashMark()],
      },
    ];
  });
};

/** `export const <name> = <value>;` as a hand-built mdx node */
const exportConstBoolean = (name: string, value: boolean): MdxjsEsmNode => ({
  type: 'mdxjsEsm',
  value: `export const ${name} = ${value};`,
  data: {
    estree: {
      type: 'Program',
      sourceType: 'module',
      body: [
        {
          type: 'ExportNamedDeclaration',
          exportKind: 'value',
          specifiers: [],
          source: null,
          declaration: {
            type: 'VariableDeclaration',
            kind: 'const',
            declarations: [
              {
                type: 'VariableDeclarator',
                id: { type: 'Identifier', name },
                init: { type: 'Literal', value, raw: String(value) },
              },
            ],
          },
        },
      ],
    },
  },
});

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
        [remarkImages, filepath],
      ];

      if (query === 'preview') {
        remarkPlugins.push([remarkTruncate, options]);
      }

      remarkPlugins.push(remarkHeadingAnchors);

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
