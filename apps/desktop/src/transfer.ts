import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import postgres, { type Sql } from 'postgres';
import { readSettings, writeSettings } from '../../api/src/config-file';
import { paths } from './paths';
import { startPostgres } from './postgres';
import { loadSecrets, saveSecrets } from './secrets';

/**
 * Copies Meld's data between the Mac app and `npm run dev` (the repo's .env database), so both
 * use the same Plaid items and each bank is linked, and billed, once.
 *   seed: dev → Mac app, once. The Mac app takes dev's encryption key, so the access tokens still decrypt.
 *   pull: Mac app → dev, whenever dev should catch up. Dev takes the Mac app's key.
 * The Mac app must be quit: this runs its Postgres itself.
 */
export type Direction = 'seed' | 'pull';

const say = (msg: string) => console.log(`▸ ${msg}`);

export async function transfer(direction: Direction) {
  const devEnv = readEnvFile(paths.devEnv());
  const devUrl = devEnv.PRODUCTION_DATABASE_URL;
  if (!devUrl || !devEnv.ENCRYPTION_KEY) throw new Error(`PRODUCTION_DATABASE_URL and ENCRYPTION_KEY must be set in ${paths.devEnv()}.`);
  const devDocuments = devEnv.DOCUMENTS_DIR || paths.devDocuments();

  const secrets = await loadSecrets();
  say('Starting the Mac app’s Postgres');
  const pg = await startPostgres(secrets.postgresPassword);
  const mac = postgres(pg.url('meld'), { onnotice: () => {}, max: 1 });
  const dev = postgres(devUrl, { onnotice: () => {}, max: 1 });
  try {
    const [from, to] = direction === 'seed' ? [dev, mac] : [mac, dev];
    await checkMigrations(from, to, direction);
    await checkItems(from, to, direction);

    say(direction === 'seed' ? 'Copying dev’s database into the Mac app' : 'Copying the Mac app’s database into dev');
    await copyDatabase(from, to);
    const [fromDocs, toDocs] = direction === 'seed' ? [devDocuments, paths.documents()] : [paths.documents(), devDocuments];
    say(`Copying documents to ${toDocs}`);
    replaceFolder(fromDocs, toDocs);

    if (direction === 'seed') {
      // Settings secrets are encrypted with the old key; store them under the new one.
      const settings = readSettings(paths.config(), secrets.encryptionKey);
      if (existsSync(paths.config())) await writeSettings(paths.config(), devEnv.ENCRYPTION_KEY, settings);
      await saveSecrets({ ...secrets, encryptionKey: devEnv.ENCRYPTION_KEY });
      if (settings.PLAID_ENV !== 'production') say('Note: the Mac app isn’t set to Plaid production. Switch it in Settings → Plaid.');
    }
    setEnvValues(paths.devEnv(), {
      ...(direction === 'pull' && { ENCRYPTION_KEY: secrets.encryptionKey }),
      // Both copies now hold the same Plaid items; unlinking in dev must not remove them at Plaid.
      PLAID_SHARED_ITEMS: 'true',
    });
    say('Done. Restart `npm run dev` and the Docker container (`docker compose up -d`) so they pick up .env.');
  } finally {
    await Promise.all([mac.end(), dev.end()]);
    await pg.stop();
  }
}

async function migrationCount(sql: Sql) {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`.catch(() => [{ n: 0 }]);
  return row?.n ?? 0;
}

/** The target must have every migration the source has, or columns could be missing. */
async function checkMigrations(from: Sql, to: Sql, direction: Direction) {
  const [source, target] = await Promise.all([migrationCount(from), migrationCount(to)]);
  if (target >= source) return;
  throw new Error(
    direction === 'seed'
      ? 'The Mac app is older than dev. Run `npm run desktop:build`, install the new Meld.app, open it once, quit it and try again.'
      : 'Dev’s database is older than the Mac app. Run `npm run db:migrate` and try again.',
  );
}

/** Plaid items only the target has would be dropped here but stay linked (and billed) at Plaid. */
async function checkItems(from: Sql, to: Sql, direction: Direction) {
  if (process.env.MELD_TRANSFER_FORCE) return;
  const ids = async (sql: Sql) => new Set((await sql<{ id: string }[]>`select plaid_item_id as id from plaid_items`).map((r) => r.id));
  const [source, target] = await Promise.all([ids(from), ids(to)]);
  const orphans = [...target].filter((id) => !source.has(id));
  if (!orphans.length) return;
  const where = direction === 'seed' ? 'the Mac app' : 'dev';
  throw new Error(
    `${orphans.length} linked bank(s) exist only in ${where} and would be dropped while staying active at Plaid. ` +
      `Unlink them in ${where} first, or run again with MELD_TRANSFER_FORCE=1 to drop them anyway.`,
  );
}

/** Replaces every table in the target's public schema with the source's rows, in one transaction. */
async function copyDatabase(from: Sql, to: Sql) {
  const columns = async (sql: Sql) => {
    const rows = await sql<{ table: string; column: string }[]>`
      select c.table_name as table, c.column_name as column
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.is_generated = 'NEVER'
      order by c.table_name, c.ordinal_position`;
    const byTable = new Map<string, string[]>();
    for (const r of rows) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r.column]);
    return byTable;
  };
  const [source, target] = await Promise.all([columns(from), columns(to)]);

  await to.begin(async (tx) => {
    // Skip foreign-key checks while tables fill in whatever order.
    await tx`set local session_replication_role = replica`;
    await tx.unsafe(`truncate ${[...target.keys()].map((t) => `"${t}"`).join(', ')} cascade`);
    for (const [table, targetColumns] of target) {
      const sourceColumns = new Set(source.get(table) ?? []);
      const shared = targetColumns.filter((c) => sourceColumns.has(c));
      if (!shared.length) continue;
      // Postgres turns the rows into JSON and back, so every column type round-trips unchanged.
      const [dump] = await from<{ json: string }[]>`
        select coalesce(json_agg(r), '[]')::text as json from (select ${from(shared)} from ${from(table)}) r`;
      await tx`
        insert into ${tx(table)} (${tx(shared)})
        select ${tx(shared)} from json_populate_recordset(null::${tx(table)}, ${dump!.json}::text::json)`;
    }
  });
}

/** Moves the target aside to `<folder>.bak` (replacing an older one) and copies the source in. */
function replaceFolder(source: string, target: string) {
  const backup = `${target}.bak`;
  rmSync(backup, { recursive: true, force: true });
  if (existsSync(target)) renameSync(target, backup);
  if (existsSync(source)) cpSync(source, target, { recursive: true });
}

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) throw new Error(`No ${file}. Set up dev first (scripts/setup.sh).`);
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** Sets keys in a .env file in place (appending missing ones), keeping a copy as .env.bak if anything changes. */
function setEnvValues(file: string, values: Record<string, string>) {
  const before = readFileSync(file, 'utf8');
  let text = before;
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  if (text === before) return;
  writeFileSync(`${file}.bak`, before, { mode: 0o600 });
  writeFileSync(file, text, { mode: 0o600 });
  say(`Updated ${path.basename(file)} (${Object.keys(values).join(', ')}); the old one is ${path.basename(file)}.bak`);
}
