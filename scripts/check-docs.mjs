#!/usr/bin/env node
// Checks whether changed code files touch documented areas without matching documentation updates,
// and ensures site/docs/ stays in sync whenever documentation sources are modified.
//
// Usage:
//   node scripts/check-docs.mjs --staged           # check staged changes (used by git pre-commit hook)
//   node scripts/check-docs.mjs --working          # check uncommitted working-tree changes (npm run docs:audit)
//   node scripts/check-docs.mjs --diff origin/main # check changes against a base ref
//   node scripts/check-docs.mjs --files a.ts b.md  # check an explicit list of paths
// Flags:
//   --strict   Exit with code 1 when code changes lack matching doc updates (or DOCS_STRICT=1)
//   --json     Print structured JSON report
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_DOCS, buildDocs } from './build-docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DOC_SOURCES = new Set([
  ...ALL_DOCS.map((d) => d.sourcePath),
  'README.md',
  'scripts/build-docs.mjs',
]);

export const DOC_RULES = [
  {
    area: 'Plaid integration & setup',
    docs: ['docs/plaid.md', 'docs/features.md'],
    match: (f) =>
      f.startsWith('apps/api/src/plaid/') ||
      f === 'apps/api/src/routes/plaid.ts' ||
      f === 'apps/mobile/src/components/setup/plaid-fields.tsx' ||
      f.startsWith('apps/mobile/src/components/plaid-link-button'),
  },
  {
    area: 'Phone access & Tailscale',
    docs: ['docs/phone-access.md', 'docs/docker.md'],
    match: (f) =>
      f === 'apps/api/src/services/tailscale.ts' ||
      f === 'apps/api/src/routes/phone-access.ts' ||
      f === 'apps/mobile/src/components/setup/phone-access-card.tsx',
  },
  {
    area: 'Docker & environment config',
    docs: ['docs/docker.md', 'docs/development.md'],
    match: (f) =>
      f === 'Dockerfile' ||
      f === 'docker-compose.yml' ||
      f.startsWith('docker/') ||
      f === '.env.example' ||
      f === 'scripts/setup.sh' ||
      f === 'apps/api/src/env.ts',
  },
  {
    area: 'Privacy & external services',
    docs: ['PRIVACY.md', 'docs/features.md'],
    match: (f) =>
      f.startsWith('apps/api/src/ai/') ||
      f === 'apps/api/src/lib/prices.ts' ||
      f === 'apps/api/src/services/alerts.ts' ||
      f === 'apps/api/src/services/alert-settings.ts' ||
      f === 'apps/api/src/services/estate-packet.ts' ||
      f.startsWith('apps/api/src/storage/'),
  },
  {
    area: 'Security, auth & encryption',
    docs: ['SECURITY.md', 'PRIVACY.md'],
    match: (f) =>
      f === 'apps/api/src/auth.ts' ||
      f === 'apps/api/src/lib/crypto.ts' ||
      f === 'apps/api/src/lib/passphrase.ts' ||
      f === 'apps/api/src/config-file.ts' ||
      f === 'apps/desktop/src/secrets.ts',
  },
  {
    area: 'App features & UI',
    docs: ['docs/features.md'],
    match: (f) =>
      f.startsWith('apps/api/src/routes/') ||
      f.startsWith('apps/api/src/services/') ||
      f.startsWith('apps/api/src/lib/') ||
      f.startsWith('apps/mobile/src/app/') ||
      f.startsWith('apps/mobile/src/components/') ||
      f.startsWith('packages/shared/src/'),
  },
  {
    area: 'Desktop, tooling & schema',
    docs: ['docs/development.md', 'CONTRIBUTING.md'],
    match: (f) =>
      f.startsWith('apps/desktop/') ||
      f === 'package.json' ||
      f.startsWith('scripts/') ||
      f.startsWith('.github/workflows/') ||
      f === 'apps/api/src/db/schema.ts',
  },
];

function isIgnoredForDocAudit(file) {
  return (
    file.endsWith('.test.ts') ||
    file.endsWith('.test.tsx') ||
    file.endsWith('.db.test.ts') ||
    file.startsWith('apps/api/src/test/') ||
    file.startsWith('site/docs/')
  );
}

export function isDocSourceFile(file) {
  return DOC_SOURCES.has(file);
}

export function analyzeChangedFiles(files) {
  const normalized = [...new Set(files.map((f) => f.replace(/\\/g, '/').trim()).filter(Boolean))];
  const changedDocs = new Set(normalized.filter(isDocSourceFile));
  const codeFiles = normalized.filter((f) => !isDocSourceFile(f) && !isIgnoredForDocAudit(f));

  const missing = [];
  for (const rule of DOC_RULES) {
    const matchedCode = codeFiles.filter(rule.match);
    if (matchedCode.length === 0) continue;
    const hasDocUpdate = rule.docs.some((doc) => changedDocs.has(doc));
    if (!hasDocUpdate) {
      missing.push({
        area: rule.area,
        suggestedDocs: rule.docs,
        codeFiles: matchedCode,
      });
    }
  }

  return {
    changedDocs: [...changedDocs].sort(),
    codeFiles,
    missing,
    hasBuildAffectingDocChanges: [...changedDocs].some((d) => d !== 'README.md'),
  };
}

function gitLines(args) {
  try {
    const out = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function getChangedFilesFromGit(mode, diffBase = 'HEAD') {
  if (mode === 'staged') {
    return gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  }
  if (mode === 'diff') {
    return gitLines(['diff', '--name-only', '--diff-filter=ACMR', diffBase]);
  }
  // working tree: staged + unstaged + untracked
  const tracked = gitLines(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...untracked])];
}

function parseCliArgs(argv) {
  let mode = 'working';
  let diffBase = 'HEAD';
  let strict = process.env.DOCS_STRICT === '1';
  let json = false;
  const files = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staged') mode = 'staged';
    else if (arg === '--working') mode = 'working';
    else if (arg === '--strict') strict = true;
    else if (arg === '--json') json = true;
    else if (arg === '--diff') {
      mode = 'diff';
      diffBase = argv[++i] || 'origin/main';
    } else if (arg === '--files') {
      mode = 'files';
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        files.push(argv[++i]);
      }
    }
  }
  return { mode, diffBase, strict, json, files };
}

function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const changed = opts.mode === 'files' ? opts.files : getChangedFilesFromGit(opts.mode, opts.diffBase);
  const report = analyzeChangedFiles(changed);

  let docsSyncError = null;
  if (report.hasBuildAffectingDocChanges) {
    try {
      buildDocs({ check: true });
    } catch (err) {
      docsSyncError = err.message;
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...report, docsSyncError }, null, 2));
    if (docsSyncError || (opts.strict && report.missing.length > 0)) process.exit(1);
    return;
  }

  if (docsSyncError) {
    console.error(docsSyncError);
    console.error('\nRun `npm run docs:build` so site/docs/ matches the updated Markdown.');
    process.exit(1);
  }

  if (process.env.SKIP_DOCS_CHECK === '1') {
    return;
  }

  if (report.missing.length > 0) {
    const header = opts.strict ? 'Documentation check failed:' : 'Docs reminder (advisory):';
    console.log(header);
    for (const entry of report.missing) {
      const sample = entry.codeFiles.slice(0, 3).join(', ') + (entry.codeFiles.length > 3 ? ` (+${entry.codeFiles.length - 3} more)` : '');
      console.log(`  • ${entry.area}`);
      console.log(`      changed: ${sample}`);
      console.log(`      review:  ${entry.suggestedDocs.join(', ')}`);
    }
    console.log('If you update any docs, run `npm run docs:build` to regenerate site/docs/.');
    if (opts.strict) process.exit(1);
  } else if (opts.mode === 'working' || opts.mode === 'files') {
    console.log('✓ Docs audit clean.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
