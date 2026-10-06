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

// paths are reported relative to the project root
function reportPath(targetPath: string): string {
  return path.relative(process.cwd(), targetPath);
}

// writes `data` only if it differs from what's already there, so a run only
// touches (and reports) the files that actually changed
async function writeFileIfChanged(targetPath: string, data: string | Buffer): Promise<boolean> {
  const next = typeof data === 'string' ? Buffer.from(data) : data;

  let existing: Buffer | undefined;
  try {
    existing = await fs.readFile(targetPath);
  } catch {
    // file isn't there yet
  }
  if (existing?.equals(next)) return false;

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, next);
  return true;
}

// what a run produces: target path -> file content
type Output = Map<string, string | Buffer>;

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
  output: Output,
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
      await collectReferenced(
        resolved,
        path.join(targetDir, name),
        sourceDir,
        targetDir,
        copies,
        seen,
        output,
      );
    }

    result = result.split(url).join('./' + name);
  }

  return result;
}

async function collectReferenced(
  resolved: string,
  targetPath: string,
  sourceDir: string,
  targetDir: string,
  copies: Map<string, string>,
  seen: Set<string>,
  output: Output,
): Promise<void> {
  const extension = path.extname(resolved).toLowerCase();

  if (!SCANNABLE_EXTENSIONS.has(extension)) {
    output.set(targetPath, await fs.readFile(resolved));
    return;
  }

  const content = await fs.readFile(resolved, 'utf-8');
  output.set(
    targetPath,
    await pullReferencedFiles(content, resolved, sourceDir, targetDir, copies, seen, output),
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

// Adds everything one source file contributes to the noodle dir to `output`
// (later sources win when two files share a slug). Doesn't touch the disk.
async function collectNoodle(sourceFile: string, sourceDir: string, output: Output): Promise<void> {
  // Get relative path from source directory
  const relativePath = path.relative(sourceDir, sourceFile);

  try {
    // Read source file
    const content = await fs.readFile(sourceFile, 'utf-8');

    // Not marked for publishing, so nothing to import (or, if we imported it
    // before, to remove again - see removeStale)
    if (!hasPublishKey(content)) return;

    // The noodle is imported to its file name's slug, e.g.
    // `noodles/2025/09/15/gibson-measure.md` -> `pages/(noodle)/gibson-measure`
    const slug = slugify(path.basename(relativePath, '.md'));

    // Construct target directory
    const targetDir = path.join(NOODLE_DIR, slug);
    const targetFile = path.join(targetDir, '+Page.mdx');

    // Pull in referenced images & co, rewriting references to the copies
    const copies = new Map<string, string>();
    output.set(
      targetFile,
      await pullReferencedFiles(
        content,
        sourceFile,
        sourceDir,
        targetDir,
        copies,
        new Set(),
        output,
      ),
    );
  } catch (error) {
    console.error(
      `✗ Failed to process ${sourceFile}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Removes the files and folders in the noodle dir that this run didn't
 * produce: their source file is gone from the import dir, or no longer has a
 * publish listing.
 *
 * The vike `+`-files at the root of the noodle dir (e.g. `+Layout.tsx`) aren't
 * import output and are left alone.
 */
async function removeStale(expected: Set<string>): Promise<void> {
  async function sweep(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativeToNoodleDir = path.relative(NOODLE_DIR, fullPath);

      if (entry.isDirectory()) {
        await sweep(fullPath);
        // drop the folders this run left empty
        if ((await fs.readdir(fullPath)).length === 0) {
          await fs.rmdir(fullPath);
          console.log(`✗ removed ${reportPath(fullPath)}/`);
        }
      } else {
        const isVikeConfigFile = dir === NOODLE_DIR && entry.name.startsWith('+');
        if (!isVikeConfigFile && !expected.has(relativeToNoodleDir)) {
          await fs.rm(fullPath);
          console.log(`✗ removed ${reportPath(fullPath)}`);
        }
      }
    }
  }

  await sweep(NOODLE_DIR);
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

  // what this run should leave in the noodle dir, computed up front so
  // duplicates and repeats report (and write) only net changes
  const output: Output = new Map();
  for (const file of files.sort()) {
    await collectNoodle(file, resolvedSourceDir, output);
  }

  const expected = new Set<string>();
  for (const [targetPath, data] of output) {
    expected.add(path.relative(NOODLE_DIR, targetPath));
    if (await writeFileIfChanged(targetPath, data)) {
      console.log(
        `${path.basename(targetPath).startsWith('+') ? '✓' : '↳'} ${reportPath(targetPath)}`,
      );
    }
  }

  await removeStale(expected);
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
