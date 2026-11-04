import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { log } from './log';
import { paths } from './paths';
import { freePort } from './ports';

const USER = 'meld';
/** Real data and Plaid sandbox data, kept apart as in the Docker setup. */
const DATABASES = ['meld', 'meld_sandbox'];
const READY_TIMEOUT_MS = 30_000;

export type RunningPostgres = { url: (db: string) => string; stop: () => Promise<void> };

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(paths.postgresBin(), bin), args, { env: { LC_ALL: 'en_US.UTF-8', PATH: '/usr/bin:/bin' } });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('close', (code) => {
      log('postgres', output);
      if (code === 0) resolve();
      else reject(new Error(`${bin} failed (${code}): ${output.slice(-500)}`));
    });
  });
}

/** Creates the data folder on first run. */
async function initialise(dataDir: string, password: string) {
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const pwfile = path.join(tmpdir(), `meld-pw-${process.pid}`);
  writeFileSync(pwfile, password, { mode: 0o600 });
  try {
    await run('initdb', [`--pgdata=${dataDir}`, `--username=${USER}`, `--pwfile=${pwfile}`, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=en_US.UTF-8']);
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
    path.join(paths.postgresBin(), 'postgres'),
    ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
    { env: { LC_ALL: 'en_US.UTF-8', PATH: '/usr/bin:/bin' } },
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
        // SIGINT is Postgres's "fast" shutdown: roll back open transactions and stop cleanly.
        child.kill('SIGINT');
      }),
  };
}
