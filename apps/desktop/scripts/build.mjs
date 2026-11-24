// Builds everything the desktop app needs into dist/:
//   dist/main.js              the Electron main process
//   dist/preload.cjs          the window's preload (window.meldDesktop: version and updates)
//   dist/resources/api        the API as one bundled file, its migrations, and pdfkit
//   dist/resources/web        the Expo web export (API under /api, same origin)
//   dist/resources/postgres   Postgres for this machine's platform and architecture
//   dist/resources/keyring    @napi-rs/keyring (a native module) for the Keychain / Credential Manager
// `--main-only` builds just the main process (enough for `npm run dev`). `--arch x64|arm64` targets another Mac.
// Build on the platform you're building for: the Windows app on Windows, the Mac app on a Mac.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '../..');
const dist = path.join(desktop, 'dist');
const resources = path.join(dist, 'resources');
const args = process.argv.slice(2);
const mainOnly = args.includes('--main-only');
const arch = args.includes('--arch') ? args[args.indexOf('--arch') + 1] : process.arch;
const isWindows = process.platform === 'win32';
const step = (msg) => console.log(`\n▸ ${msg}`);

step('Main process');
await build({
  entryPoints: [path.join(desktop, 'src/main.ts')],
  outfile: path.join(dist, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['electron'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
// A sandboxed preload must be one CommonJS file.
await build({
  entryPoints: [path.join(desktop, 'src/preload.ts')],
  outfile: path.join(dist, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  logLevel: 'warning',
});
if (mainOnly) process.exit(0);

rmSync(resources, { recursive: true, force: true });
mkdirSync(resources, { recursive: true });

step('API');
const apiOut = path.join(resources, 'api');
await build({
  entryPoints: [path.join(repo, 'apps/api/src/index.ts')],
  outfile: path.join(apiOut, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // pdfkit loads its font files from its own folder, so it ships as a package beside the bundle.
  external: ['pdfkit'],
  // Some dependencies are CommonJS and expect these.
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __fu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      'const require = __cr(import.meta.url);',
      'const __filename = __fu(import.meta.url);',
      'const __dirname = __dn(__filename);',
    ].join(' '),
  },
  logLevel: 'warning',
});
writeJson(path.join(apiOut, 'package.json'), { type: 'module', private: true });
cpSync(path.join(repo, 'apps/api/drizzle'), path.join(apiOut, 'drizzle'), { recursive: true });
copyPackageTree('pdfkit', path.join(apiOut, 'node_modules'));

step('Keyring');
// keyring loads a .node file for the platform, so it ships as a package that main.js requires by path.
const keyringOut = path.join(resources, 'keyring', 'node_modules');
copyPackageTree('@napi-rs/keyring', keyringOut);
copyNativeBinding('@napi-rs/keyring', isWindows ? `win32-${arch}-msvc` : `darwin-${arch}`, keyringOut);

step('Web app');
// Expo's CLI run with this Node directly: no shell, so it works the same on Windows.
const mobile = path.join(repo, 'apps/mobile');
execFileSync(process.execPath, [path.join(findPackage('expo', mobile), 'bin/cli'), 'export', '--platform', 'web', '--output-dir', path.join(resources, 'web')], {
  cwd: mobile,
  env: { ...process.env, EXPO_PUBLIC_API_URL: '/api', EXPO_NO_TELEMETRY: '1' },
  stdio: 'inherit',
});

step(`Postgres (${process.platform}-${arch})`);
// The darwin-arm64 package's binaries are universal, so both Mac builds start from it.
const pgSource = path.join(findPackage(`@embedded-postgres/${isWindows ? 'windows-x64' : 'darwin-arm64'}`, desktop), 'native');
const pgOut = path.join(resources, 'postgres');
for (const dir of ['bin', 'lib', 'share']) cpSync(path.join(pgSource, dir), path.join(pgOut, dir), { recursive: true });
if (!isWindows) thinAndDedupe(pgOut, arch === 'x64' ? 'x86_64' : 'arm64');

console.log(`\nBuilt ${path.relative(process.cwd(), dist)}`);

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Copies a napi-rs package's binary for the target (e.g. @napi-rs/keyring-darwin-x64) into `target`.
 * npm installs only this machine's binary, so another architecture's comes from the registry.
 */
function copyNativeBinding(name, triple, target) {
  const binding = `${name}-${triple}`;
  const { version } = JSON.parse(readFileSync(path.join(findPackage(name, repo), 'package.json'), 'utf8'));
  const out = path.join(target, binding);
  try {
    const dir = findPackage(binding, repo);
    if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version === version) {
      cpSync(dir, out, { recursive: true, dereference: true });
      return;
    }
  } catch {
    // Not installed: fetch it below.
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'meld-binding-'));
  try {
    const [{ filename }] = JSON.parse(execFileSync('npm', ['pack', `${binding}@${version}`, '--json', '--pack-destination', temp], { shell: isWindows }).toString());
    execFileSync('tar', ['-xzf', path.join(temp, filename), '-C', temp]);
    cpSync(path.join(temp, 'package'), out, { recursive: true });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Copies a package and everything it depends on (as installed in the repo) into `target`. */
function copyPackageTree(name, target, from = repo, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = findPackage(name, from);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  cpSync(dir, path.join(target, name), { recursive: true, dereference: true });
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyPackageTree(dep, target, dir, seen);
}

/** Where Node would find `name` from `from`: the nearest node_modules/<name> going up. */
function findPackage(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === path.dirname(dir)) throw new Error(`Can’t find ${name} from ${from}`);
  }
}

/**
 * The Postgres package has universal binaries and full copies where symlinks were meant
 * (libicudata three times over). Keep only this Mac's architecture and link the copies.
 */
function thinAndDedupe(root, lipoArch) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) files.push(full);
    }
  };
  walk(root);
  for (const file of files) {
    const info = execFileSync('file', ['-b', file]).toString();
    if (info.includes('universal binary')) execFileSync('lipo', [file, '-thin', lipoArch, '-output', file]);
  }
  const byHash = new Map();
  for (const file of files.sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    const first = byHash.get(hash);
    if (first && path.dirname(first) === path.dirname(file) && file.endsWith('.dylib')) {
      unlinkSync(file);
      symlinkSync(path.basename(first), file);
    } else if (!first) byHash.set(hash, file);
  }
}
