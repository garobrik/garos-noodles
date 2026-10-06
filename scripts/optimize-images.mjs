#!/usr/bin/env node
// Idempotent, lossless, format-preserving image optimization.
//
// Usage:
//   node scripts/optimize-images.mjs            optimize every git-tracked image
//   node scripts/optimize-images.mjs <file...>  optimize just the given images
//                                               (what lint-staged passes on commit)
//
// Every optimization step is lossless and deterministic — PNG via optipng,
// JPEG via jpegtran (Huffman/progressive re-coding only), GIF via gifsicle,
// SVG via svgo — so running the tool on its own output leaves the file
// byte-identical. The algorithm is a fixed point after a single pass; no
// manifest or state file is needed to make repeated runs safe. As a belt-
// braces guard, a file is only ever replaced by a strictly smaller result.
// File formats are never changed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// optipng/gifsicle run through exec-buffer, which spills temp files into the
// system temp directory. That directory can be full or quota-limited (writes
// then fail with EDQUOT even when df reports free space), so point it at a
// directory inside the project instead — it also keeps runs hermetic.
process.env.TMPDIR = path.join(repoRoot, 'node_modules', '.cache', 'image-opt-tmp');
fs.mkdirSync(process.env.TMPDIR, { recursive: true });

// Imported only after TMPDIR is set: the temp path is captured at module-load
// time (exec-buffer -> tempfile -> temp-dir), not per call.
const { default: imagemin } = await import('imagemin');
const { default: imageminGifsicle } = await import('imagemin-gifsicle');
const { default: imageminJpegtran } = await import('imagemin-jpegtran');
const { default: imageminOptipng } = await import('imagemin-optipng');
const { default: imageminSvgo } = await import('imagemin-svgo');

const pluginsByExtension = new Map([
  ['.png', [imageminOptipng()]],
  ['.jpg', [imageminJpegtran()]],
  ['.jpeg', [imageminJpegtran()]],
  ['.gif', [imageminGifsicle()]],
  ['.svg', [imageminSvgo()]],
]);

const imageExtensions = [...pluginsByExtension.keys()];

function trackedImages() {
  const patterns = imageExtensions.map(extension => `*${extension}`);
  const output = execFileSync('git', ['ls-files', '-z', '--', ...patterns], { cwd: repoRoot });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function optimize(fileArg) {
  const filePath = path.resolve(process.cwd(), fileArg);
  const plugins = pluginsByExtension.get(path.extname(filePath).toLowerCase());

  if (!plugins || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const before = fs.readFileSync(filePath);
  const after = await imagemin.buffer(before, { plugins });

  if (after.length < before.length && Buffer.compare(before, after) !== 0) {
    fs.writeFileSync(filePath, after);
    const saved = before.length - after.length;
    const percent = ((saved / before.length) * 100).toFixed(1);
    console.log(
      `  ${path.relative(repoRoot, filePath)}: ${formatBytes(before.length)} -> ${formatBytes(after.length)} (-${percent}%)`,
    );
    return saved;
  }

  return 0;
}

const fileArgs = process.argv.slice(2);
const files = fileArgs.length > 0 ? fileArgs : trackedImages();

let totalSaved = 0;
let failures = 0;
for (const file of files) {
  try {
    totalSaved += (await optimize(file)) ?? 0;
  } catch (error) {
    failures += 1;
    console.error(`  ${file}: failed: ${error.message}`);
  }
}

console.log(
  files.length > 0
    ? `Images: ${files.length} checked, ${formatBytes(totalSaved)} saved`
    : 'Images: none found',
);

if (failures > 0) {
  process.exitCode = 1;
}
