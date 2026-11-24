// The release workflow builds each Mac architecture in its own job, and each writes a
// latest-mac.yml listing only its own files. The app reads one latest-mac.yml and picks the
// arm64 or Intel zip from its `files`, so this merges them:
//   node merge-update-info.mjs latest-mac.yml latest-mac-arm64.yml latest-mac-x64.yml
// The first input supplies everything but `files`. No dependencies: the files are
// electron-builder's own simple YAML, and only the `files` list is touched.
import { readFileSync, writeFileSync } from 'node:fs';

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length < 2) {
  console.error('Usage: node merge-update-info.mjs <out.yml> <in.yml> <in.yml>...');
  process.exit(1);
}

/** Splits a file into the lines of its `files:` list and the rest, around where the list was. */
function split(text) {
  const lines = text.replace(/\r/g, '').trimEnd().split('\n');
  const start = lines.indexOf('files:');
  if (start < 0) throw new Error('No files: list');
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end])) end++;
  return { before: lines.slice(0, start + 1), files: lines.slice(start + 1, end), after: lines.slice(end) };
}

const version = (text) => /^version: (.+)$/m.exec(text)?.[1];
const texts = inputs.map((file) => readFileSync(file, 'utf8'));
const versions = new Set(texts.map(version));
if (versions.size !== 1) throw new Error(`The inputs are for different versions: ${[...versions].join(', ')}`);

const [first, ...rest] = texts.map(split);
const files = [first.files, ...rest.map((r) => r.files)].flat();
writeFileSync(out, `${[...first.before, ...files, ...first.after].join('\n')}\n`);
console.log(`Wrote ${out}: ${files.filter((l) => l.trimStart().startsWith('- url:')).length} files for ${[...versions][0]}`);
