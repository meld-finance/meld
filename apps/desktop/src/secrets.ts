import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { safeStorage } from 'electron';
import { paths } from './paths';

/** Keys Meld makes for itself on first run. Losing ENCRYPTION_KEY means re-linking accounts, so it lives in the Keychain. */
export type Secrets = {
  /** Encrypts Plaid access tokens, uploaded documents and saved settings. */
  encryptionKey: string;
  /** Signs login sessions. */
  sessionSecret: string;
  /** For the bundled Postgres, which only listens on 127.0.0.1. */
  postgresPassword: string;
};

/**
 * Reads the secrets, creating them on first run. They're stored in secrets.bin,
 * encrypted with a key macOS keeps in the Keychain (Electron safeStorage).
 */
export async function loadSecrets(): Promise<Secrets> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('The macOS Keychain isn’t available, so Meld can’t keep its keys safe.');
  }
  const file = paths.secrets();
  if (existsSync(file)) {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(readFileSync(file));
    const secrets = JSON.parse(result) as Secrets;
    // macOS rotated the key it encrypts with; store the secrets again under the new one.
    if (shouldReEncrypt) await saveSecrets(secrets);
    return secrets;
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
  writeFileSync(paths.secrets(), await safeStorage.encryptStringAsync(JSON.stringify(secrets)), { mode: 0o600 });
}
