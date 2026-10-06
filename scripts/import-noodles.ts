import fs from 'fs/promises';
import fsSync, { watch } from 'fs';
import path from 'path';

const NOODLE_DIR = path.join(process.cwd(), 'pages/(noodle)');

// text files worth rewriting references in (an svg can nest images, a module
// can reference images, ...), as opposed to binary blobs we just copy
const SCANNABLE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.svg',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
]);

type RefKind = 'import' | 'image' | 'link' | 'src' | 'href';

type Ref = {
  /** the url exactly as it appears in the file */
  url: string;
  kind: RefKind;
};

// how a url shows up in a file: `import x from '...'`, `![...](...)`, `[...](...)`,
// `src="..."`, `href="..."`, and css `url(...)`
const REF_PATTERNS: Array<[RegExp, RefKind]> = [
  [/\bfrom\s*['"]([^'"]+)['"]/g, 'import'],
  [/\bimport\s*['"]([^'"]+)['"]/g, 'import'],
  [/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, 'image'],
  [/(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, 'link'],
  [/^\s*\[[^\]]+\]:\s*<?([^>\s]+)>?/gm, 'link'],
  [/\bsrc\s*=\s*['"]([^'"]+)['"]/g, 'src'],
  [/\bhref\s*=\s*['"]([^'"]+)['"]/g, 'href'],
  [/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, 'src'],
];

// anything that isn't a url we can fetch or jump to
const isLocalRef = (url: string) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);

const looksLikeFile = (url: string) => path.extname(url.split('?')[0]) !== '';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

function extractRefs(content: string): Ref[] {
  const refs: Ref[] = [];
  for (const [pattern, kind] of REF_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      if (isLocalRef(match[1])) refs.push({ url: match[1], kind });
    }
  }
  return refs;
}

function isFile(candidate: string): boolean {
  try {
    return fsSync.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

// a url can be relative to the file it appears in, or relative to the root of
// the source tree (like a vault path: `noodles/2026/03/16/.../MxN.png`)
function resolveRef(url: string, fromFile: string, sourceDir: string): string | undefined {
  const clean = decodeURIComponent(url.split('?')[0].split('#')[0]);
  if (!clean) return undefined;

  const candidates = [path.resolve(path.dirname(fromFile), clean), path.join(sourceDir, clean)];
  return candidates.find(isFile);
}

// what we call a file in the page directory: its basename, kept unique
function uniqueName(resolved: string, copies: Map<string, string>): string {
  const ext = path.extname(resolved);
  const base = path.basename(resolved, ext);
  const taken = new Set(copies.values());

  let name = base + ext;
  for (let i = 1; taken.has(name); i++) {
    name = `${base}-${i}${ext}`;
  }
  return name;
}

/**
 * Copies everything `content` references into `targetDir` and rewrites the
 * references to point at the copies. References are followed transitively:
 * files we pull in get their own references pulled in too (an svg referencing
 * images, an imported module referencing images, ...).
 *
 * hyperlinks to other notes are left alone: those are pages of their own.
 */
async function pullReferencedFiles(
  content: string,
  sourceFile: string,
  sourceDir: string,
  targetDir: string,
  copies: Map<string, string>,
  seen: Set<string>,
): Promise<string> {
  if (seen.has(sourceFile)) return content;
  seen.add(sourceFile);

  let result = content;

  for (const { url, kind } of extractRefs(content)) {
    const resolved = resolveRef(url, sourceFile, sourceDir);
    if (!resolved) {
      if (looksLikeFile(url)) {
        console.warn(`  ⚠ ${path.relative(sourceDir, sourceFile)}: ${url} not found`);
      }
      continue;
    }

    const extension = path.extname(resolved).toLowerCase();
    const isNote = extension === '.md' || extension === '.mdx';
    const isLinkedNote = isNote && (kind === 'link' || kind === 'href');

    if (isLinkedNote) continue;

    let name = copies.get(resolved);
    if (!name) {
      name = uniqueName(resolved, copies);
      copies.set(resolved, name);
      console.log(`  ↳ ${name}`);
      await copyReferenced(
        resolved,
        path.join(targetDir, name),
        sourceDir,
        targetDir,
        copies,
        seen,
      );
    }

    result = result.split(url).join('./' + name);
  }

  return result;
}

async function copyReferenced(
  resolved: string,
  targetPath: string,
  sourceDir: string,
  targetDir: string,
  copies: Map<string, string>,
  seen: Set<string>,
): Promise<void> {
  const extension = path.extname(resolved).toLowerCase();

  if (!SCANNABLE_EXTENSIONS.has(extension)) {
    await fs.copyFile(resolved, targetPath);
    return;
  }

  const content = await fs.readFile(resolved, 'utf-8');
  await fs.writeFile(
    targetPath,
    await pullReferencedFiles(content, resolved, sourceDir, targetDir, copies, seen),
  );
}

function hasPublishKey(content: string): boolean {
  // Extract frontmatter (content between --- markers)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return false;
  }

  const frontmatter = frontmatterMatch[1];
  // Check if 'publish' key exists in the frontmatter (case-insensitive)
  return /^\s*publish\s*:/im.test(frontmatter);
}

async function processFile(sourceFile: string, sourceDir: string): Promise<void> {
  // Get relative path from source directory
  const relativePath = path.relative(sourceDir, sourceFile);

  try {
    // Read source file
    const content = await fs.readFile(sourceFile, 'utf-8');

    // Check if file has publish key in frontmatter
    if (!hasPublishKey(content)) {
      console.log(`⊘ ${relativePath} (no publish key)`);
      return;
    }

    // Remove .md extension: the noodle is imported to its file name's slug,
    // e.g. `noodles/2025/09/15/gibson-measure.md` -> `pages/(noodle)/gibson-measure`
    const pathWithoutExt = relativePath.replace(/\.md$/, '');
    const slug = slugify(path.basename(relativePath, '.md'));

    // Construct target directory
    const targetDir = path.join(NOODLE_DIR, slug);
    const targetFile = path.join(targetDir, '+Page.mdx');

    // Create target directory structure
    await fs.mkdir(targetDir, { recursive: true });

    console.log(`✓ ${pathWithoutExt}`);

    // Pull in referenced images & co, rewriting references to the copies
    const rewritten = await pullReferencedFiles(
      content,
      sourceFile,
      sourceDir,
      targetDir,
      new Map(),
      new Set(),
    );

    // Write to target file
    await fs.writeFile(targetFile, rewritten);
  } catch (error) {
    console.error(
      `✗ Failed to process ${sourceFile}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function getAllMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function traverse(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await traverse(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  await traverse(dir);
  return files;
}

async function importNoodles(sourceDir: string): Promise<void> {
  const resolvedSourceDir = path.resolve(sourceDir);

  try {
    await fs.access(resolvedSourceDir);
  } catch {
    console.error(`Error: Source directory does not exist: ${resolvedSourceDir}`);
    process.exit(1);
  }

  const files = await getAllMarkdownFiles(resolvedSourceDir);

  warnDuplicateSlugs(files, resolvedSourceDir);

  for (const file of files) {
    await processFile(file, resolvedSourceDir);
  }
}

// Two source files can share a file name and therefore a slug. We warn about
// that and leave it at that: no renaming, no skipping, no merging - both get
// imported like always (whichever is imported last owns the target folder).
function warnDuplicateSlugs(files: string[], sourceDir: string): void {
  const sourcesBySlug = new Map<string, string[]>();

  for (const file of files) {
    const slug = slugify(path.basename(file, '.md'));
    sourcesBySlug.set(slug, [...(sourcesBySlug.get(slug) ?? []), path.relative(sourceDir, file)]);
  }

  for (const [slug, sources] of sourcesBySlug) {
    if (sources.length > 1) {
      console.warn(
        `⚠ duplicate slug "${slug}": ${sources.join(', ')} all import to ${path.relative(process.cwd(), path.join(NOODLE_DIR, slug))}`,
      );
    }
  }
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('-')));
  const positional = argv.filter((arg) => !arg.startsWith('-'));
  return { watch: flags.has('--watch') || flags.has('-w'), sourceDir: positional[0] };
}

const { watch: watchMode, sourceDir } = parseArgs(process.argv.slice(2));

if (!sourceDir) {
  console.error('Usage: npm run import -- [--watch] <source-directory>');
  process.exit(1);
}

if (watchMode) {
  let running = false;
  let pending = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const rerun = () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    importNoodles(sourceDir)
      .catch((error) => console.error('Error:', error))
      .finally(() => {
        running = false;
        if (pending) {
          pending = false;
          rerun();
        }
      });
  };

  console.log(`Importing from ${path.resolve(sourceDir)}\n`);
  await importNoodles(sourceDir);
  console.log(`\nWatching ${path.resolve(sourceDir)} for changes...`);

  watch(path.resolve(sourceDir), { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(rerun, 250);
  });
} else {
  importNoodles(sourceDir).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
