#!/usr/bin/env node
// Runs targeted verification checks for the files changed in the working tree (or --staged / --diff <base>).
//
// Usage:
//   npm run check:changed
//   node scripts/check-changed.mjs --staged
//   node scripts/check-changed.mjs --diff origin/main
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getChangedFilesFromGit, isDocSourceFile } from './check-docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(argv) {
  let mode = 'working';
  let diffBase = 'HEAD';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--staged') mode = 'staged';
    else if (argv[i] === '--working') mode = 'working';
    else if (argv[i] === '--diff') {
      mode = 'diff';
      diffBase = argv[++i] || 'origin/main';
    }
  }
  return { mode, diffBase };
}

function ensureExpoEnv() {
  const expoEnvPath = join(root, 'apps/mobile/expo-env.d.ts');
  if (!existsSync(expoEnvPath)) {
    writeFileSync(expoEnvPath, '/// <reference types="expo/types" />\n');
  }
}

function run(cmd, args) {
  console.log(`\n▸ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

function main() {
  const { mode, diffBase } = parseArgs(process.argv.slice(2));
  const changed = getChangedFilesFromGit(mode, diffBase);

  if (changed.length === 0) {
    console.log('✓ No changed files detected; skipping workspace checks.');
    return;
  }

  console.log(`Changed files (${changed.length}):`);
  for (const f of changed.slice(0, 20)) console.log(`  ${f}`);
  if (changed.length > 20) console.log(`  ... (+${changed.length - 20} more)`);

  const docArgs = mode === 'diff' ? ['scripts/check-docs.mjs', '--diff', diffBase] : ['scripts/check-docs.mjs', `--${mode}`];
  run(process.execPath, docArgs);

  const hasSharedOrRoot = changed.some(
    (f) => f.startsWith('packages/shared/') || f === 'package.json' || f.startsWith('tsconfig'),
  );
  const apiChanged = changed.some((f) => f.startsWith('apps/api/'));
  const mobileChanged = changed.some((f) => f.startsWith('apps/mobile/'));
  const desktopChanged = changed.some((f) => f.startsWith('apps/desktop/'));
  const siteChanged = changed.some(
    (f) => f === 'site/index.html' || f.startsWith('site/images/') || f === 'scripts/make-screenshots.mjs',
  );
  const docsChanged = changed.some((f) => (isDocSourceFile(f) && f !== 'README.md') || f.startsWith('site/docs/'));

  const ran = ['docs:audit'];

  if (hasSharedOrRoot) {
    ensureExpoEnv();
    run(npmCmd, ['run', 'typecheck']);
    ran.push('typecheck (all)');
  } else {
    if (apiChanged) {
      run(npmCmd, ['run', 'typecheck', '-w', '@meld/api']);
      ran.push('typecheck (@meld/api)');
    }
    if (mobileChanged) {
      ensureExpoEnv();
      run(npmCmd, ['run', 'typecheck', '-w', '@meld/mobile']);
      ran.push('typecheck (@meld/mobile)');
    }
    if (desktopChanged) {
      run(npmCmd, ['run', 'typecheck', '-w', '@meld/desktop']);
      ran.push('typecheck (@meld/desktop)');
    }
  }

  if (apiChanged || hasSharedOrRoot) {
    run(npmCmd, ['run', 'test:unit', '-w', '@meld/api']);
    ran.push('test:unit (@meld/api)');
  }
  if (mobileChanged) {
    run(npmCmd, ['run', 'lint', '-w', '@meld/mobile']);
    ran.push('lint (@meld/mobile)');
  }
  if (siteChanged) {
    run(npmCmd, ['run', 'site:check']);
    ran.push('site:check');
  }
  if (docsChanged) {
    run(npmCmd, ['run', 'docs:check']);
    ran.push('docs:check');
  }

  console.log(`\n✓ Passed changed-file checks: ${ran.join(', ')}`);
}

main();
