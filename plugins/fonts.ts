// Font subsetting as part of the vite lifecycle.
//
// Walks the source tree (mdx/md via remark, tsx via esbuild+acorn) to compute
// which typography styles are used and which characters are rendered in each
// style, then generates one static woff2 subset per style with `subset-font`
// (HarfBuzz WASM — no python, no standalone scripts). Variable axes are pinned
// per style (wght/SOFT/WONK/opsz) so each output is a small static instance.
//
// Wiring:
//   - dev:  fonts served from memory at /fonts/generated/*.woff2; editing any
//           content/component/style file regenerates them (HMR + full reload)
//   - build: subsets are emitted as assets at /fonts/generated/*.woff2
//   - `virtual:font-manifest` exposes the @font-face css + per-page preload
//     list to +Head.tsx (inline in the head — no css module to invalidate)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdx from 'remark-mdx';
import { parse as parseYaml } from 'yaml';
import { parse as parseJs } from 'acorn';
import { transformSync } from 'esbuild';
import subsetFont from 'subset-font';

// ---------------------------------------------------------------------------
// Style model
// ---------------------------------------------------------------------------

type Family = 'fraunces' | 'literata';

type Tokens = {
  family: Family;
  italic: boolean;
  weight: number;
  soft: boolean;
};

// Tailwind class -> token deltas. The family/weight names here mirror the
// @theme tokens in pages/style.css.
const CLASS_TOKENS: Record<string, Partial<Tokens>> = {
  'font-serif': { family: 'fraunces' },
  'font-body': { family: 'literata' },
  italic: { italic: true },
  'font-light': { weight: 300 },
  'font-medium': { weight: 500 },
  'font-semibold': { weight: 600 },
  'font-bold': { weight: 700 },
  'font-soft': { soft: true },
  // bold `#` permalink marks (pages/style.css .heading-hash/.heading-anchor)
  'heading-hash': { weight: 700 },
  'heading-anchor': { weight: 700 },
};

// Hardcoded relationship between yaml frontmatter fields and the styles they
// render in (see components/Noodles.tsx and pages/(noodle)/+Layout.tsx).
// Frontmatter only contributes *characters* to a style's charset: the combos
// for preloading are attributed to the components that actually render the
// fields (their <h1>/className signals), not to the page the data came from.
const FRONTMATTER_STYLES: Record<string, { tokens: Partial<Tokens>; transform?: (v: string) => string }> = {
  // <h1>{noodle.title}</h1>
  title: { tokens: { family: 'fraunces', weight: 500 } },
  metaTitle: { tokens: { family: 'fraunces', weight: 500 } },
  // <Link className="italic ... font-serif font-soft">{noodle.added.replaceAll('/', '.')}</Link>
  added: {
    tokens: { family: 'fraunces', italic: true, weight: 400, soft: true },
    transform: (v) => v.replaceAll('/', '.'),
  },
  description: { tokens: { family: 'literata', weight: 400 } },
};

const FAMILY_NAME: Record<Family, string> = {
  fraunces: 'Fraunces Variable',
  literata: 'Literata Variable',
};

const MASTERS: Record<Family, { normal: string; italic: string }> = {
  fraunces: {
    normal: 'fraunces-latin-full-normal.woff2',
    italic: 'fraunces-latin-full-italic.woff2',
  },
  literata: {
    normal: 'literata-latin-opsz-normal.woff2',
    // No italic master ships for Literata: <em> gets a synthesized oblique of
    // the regular face, so italic text keeps contributing to the regular subset.
    italic: 'literata-latin-opsz-normal.woff2',
  },
};

// opsz pinned near each style's rendered size, so pinning wght/SOFT/WONK keeps
// the optical sizing the variable font would have applied.
const OPSZ: Record<Family, (weight: number) => number> = {
  fraunces: (w) => ({ 300: 20, 400: 18, 500: 28, 600: 24 })[w] ?? 24,
  literata: () => 16,
};

function styleKey(t: Tokens): string {
  const soft = t.soft && t.family === 'fraunces';
  const italic = t.italic && t.family === 'fraunces';
  return `${t.family}${italic ? '-italic' : ''}-${t.weight}${soft ? '-soft' : ''}`;
}

function faceAxes(t: Tokens): Record<string, number> {
  if (t.family === 'fraunces') {
    return {
      wght: t.weight,
      SOFT: t.soft ? 100 : 0,
      WONK: 1,
      opsz: OPSZ.fraunces(t.weight),
    };
  }
  return { wght: t.weight, opsz: OPSZ.literata(t.weight) };
}

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

type AstNode = {
  type: string;
  value?: string;
  depth?: number;
  name?: string;
  children?: AstNode[];
  attributes?: AstNode[];
  [k: string]: unknown;
};

type Face = {
  key: string;
  family: Family;
  fontStyle: 'normal' | 'italic';
  weight: number;
  axes: Record<string, number>;
  chars: Set<string>;
};

type ScanState = {
  elementRules: Map<string, Partial<Tokens>>;
  baseTokens: Tokens;
  faces: Map<string, Face>;
  fileCombos: Set<string>;
};

function faceFor(state: ScanState, tokens: Tokens, recordCombo = true): Face {
  const key = styleKey(tokens);
  let face = state.faces.get(key);
  if (!face) {
    face = {
      key,
      family: tokens.family,
      fontStyle: tokens.italic && tokens.family === 'fraunces' ? 'italic' : 'normal',
      weight: tokens.weight,
      axes: faceAxes(tokens),
      chars: new Set(),
    };
    state.faces.set(key, face);
  }
  if (recordCombo) state.fileCombos.add(key);
  return face;
}

function addText(state: ScanState, tokens: Tokens, text: string, recordCombo = true): void {
  if (!/\S/.test(text)) return;
  const face = faceFor(state, tokens, recordCombo);
  for (const ch of text) if (!/\s/.test(ch)) face.chars.add(ch);
}

function mergeTokens(base: Tokens, ...deltas: (Partial<Tokens> | undefined)[]): Tokens {
  const out: Tokens = { ...base };
  for (const d of deltas) {
    if (!d) continue;
    if (d.family) out.family = d.family;
    if (d.italic !== undefined) out.italic = d.italic;
    if (d.weight) out.weight = d.weight;
    if (d.soft !== undefined) out.soft = d.soft;
  }
  return out;
}

// Class names from an arbitrary expression subtree (string literals, template
// literal quasis) -> token deltas.
function classNameTokens(expr: unknown): Partial<Tokens> {
  let tokens: Partial<Tokens> = {};
  const strings: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === 'string') {
      strings.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as AstNode;
    if (n.type === 'Literal' && typeof n.value === 'string') strings.push(n.value);
    if (n.type === 'TemplateElement') strings.push(String((n.value as { raw?: string })?.raw ?? ''));
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'value') continue;
      collect(v);
    }
  };
  collect(expr);
  for (const s of strings) {
    for (const cls of s.split(/\s+/)) {
      if (CLASS_TOKENS[cls]) tokens = { ...tokens, ...CLASS_TOKENS[cls] };
    }
  }
  return tokens;
}

function classNameFromAttributes(attributes: AstNode[] | undefined): Partial<Tokens> {
  let tokens: Partial<Tokens> = {};
  for (const attr of attributes ?? []) {
    if (attr.type !== 'mdxJsxAttribute' && attr.type !== 'JSXAttribute') continue;
    if (attr.name !== 'className' && attr.name !== 'class') continue;
    tokens = { ...tokens, ...classNameTokens(attr.value) };
  }
  return tokens;
}

// ---- mdx / md (remark) ----------------------------------------------------

const mdxParser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkMdx);

function scanMdx(state: ScanState, source: string): void {
  const tree = mdxParser.parse(source) as unknown as AstNode;

  const walk = (node: AstNode, tokens: Tokens): void => {
    switch (node.type) {
      case 'yaml': {
        let fm: Record<string, unknown> = {};
        try {
          fm = (parseYaml(node.value ?? '') ?? {}) as Record<string, unknown>;
        } catch {
          return;
        }
        for (const [field, raw] of Object.entries(fm)) {
          const spec = FRONTMATTER_STYLES[field];
          if (!spec || raw == null) continue;
          const v = String(raw instanceof Date ? raw.toISOString().slice(0, 10) : raw);
          addText(state, mergeTokens(tokens, spec.tokens), spec.transform ? spec.transform(v) : v, false);
        }
        return;
      }
      case 'heading': {
        const tag = (node.depth ?? 1) === 1 ? 'h1' : (node.depth ?? 1) === 2 ? 'h2' : 'h3';
        const child = mergeTokens(tokens, state.elementRules.get(tag));
        faceFor(state, child);
        for (const c of node.children ?? []) walk(c, child);
        return;
      }
      case 'emphasis': {
        const child = mergeTokens(tokens, { italic: true });
        faceFor(state, child);
        for (const c of node.children ?? []) walk(c, child);
        return;
      }
      case 'strong': {
        const child = mergeTokens(tokens, { weight: 700 });
        faceFor(state, child);
        for (const c of node.children ?? []) walk(c, child);
        return;
      }
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        const isElement = /^[a-z][a-z0-9]*$/.test(node.name ?? '');
        const child = mergeTokens(
          tokens,
          isElement ? state.elementRules.get(node.name ?? '') : undefined,
          classNameFromAttributes(node.attributes),
        );
        faceFor(state, child);
        for (const c of node.children ?? []) walk(c, child);
        return;
      }
      case 'text':
      case 'inlineCode':
      case 'code':
        addText(state, tokens, node.value ?? '');
        return;
      default:
        for (const c of node.children ?? []) walk(c, tokens);
    }
  };

  walk(tree, state.baseTokens);
}

// ---- tsx (esbuild type-strip + acorn) -------------------------------------

function scanTsx(state: ScanState, source: string): void {
  const js = transformSync(source, {
    loader: 'tsx',
    jsx: 'transform',
    jsxFactory: '__sx',
    jsxFragment: '__sx',
    sourcefile: 'file.tsx',
  }).code;
  const ast = parseJs(js, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as AstNode;

  const walk = (node: AstNode, tokens: Tokens): void => {
    if (node.type === 'CallExpression') {
      const callee = node.callee as AstNode | undefined;
      const args = (node.arguments as AstNode[] | undefined) ?? [];
      if (callee?.type === 'Identifier' && callee.name === '__sx' && args.length > 0) {
        const tag = args[0];
        const isElement = tag?.type === 'Literal' && /^[a-z][a-z0-9]*$/.test(String(tag.value));
        const child = mergeTokens(
          tokens,
          isElement ? state.elementRules.get(String(tag.value)) : undefined,
          classNameFromAttributes(
            args[1]?.type === 'ObjectExpression'
              ? ((args[1].properties as AstNode[] | undefined) ?? []).map((p) => ({
                  type: 'JSXAttribute',
                  name: String((p.key as AstNode | undefined)?.name ?? (p.key as AstNode | undefined)?.value ?? ''),
                  value: p.value,
                }))
              : undefined,
          ),
        );
        faceFor(state, child);
        for (const arg of args.slice(2)) {
          if (arg.type === 'Literal' && typeof arg.value === 'string') addText(state, child, arg.value);
          else walk(arg, child);
        }
        return;
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') continue;
      if (Array.isArray(v)) v.forEach((c) => walk(c as AstNode, tokens));
      else if (v && typeof v === 'object' && (v as AstNode).type) walk(v as AstNode, tokens);
    }
  };

  walk(ast, state.baseTokens);
}

// ---------------------------------------------------------------------------
// Element rules + base tokens from pages/style.css
// ---------------------------------------------------------------------------

// Split a selector list on top-level commas only: commas nested in functional
// pseudo-classes (`:is(h1, h2)`) do not separate selectors, and mangling those
// into bare `h2`/`h3` pieces would leak one rule's tokens into element rules.
function splitSelectors(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseStyleCss(css: string): { baseTokens: Tokens; elementRules: Map<string, Partial<Tokens>> } {
  const elementRules = new Map<string, Partial<Tokens>>();
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(blockRe)) {
    const selector = (m[1].split(/[{};]/).pop() ?? '').trim();
    const body = m[2];
    const apply = body.match(/@apply\s+([^;]+);/);
    if (!apply) continue;
    let ruleTokens: Partial<Tokens> = {};
    for (const cls of apply[1].split(/\s+/)) {
      if (CLASS_TOKENS[cls]) ruleTokens = { ...ruleTokens, ...CLASS_TOKENS[cls] };
    }
    for (const sel of splitSelectors(selector)) {
      const name = sel.trim();
      if (/^[a-z][a-z0-9]*$/.test(name) && Object.keys(ruleTokens).length > 0) {
        elementRules.set(name, { ...elementRules.get(name), ...ruleTokens });
      }
    }
  }
  // html rule (or defaults) establishes the base text style
  const baseTokens = mergeTokens(
    { family: 'literata', italic: false, weight: 400, soft: false },
    elementRules.get('html'),
    elementRules.get('body'),
  );
  return { baseTokens, elementRules };
}

// ---------------------------------------------------------------------------
// Inventory: per-page combos via layout chain + import closure
// ---------------------------------------------------------------------------

const SOURCE_DIRS = ['pages', 'components'];
const EXTENSIONS = ['', '.tsx', '.ts', '.mdx', '.md'];

function discoverSources(root: string): string[] {
  const out: string[] = [];
  const walkDir = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(p);
      else if (/\.(mdx|md|tsx)$/.test(entry.name)) out.push(p);
    }
  };
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs)) walkDir(abs);
  }
  return out.sort();
}

function importClosure(root: string, entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let source = '';
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(file), m[1]);
      for (const ext of EXTENSIONS) {
        const candidate = base + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          if (/\.(mdx|md|tsx)$/.test(candidate)) queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...seen];
}

function layoutChain(root: string, pageFile: string): string[] {
  const layouts: string[] = [];
  let dir = path.dirname(pageFile);
  const pagesRoot = path.join(root, 'pages');
  while (dir.startsWith(pagesRoot)) {
    const layout = path.join(dir, '+Layout.tsx');
    if (fs.existsSync(layout)) layouts.push(layout);
    if (dir === pagesRoot) break;
    dir = path.dirname(dir);
  }
  return layouts;
}

// 'pages/(noodle)/hello-world/+Page.mdx' -> 'pages/(noodle)/hello-world'
function canonicalPageKey(file: string, root: string): string {
  return path
    .relative(root, file)
    .replace(/\\/g, '/')
    .replace(/\.(mdx|md|tsx)$/, '')
    .replace(/\/\+Page$/, '');
}

// ---------------------------------------------------------------------------
// State build
// ---------------------------------------------------------------------------

const FONT_URL_PREFIX = '/fonts/generated/';
const MANIFEST_ID = '\0virtual:font-manifest';
const MANIFEST_REQUEST = 'virtual:font-manifest';
const STYLE_CSS = 'pages/style.css';

type GeneratedFace = Face & { name: string; href: string };

type FontState = {
  faces: GeneratedFace[];
  buffers: Map<string, Buffer>;
  css: string;
  pages: Record<string, string[]>;
};

async function buildState(root: string): Promise<FontState> {
  const styleCssPath = path.join(root, STYLE_CSS);
  const styleCss = fs.readFileSync(styleCssPath, 'utf8');
  const { baseTokens, elementRules } = parseStyleCss(styleCss);

  const sources = discoverSources(root);
  const combosByFile = new Map<string, Set<string>>();
  const faces = new Map<string, Face>();

  for (const file of sources) {
    const state: ScanState = {
      elementRules,
      baseTokens,
      faces,
      fileCombos: new Set<string>(),
    };
    const source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.tsx')) scanTsx(state, source);
    else scanMdx(state, source);
    combosByFile.set(path.relative(root, file).replace(/\\/g, '/'), state.fileCombos);
  }

  // Generate one static subset per style that actually renders some text.
  const generated: GeneratedFace[] = [];
  const buffers = new Map<string, Buffer>();
  for (const face of [...faces.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (face.chars.size === 0) continue;
    const master = MASTERS[face.family][face.fontStyle];
    const charset = [...face.chars].sort().join('');
    const hash = crypto
      .createHash('sha1')
      .update(`${master}:${JSON.stringify(face.axes)}:${charset}`)
      .digest('hex')
      .slice(0, 8);
    const name = `${face.key}-${hash}.woff2`;
    const bytes = await subsetFont(fs.readFileSync(path.join(root, 'public/fonts', master)), charset, {
      targetFormat: 'woff2',
      variationAxes: face.axes,
    });
    buffers.set(name, bytes);
    generated.push({ ...face, name, href: FONT_URL_PREFIX + name });
  }

  // @font-face rules, inlined in <head> by +Head.tsx.
  const css = generated.map(
      (f) => `@font-face {
  font-family: '${FAMILY_NAME[f.family]}';
  font-style: ${f.fontStyle};
  font-weight: ${f.weight};
  font-display: swap;
  src: url('${f.href}') format('woff2');
}`,
    )
    .join('\n');

  // Per-page preload list: the page's own styles plus everything reachable
  // through its layout chain and local imports.
  const pages: Record<string, string[]> = {};
  for (const file of sources) {
    if (!/\/\+Page\.(mdx|md|tsx)$/.test(file)) continue;
    const key = canonicalPageKey(file, root);
    const comboSet = new Set<string>(combosByFile.get(path.relative(root, file).replace(/\\/g, '/')) ?? []);
    for (const related of importClosure(root, file).concat(layoutChain(root, file))) {
      for (const combo of combosByFile.get(path.relative(root, related).replace(/\\/g, '/')) ?? []) {
        comboSet.add(combo);
      }
    }
    // html/base text style is on every page
    comboSet.add(styleKey(baseTokens));
    pages[key] = generated
      .filter((f) => comboSet.has(f.key))
      .map((f) => f.name)
      .sort();
  }

  return { faces: generated, buffers, css, pages };
}

function manifestSource(state: FontState): string {
  const faces = state.faces.map((f) => ({
    name: f.name,
    href: f.href,
    family: FAMILY_NAME[f.family],
    style: f.fontStyle,
    weight: f.weight,
  }));
  return `const faces = ${JSON.stringify(faces)};
const byName = Object.fromEntries(faces.map((f) => [f.name, f]));
const pages = ${JSON.stringify(state.pages)};
export const fontFaceCss = ${JSON.stringify(state.css)};

function normalize(pageId) {
  return (pageId || '')
    .replace(/^\\//, '')
    .replace(/\\.(mdx|md|tsx)$/, '')
    .replace(/\\/\\+Page$/, '');
}

export function fontsForPage(pageId) {
  const names = pages[normalize(pageId)];
  return (names ?? faces.map((f) => f.name)).map((n) => byName[n]).filter(Boolean);
}

export default { faces, pages };
`;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function isTracked(root: string, file: string): boolean {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  return (
    rel.startsWith('pages/') ||
    rel.startsWith('components/') ||
    rel.startsWith('public/fonts/') ||
    rel === STYLE_CSS ||
    rel === 'plugins/fonts.ts'
  );
}

export function fonts(): Plugin {
  let root = process.cwd();
  let isSsrBuild = false;
  let building: Promise<FontState> | null = null;
  let state: FontState | null = null;

  const ensure = (): Promise<FontState> => {
    if (!building) {
      building = buildState(root).then((s) => {
        state = s;
        return s;
      });
    }
    return building;
  };

  return {
    name: 'font-subsets',
    enforce: 'pre',

    configResolved(config: ResolvedConfig) {
      root = config.root;
      isSsrBuild = !!config.build.ssr;
    },

    buildStart() {
      this.addWatchFile(path.join(root, 'public/fonts'));
      return ensure().then(() => undefined);
    },

    resolveId(id) {
      return id === MANIFEST_REQUEST ? MANIFEST_ID : null;
    },

    async load(id) {
      if (id !== MANIFEST_ID) return null;
      const s = await ensure();
      return manifestSource(s);
    },

    generateBundle() {
      if (isSsrBuild || !state) return;
      for (const [name, bytes] of state.buffers) {
        this.emitFile({ type: 'asset', fileName: `fonts/generated/${name}`, source: bytes });
      }
    },

    configureServer(server) {
      const refresh = async () => {
        building = null;
        const next = await ensure();
        const manifest = server.moduleGraph.getModuleById(MANIFEST_ID);
        if (manifest) server.moduleGraph.invalidateModule(manifest);
        return next;
      };

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith(FONT_URL_PREFIX)) return next();
        const s = await ensure();
        const bytes = s.buffers.get(path.basename(url));
        if (!bytes) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('content-type', 'font/woff2');
        res.setHeader('cache-control', 'no-store');
        res.end(bytes);
      });

      const onChange = (file: string) => {
        if (!isTracked(root, file)) return;
        void refresh().then(() => server.ws.send({ type: 'full-reload' }));
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },

    async handleHotUpdate({ file, server }) {
      if (!isTracked(root, file)) return;
      building = null;
      await ensure();
      const manifest = server.moduleGraph.getModuleById(MANIFEST_ID);
      if (manifest) server.moduleGraph.invalidateModule(manifest);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
