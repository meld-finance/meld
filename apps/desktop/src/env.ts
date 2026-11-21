/** Windows variables child processes need: Node and Postgres fail in odd ways without SystemRoot, TEMP etc. */
const WINDOWS_KEEP = [
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
];

/**
 * The base environment for Postgres and the API: just what the OS needs, nothing from
 * whatever shell launched Meld (settings come from Meld's own files).
 */
export function systemEnv(): Record<string, string> {
  if (process.platform !== 'win32') return { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' };
  const env: Record<string, string> = {};
  for (const key of WINDOWS_KEEP) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  const root = env.SystemRoot ?? 'C:\\Windows';
  env.PATH = [`${root}\\System32`, root, `${root}\\System32\\Wbem`].join(';');
  return env;
}
