import { describe, expect, it } from 'vitest';
import { formatDocsToolLabel, lookupMeldDocs } from './meld-docs';
import { MELD_DOC_GUIDES, MELD_DOC_SECTIONS } from './meld-docs.generated';

const USER_FACING_GUIDE_SLUGS = [
  'install',
  'plaid',
  'phone-access',
  'docker',
  'features',
  'features/demo',
  'features/accounts',
  'features/home-and-spending',
  'features/recurring-and-alerts',
  'features/cash',
  'features/investments',
  'features/retirement',
  'features/tax',
  'features/insurance',
  'features/estate',
  'features/ask-meld',
  'features/mcp',
  'privacy',
  'security',
] as const;

describe('generated Meld docs', () => {
  it('includes user-facing guides and excludes developer-only docs', () => {
    expect(MELD_DOC_GUIDES.map((g) => g.slug)).toEqual([...USER_FACING_GUIDE_SLUGS]);
  });

  it('preserves pre-H2 overview content such as the PRIVACY.md external services table', () => {
    const privacyOverview = MELD_DOC_SECTIONS.find((s) => s.id === 'privacy#overview');
    expect(privacyOverview).toBeDefined();
    expect(privacyOverview!.content).toContain('| **Plaid**');
    expect(privacyOverview!.content).toContain('| **Anthropic**');
    expect(privacyOverview!.content).toContain('| **Ollama**');
  });
});

describe('lookupMeldDocs', () => {
  it('returns a compact guide index with no section bodies when called without inputs', () => {
    const res = lookupMeldDocs({}) as unknown as {
      guides: readonly { slug: string; sections: readonly unknown[] }[];
      tip: string;
    };
    expect(res.guides).toHaveLength(USER_FACING_GUIDE_SLUGS.length);
    expect(JSON.stringify(res).length).toBeLessThan(13000);
    expect(JSON.stringify(res)).not.toContain('"content"');
  });

  it('returns a single section for an exact section id', () => {
    const res = lookupMeldDocs({ topic: 'features/estate#family-packet' }) as unknown as {
      sections: { id: string; content: string }[];
    };
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0]!.id).toBe('features/estate#family-packet');
    expect(res.sections[0]!.content).toContain('Export PDF');
  });

  it('returns full sections for feature guides and setup guides', () => {
    for (const slug of ['install', 'plaid', 'phone-access', 'docker', 'privacy', 'security', 'features/estate']) {
      const res = lookupMeldDocs({ topic: slug }) as unknown as {
        guide: { slug: string };
        sections?: unknown[];
      };
      expect(res.guide.slug).toBe(slug);
      expect(res.sections?.length).toBeGreaterThan(0);
      expect(JSON.stringify(res).length).toBeLessThan(9000);
    }

    const features = lookupMeldDocs({ topic: 'features' }) as unknown as {
      guide: { slug: string; sections?: readonly { id: string }[] };
      sections?: { id: string }[];
      note?: string;
    };
    expect(features.guide.slug).toBe('features');
    expect(features.sections?.length).toBeGreaterThan(0);
    expect(features.sections?.some((s) => s.id === 'features#guides' || s.id === 'features#overview')).toBe(true);
  });

  it('falls back to keyword search when topic is not an exact guide slug or section id', () => {
    const res = lookupMeldDocs({ topic: 'autopay' }) as unknown as { sections: { id: string }[] };
    expect(res.sections[0]!.id.startsWith('features/recurring-and-alerts#')).toBe(true);
  });

  it('returns compact overview and guide list for broad feature-list queries', () => {
    const res = lookupMeldDocs({ query: 'What features does Meld have?' }) as unknown as {
      guides: readonly { slug: string }[];
      sections: { id: string }[];
    };
    expect(res.guides).toHaveLength(USER_FACING_GUIDE_SLUGS.length);
    expect(res.sections.map((s) => s.id)).toEqual(['features#overview']);
    expect(JSON.stringify(res).length).toBeLessThan(13000);
  });

  it.each([
    ['How do updates work?', ['install#updates']],
    ['How do I keep Meld running?', ['install#keep-it-running']],
    ['How do I set up autopay tracking and alerts?', ['features/recurring-and-alerts#']],
    ['How do category rules work?', ['features/home-and-spending#']],
    ['How do I access Meld from my phone?', ['phone-access#turn-on-phone-access-mac--windows-app', 'docker#phone-access-over-tailscale']],
    ['What data does Meld send to AI providers?', ['features/ask-meld#', 'privacy#overview']],
    ['How do I link my bank accounts with Plaid?', ['features/accounts#', 'plaid#']],
    ['How do smart alerts and ntfy phone notifications work?', ['features/recurring-and-alerts#']],
    ['How do I back up Docker?', ['docker#back-up']],
    ['How does the estate checklist and family packet PDF work?', ['features/estate#']],
    ['phone access docker', ['docker#phone-access-over-tailscale']],
  ])('matches "%s" within budget', (query, expectedIdPrefixes) => {
    const res = lookupMeldDocs({ query }) as { sections: { id: string }[] };
    const returnedIds = res.sections.map((s) => s.id);
    expect(expectedIdPrefixes.some((prefix) => returnedIds.some((id) => id === prefix || id.startsWith(prefix)))).toBe(
      true,
    );
    expect(JSON.stringify(res).length).toBeLessThan(8500);
  });

  it('returns empty sections and the guide outline when nothing matches', () => {
    const res = lookupMeldDocs({ query: 'quantum blockchain mining' }) as {
      sections: unknown[];
      guides: unknown[];
      note: string;
    };
    expect(res.sections).toEqual([]);
    expect(res.guides).toHaveLength(USER_FACING_GUIDE_SLUGS.length);
    expect(res.note).toContain('No matching documentation section found');
  });
});

describe('formatDocsToolLabel', () => {
  it('formats labels for query, section id, guide slug, unknown topic, and empty input', () => {
    expect(formatDocsToolLabel({ query: 'autopay' })).toBe('Checked Meld guide for “autopay”');
    expect(formatDocsToolLabel({ topic: 'features/estate#family-packet' })).toBe('Checked Meld guide: Family packet');
    expect(formatDocsToolLabel({ topic: 'plaid' })).toBe('Checked Meld guide: Plaid Bank Setup');
    expect(formatDocsToolLabel({ topic: 'custom' })).toBe('Checked Meld guide for “custom”');
    expect(formatDocsToolLabel({})).toBe('Checked Meld feature guide');
  });
});
