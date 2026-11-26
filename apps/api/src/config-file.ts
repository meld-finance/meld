import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decrypt, encrypt } from './lib/crypto';

/**
 * Settings the app can change itself (first-run setup, Settings), kept in a JSON file
 * at MELD_CONFIG_FILE. They fill in what the environment leaves unset, so a .env
 * value always wins and existing .env installs keep working as they were.
 */
export const SETTING_KEYS = [
  'APP_PASSPHRASE_HASH',
  'APP_PASSPHRASE_OFF',
  'PLAID_CLIENT_ID',
  'PLAID_SANDBOX_SECRET',
  'PLAID_PRODUCTION_SECRET',
  'PLAID_ENV',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_CHAT_MODELS',
  'OLLAMA_URL',
  'OLLAMA_CHAT_MODELS',
  'PHONE_ACCESS',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = Partial<Record<SettingKey, string>>;

/** Encrypted with ENCRYPTION_KEY in the file. */
const SECRET_KEYS: ReadonlySet<SettingKey> = new Set([
  'PLAID_SANDBOX_SECRET',
  'PLAID_PRODUCTION_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
]);

type ConfigFile = { version: 1; settings: Settings };

export function readSettings(file: string, encryptionKey: string): Settings {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as ConfigFile;
  const settings: Settings = {};
  for (const key of SETTING_KEYS) {
    const value = parsed.settings?.[key];
    if (typeof value !== 'string' || !value) continue;
    settings[key] = SECRET_KEYS.has(key) ? decrypt(value, encryptionKey) : value;
  }
  return settings;
}

/** Replaces the file's settings with `settings`; empty values are dropped. */
export async function writeSettings(file: string, encryptionKey: string, settings: Settings) {
  const stored: Settings = {};
  for (const key of SETTING_KEYS) {
    const value = settings[key];
    if (value) stored[key] = SECRET_KEYS.has(key) ? encrypt(value, encryptionKey) : value;
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Write then rename, so a crash never leaves a half-written settings file.
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, settings: stored } satisfies ConfigFile, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

/** Setting keys the environment itself sets (non-empty), which the settings file can't override. */
export function settingsFromEnv(source: NodeJS.ProcessEnv): Set<SettingKey> {
  return new Set(SETTING_KEYS.filter((k) => !!source[k]));
}

/**
 * The environment with the settings file filled in underneath it. An empty variable
 * counts as unset, since .env templates list every key with no value.
 */
export function withSettingsFile(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const file = source.MELD_CONFIG_FILE;
  const key = source.ENCRYPTION_KEY;
  if (!file || !key) return source;
  const merged: NodeJS.ProcessEnv = { ...source };
  for (const [k, v] of Object.entries(readSettings(file, key))) if (!merged[k]) merged[k] = v;
  return merged;
}
