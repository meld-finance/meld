import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { safeStorage } from 'electron';
import { log } from './log';
import { paths } from './paths';

/** Keys Meld makes for itself on first run. Losing ENCRYPTION_KEY means re-linking accounts. */
export type Secrets = {
  /** Encrypts Plaid access tokens, uploaded documents and saved settings. */
  encryptionKey: string;
  /** Signs login sessions. */
  sessionSecret: string;
  /** For the bundled Postgres, which only listens on 127.0.0.1. */
  postgresPassword: string;
};

const SERVICE = 'Meld';

/**
 * The secrets live in one item in the OS credential store: the macOS Keychain or the Windows
 * Credential Manager. It's a plain item (service "Meld"), so any future shell, not just
 * Electron, can read it. Each data folder has its own: "secrets" for the app's usual folder.
 */
function entry() {
  // A native module, so it ships as a package beside main.js rather than bundled into it.
  const { AsyncEntry } = createRequire(path.join(paths.keyringDir(), 'index.js'))('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
  const folder = path.basename(paths.data());
  return new AsyncEntry(SERVICE, folder === 'Meld' ? 'secrets' : `secrets:${folder}`);
}

/** Reads the secrets, moving them out of the old safeStorage file or creating them on first run. */
export async function loadSecrets(): Promise<Secrets> {
  // Missing resolves null; an error (e.g. access denied) throws, and must never look like a first run.
  const stored = await entry()
    .getPassword()
    .catch((err: unknown) => {
      throw new Error(`Meld couldn’t read its keys from the ${storeName()} (${err instanceof Error ? err.message : err}).`);
    });
  if (stored) return JSON.parse(stored) as Secrets;

  const legacy = paths.legacySecrets();
  if (existsSync(legacy)) return migrate(legacy);

  if (existsSync(path.join(paths.postgresData(), 'PG_VERSION'))) {
    // Data without keys: making new ones would lock Meld out of its own database and bank links.
    throw new Error(`Meld’s keys are missing from the ${storeName()}, but its data folder (${paths.data()}) has data that needs them.`);
  }
  const secrets: Secrets = {
    encryptionKey: randomBytes(32).toString('base64'),
    sessionSecret: randomBytes(32).toString('base64'),
    postgresPassword: randomBytes(24).toString('hex'),
  };
  await saveSecrets(secrets);
  return secrets;
}

export async function saveSecrets(secrets: Secrets) {
  const value = JSON.stringify(secrets);
  const item = entry();
  await item.setPassword(value);
  // Read it back: these keys can't be recovered if the write didn't take.
  if ((await item.getPassword()) !== value) throw new Error(`Meld couldn’t save its keys to the ${storeName()}.`);
}

/**
 * Builds before this one kept the secrets in secrets.bin, encrypted with Electron's safeStorage.
 * Copy them into the credential store, then set the file aside (renamed, never deleted).
 */
async function migrate(file: string): Promise<Secrets> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error(`Meld can’t read its keys in ${file}: the ${storeName()} isn’t available.`);
  }
  const { result } = await safeStorage.decryptStringAsync(readFileSync(file));
  const secrets = JSON.parse(result) as Secrets;
  await saveSecrets(secrets);
  renameSync(file, `${file}.migrated`);
  log('app', `Moved Meld’s keys from ${path.basename(file)} to the ${storeName()}`);
  return secrets;
}

const storeName = () => (process.platform === 'win32' ? 'Windows Credential Manager' : 'macOS Keychain');
