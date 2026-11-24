import { describe, expect, it, vi } from 'vitest';
import { ReleaseNotes, appVersion, tidyNotes, toRelease } from './releases';

const GENERATED = `<!-- Release notes generated using configuration in .github/release.yml at main -->

## What's Changed
* Add release notes by @someone in https://github.com/meld-finance/meld/pull/12
* Fix sync by @dependabot[bot] in https://github.com/meld-finance/meld/pull/13

## New Contributors
* @someone made their first contribution in https://github.com/meld-finance/meld/pull/12

**Full Changelog**: https://github.com/meld-finance/meld/compare/v0.1.0...v0.2.0`;

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0',
  name: 'v0.2.0',
  body: 'Hello',
  html_url: 'https://github.com/meld-finance/meld/releases/tag/v0.2.0',
  published_at: '2026-11-30T00:00:00Z',
  draft: false,
  prerelease: false,
  ...over,
});

describe('tidyNotes', () => {
  it('keeps the changes from generated notes and drops the credits and links', () => {
    expect(tidyNotes(GENERATED)).toBe('* Add release notes\n* Fix sync');
  });

  it('drops an Install section but keeps the rest of hand-written notes', () => {
    const body = 'Intro.\r\n\r\n## Install\r\n\r\n- Open the .dmg\r\n\r\n## What\'s in it\r\n\r\n- Things';
    expect(tidyNotes(body)).toBe("Intro.\n\n## What's in it\n\n- Things");
  });
});

describe('toRelease', () => {
  it('names a bare tag after Meld and strips the v', () => {
    expect(toRelease(release())).toMatchObject({ version: '0.2.0', name: 'Meld 0.2.0' });
    expect(toRelease(release({ name: 'Spring update' })).name).toBe('Spring update');
  });
});

describe('appVersion', () => {
  it('prefers MELD_VERSION and otherwise reads the desktop package', () => {
    expect(appVersion({ MELD_VERSION: '9.9.9' })).toBe('9.9.9');
    expect(appVersion({ MELD_VERSION: '' })).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('ReleaseNotes', () => {
  it('leaves out drafts and pre-releases and caches the list', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([release(), release({ tag_name: 'v0.3.0', draft: true }), release({ tag_name: 'v0.3.0-beta', prerelease: true })]),
    );
    const notes = new ReleaseNotes(fetchImpl as unknown as typeof fetch);
    expect((await notes.list()).map((r) => r.version)).toEqual(['0.2.0']);
    await notes.list();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('explains when GitHub can’t be reached', async () => {
    const notes = new ReleaseNotes((async () => new Response('', { status: 503 })) as unknown as typeof fetch);
    await expect(notes.list()).rejects.toThrow(/Couldn’t load the release notes/);
  });
});
