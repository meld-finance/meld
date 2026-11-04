import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { paths } from './paths';

const MAX_BYTES = 5 * 1024 * 1024;

/** Everything the app, Postgres and the API print goes to logs/meld.log (one previous file is kept). */
export function log(source: string, message: string) {
  const dir = paths.logs();
  const file = path.join(dir, 'meld.log');
  try {
    mkdirSync(dir, { recursive: true });
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(file, `${file}.1`);
    const stamp = new Date().toISOString();
    const lines = message.trimEnd().split('\n').map((l) => `${stamp} [${source}] ${l}`);
    appendFileSync(file, `${lines.join('\n')}\n`);
  } catch {
    // Logging must never take the app down.
  }
  if (process.env.MELD_DESKTOP_DEV) console.log(`[${source}] ${message.trimEnd()}`);
}

export const logFile = () => path.join(paths.logs(), 'meld.log');
