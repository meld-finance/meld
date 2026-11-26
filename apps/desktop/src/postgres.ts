import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { systemEnv } from './env';
import { log } from './log';
import { paths } from './paths';
import { freePort } from './ports';

const USER = 'meld';
/** Real data and Plaid sandbox data, kept apart as in the Docker setup. */
const DATABASES = ['meld', 'meld_sandbox', 'meld_demo'];
const READY_TIMEOUT_MS = 30_000;
const isWindows = process.platform === 'win32';
/** en_US sorting everywhere; Windows takes BCP 47 names, and UTF8 works with any locale there. */
const LOCALE = isWindows ? 'en-US' : 'en_US.UTF-8';

const bin = (name: string) => path.join(paths.postgresBin(), isWindows ? `${name}.exe` : name);
const env = () => (isWindows ? systemEnv() : { LC_ALL: LOCALE, PATH: '/usr/bin:/bin' });

export type RunningPostgres = { url: (db: string) => string; stop: () => Promise<void> };

function run(name: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(name), args, { env: env() });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('close', (code) => {
      log('postgres', output);
      if (code === 0) resolve();
      else reject(new Error(`${name} failed (${code}): ${output.slice(-500)}`));
    });
  });
}

/** Creates the data folder on first run. */
async function initialise(dataDir: string, password: string) {
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const pwfile = path.join(tmpdir(), `meld-pw-${process.pid}`);
  writeFileSync(pwfile, password, { mode: 0o600 });
  try {
    await run('initdb', [`--pgdata=${dataDir}`, `--username=${USER}`, `--pwfile=${pwfile}`, '--auth=scram-sha-256', '--encoding=UTF8', `--locale=${LOCALE}`]);
  } catch (err) {
    // Leave no half-made folder behind, or the next start would think it's ready.
    rmSync(dataDir, { recursive: true, force: true });
    throw err;
  } finally {
    rmSync(pwfile, { force: true });
  }
}

/**
 * Runs the bundled Postgres on a free localhost port (TCP only, no Unix socket),
 * with its data in Meld's folder, and makes sure Meld's databases exist.
 */
export async function startPostgres(password: string): Promise<RunningPostgres> {
  const dataDir = paths.postgresData();
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) await initialise(dataDir, password);
  const port = await freePort();

  const child: ChildProcess = spawn(
    bin('postgres'),
    ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
    { env: env() },
  );
  let exited = false;
  child.on('exit', (code) => {
    exited = true;
    log('postgres', `exited (${code})`);
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Postgres didn’t start in time')), READY_TIMEOUT_MS);
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      log('postgres', text);
      if (text.includes('ready to accept connections')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Postgres stopped while starting (${code}). See the log for details.`));
    });
  });

  const url = (db: string) => `postgres://${USER}:${password}@127.0.0.1:${port}/${db}`;
  const sql = postgres(url('postgres'), { onnotice: () => {} });
  try {
    const existing = new Set((await sql<{ datname: string }[]>`select datname from pg_database`).map((r) => r.datname));
    for (const db of DATABASES) if (!existing.has(db)) await sql.unsafe(`create database ${db}`);
  } finally {
    await sql.end();
  }

  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited) return resolve();
        child.once('exit', () => resolve());
        // Postgres's "fast" shutdown: roll back open transactions and stop cleanly. That's SIGINT
        // on macOS; Windows has no signals (kill() would end it abruptly), so pg_ctl asks instead.
        if (isWindows) run('pg_ctl', ['stop', `--pgdata=${dataDir}`, '--mode=fast', '--no-wait']).catch(() => child.kill());
        else child.kill('SIGINT');
      }),
  };
}
