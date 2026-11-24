import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Release } from '@meld/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';

const REPO = 'meld-finance/meld';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const CACHE_MS = 60 * 60_000;
const TIMEOUT_MS = 10_000;

type GitHubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
};

/**
 * The version running: the Mac app passes it in; Docker and dev read apps/desktop/package.json,
 * the one place it lives. Null when neither is there.
 */
export function appVersion(env: Pick<Env, 'MELD_VERSION'>): string | null {
  if (env.MELD_VERSION) return env.MELD_VERSION;
  try {
    const file = fileURLToPath(new URL('../../../desktop/package.json', import.meta.url));
    return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** Sections that make sense on GitHub but not to someone reading inside the installed app. */
const DROPPED_SECTIONS = /^(install|installation|new contributors)$/i;

/**
 * Release notes as written on GitHub, minus what's noise in the app: install steps, the
 * "Full Changelog" link, and generated notes' "by @someone in <pull URL>" credits.
 */
export function tidyNotes(body: string): string {
  const out: string[] = [];
  let dropping = false;
  for (const raw of body.replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(raw);
    if (heading) {
      dropping = DROPPED_SECTIONS.test(heading[1]!);
      // Generated notes open with this; the release's own title says it already.
      if (dropping || /^what['’]s changed$/i.test(heading[1]!)) continue;
    }
    if (dropping) continue;
    if (/^\s*\*\*Full Changelog\*\*/i.test(raw)) continue;
    out.push(raw.replace(/ by @[\w[\]-]+ in https:\/\/github\.com\/\S+\/pull\/\d+\s*$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function toRelease(r: GitHubRelease): Release {
  const version = r.tag_name.replace(/^v/, '');
  // A bare tag as the title ("v0.2.0") reads better as "Meld 0.2.0".
  const name = !r.name || r.name === r.tag_name ? `Meld ${version}` : r.name;
  return { version, name, publishedAt: r.published_at ?? '', notes: tidyNotes(r.body ?? ''), url: r.html_url };
}

/** Published releases from GitHub, newest first, kept for an hour (stale ones are served if GitHub can't be reached). */
export class ReleaseNotes {
  private cached: { at: number; releases: Release[] } | null = null;

  constructor(private fetchImpl: typeof fetch = fetch) {}

  async list(): Promise<Release[]> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.releases;
    try {
      const res = await this.fetchImpl(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Meld' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const releases = ((await res.json()) as GitHubRelease[]).filter((r) => !r.draft && !r.prerelease).map(toRelease);
      this.cached = { at: Date.now(), releases };
      return releases;
    } catch (err) {
      if (this.cached) return this.cached.releases;
      throw new HttpError(502, `Couldn’t load the release notes from GitHub (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
}
