#!/usr/bin/env node
// Claude Code hook for keeping Meld's Markdown docs and generated site/docs/ in sync.
// Modes:
//   post-edit : regenerates site/docs/ whenever a documentation source file is edited
//   stop      : checks working-tree changes and reminds Claude to review/rebuild docs before finishing
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDocs } from './build-docs.mjs';
import { analyzeChangedFiles, getChangedFilesFromGit, isDocSourceFile } from './check-docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function handlePostEdit(input) {
  const rawPath = input?.tool_input?.file_path || input?.tool_input?.path || '';
  if (!rawPath) return;
  const rel = relative(root, resolve(root, rawPath)).replace(/\\/g, '/');
  if (!isDocSourceFile(rel) || rel === 'README.md') return;

  const res = buildDocs();
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `Updated ${rel}: automatically rebuilt ${res.count} web docs pages in site/docs/ and ${res.helpSections} Ask Meld guide sections in apps/api/src/ai/meld-docs.generated.ts via scripts/build-docs.mjs.`,
      },
    }),
  );
}

function handleStop(input) {
  if (input?.stop_hook_active === true) return;

  const changed = getChangedFilesFromGit('working');
  if (changed.length === 0) return;

  const report = analyzeChangedFiles(changed);

  if (report.hasBuildAffectingDocChanges) {
    try {
      buildDocs({ check: true });
    } catch {
      console.log(
        JSON.stringify({
          decision: 'block',
          reason:
            'Documentation source files were modified, so site/docs/ or apps/api/src/ai/meld-docs.generated.ts is out of sync. Run `npm run docs:build` and verify with `npm run docs:check`.',
        }),
      );
      return;
    }
  }

  if (report.missing.length > 0) {
    const areas = report.missing.map((m) => m.area).join(', ');
    const docs = [...new Set(report.missing.flatMap((m) => m.suggestedDocs))].join(', ');
    console.log(
      JSON.stringify({
        decision: 'block',
        reason: `You modified ${areas} without updating ${docs}. Review whether those docs need updates (and run \`npm run docs:build\` if you edit any). If no documentation change is needed, briefly note why and finish.`,
      }),
    );
  }
}

function main() {
  const mode = process.argv[2];
  const raw = readStdin().trim();
  let input = {};
  if (raw) {
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
  }

  try {
    if (mode === 'post-edit') handlePostEdit(input);
    else if (mode === 'stop') handleStop(input);
  } catch {
    // Fail open so hooks never block sessions due to an unexpected environment issue.
    process.exit(0);
  }
}

main();
