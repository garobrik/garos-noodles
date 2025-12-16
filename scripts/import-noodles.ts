import fs from 'fs/promises';
import path from 'path';

const NOODLE_DIR = path.join(process.cwd(), 'pages/(noodle)');

function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

async function importNoodles(sourceDir: string): Promise<void> {
  const resolvedSourceDir = path.resolve(sourceDir);

  try {
    await fs.access(resolvedSourceDir);
  } catch {
    console.error(
      `Error: Source directory does not exist: ${resolvedSourceDir}`,
    );
    process.exit(1);
  }

  const files = await getAllMarkdownFiles(resolvedSourceDir);

  for (const file of files) {
    await processFile(file, resolvedSourceDir);
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

async function processFile(
  sourceFile: string,
  sourceDir: string,
): Promise<void> {
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

    // Remove .md extension and split path
    const pathWithoutExt = relativePath.replace(/\.md$/, '');
    const pathParts = pathWithoutExt.split(path.sep);

    // Last part is the slug, rest is directory structure
    const slug = slugify(pathParts[pathParts.length - 1]);
    const subdirs = pathParts.slice(0, -1).map(slugify);

    // Construct target directory
    const targetDir = path.join(NOODLE_DIR, ...subdirs, slug);
    const targetFile = path.join(targetDir, '+Page.mdx');

    // Create target directory structure
    await fs.mkdir(targetDir, { recursive: true });

    // Write to target file
    await fs.writeFile(targetFile, content);

    console.log(`✓ ${pathWithoutExt}`);
  } catch (error) {
    console.error(
      `✗ Failed to process ${sourceFile}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Get source directory from command line arguments
const sourceDir = process.argv[2];

if (!sourceDir) {
  console.error('Usage: npx tsx scripts/import-noodles.ts <source-directory>');
  process.exit(1);
}

importNoodles(sourceDir).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
