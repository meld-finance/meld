import path from 'node:path';
import { app } from 'electron';

/** `npm run desktop:dev`: the API runs from source and the window loads the Expo dev server. */
export const isDev = !!process.env.MELD_DESKTOP_DEV;

/** The repo, in dev (the app runs from apps/desktop). */
const repoRoot = () => path.resolve(app.getAppPath(), '../..');

/** Bundled pieces: in the app's Resources folder when packaged, built into dist/ otherwise. */
const resources = () => (app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'dist', 'resources'));

/** The embedded-postgres package for this machine (the darwin-arm64 one has universal binaries). */
const postgresPackage = () => (process.platform === 'win32' ? 'windows-x64' : 'darwin-arm64');

export const paths = {
  data: () => app.getPath('userData'),
  postgresData: () => path.join(app.getPath('userData'), 'postgres'),
  documents: () => path.join(app.getPath('userData'), 'documents'),
  config: () => path.join(app.getPath('userData'), 'config.json'),
  /** Where the secrets were kept before they moved to the Keychain / Credential Manager. */
  legacySecrets: () => path.join(app.getPath('userData'), 'secrets.bin'),
  logs: () => path.join(app.getPath('userData'), 'logs'),
  postgresBin: () =>
    isDev
      ? path.join(repoRoot(), 'node_modules/@embedded-postgres', postgresPackage(), 'native/bin')
      : path.join(resources(), 'postgres', 'bin'),
  apiEntry: () => (isDev ? path.join(repoRoot(), 'apps/api/src/index.ts') : path.join(resources(), 'api', 'index.js')),
  apiDir: () => (isDev ? path.join(repoRoot(), 'apps/api') : path.join(resources(), 'api')),
  migrations: () => (isDev ? path.join(repoRoot(), 'apps/api/drizzle') : path.join(resources(), 'api', 'drizzle')),
  web: () => (isDev ? '' : path.join(resources(), 'web')),
  /** Where @napi-rs/keyring is found from: Resources/keyring packaged, the repo's node_modules otherwise. */
  keyringDir: () => (app.isPackaged ? path.join(resources(), 'keyring') : app.getAppPath()),
  /** The repo's .env and default documents folder, for copying data between the Mac app and `npm run dev`. */
  devEnv: () => path.join(repoRoot(), '.env'),
  devDocuments: () => path.join(repoRoot(), 'data', 'documents'),
};
