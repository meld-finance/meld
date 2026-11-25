import { describe, expect, it } from 'vitest';
import { formatDocsToolLabel, lookupMeldDocs } from './meld-docs';
import { MELD_DOC_GUIDES, MELD_DOC_SECTIONS } from './meld-docs.generated';

describe('generated Meld docs', () => {
  it('includes the 7 user-facing guides and excludes developer-only docs', () => {
    expect(MELD_DOC_GUIDES.map((g) => g.slug)).toEqual([
      'install',
      'features',
      'plaid',
      'phone-access',
      'docker',
      'privacy',
      'security',
    ]);
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
    expect(res.guides).toHaveLength(7);
    expect(JSON.stringify(res).length).toBeLessThan(5500);
    expect(JSON.stringify(res)).not.toContain('"content"');
  });

  it('returns a single section for an exact section id', () => {
    const res = lookupMeldDocs({ topic: 'features#plan-estate' }) as unknown as {
      sections: { id: string; content: string }[];
    };
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0]!.id).toBe('features#plan-estate');
    expect(res.sections[0]!.content).toContain('Family packet');
  });

  it('returns full sections for compact guides and an outline for the large features guide', () => {
    for (const slug of ['install', 'plaid', 'phone-access', 'docker', 'privacy', 'security']) {
      const res = lookupMeldDocs({ topic: slug }) as unknown as {
        guide: { slug: string };
        sections?: unknown[];
      };
      expect(res.guide.slug).toBe(slug);
      expect(res.sections?.length).toBeGreaterThan(0);
      expect(JSON.stringify(res).length).toBeLessThan(7000);
    }

    const features = lookupMeldDocs({ topic: 'features' }) as unknown as {
      guide: { slug: string; sections: readonly { id: string }[] };
      sections?: unknown;
      note: string;
    };
    expect(features.guide.slug).toBe('features');
    expect(features.sections).toBeUndefined();
    expect(features.guide.sections.some((s) => s.id === 'features#plan-estate')).toBe(true);
    expect(features.note).toContain('get_meld_docs');
  });

  it('falls back to keyword search when topic is not an exact guide slug or section id', () => {
    const res = lookupMeldDocs({ topic: 'autopay' }) as unknown as { sections: { id: string }[] };
    expect(res.sections[0]!.id).toBe('features#recurring-payments-autopay--alerts');
  });

  it('returns compact overview and guide list for broad feature-list queries', () => {
    const res = lookupMeldDocs({ query: 'What features does Meld have?' }) as unknown as {
      guides: readonly { slug: string }[];
      sections: { id: string }[];
    };
    expect(res.guides).toHaveLength(7);
    expect(res.sections.map((s) => s.id)).toEqual(['features#overview']);
    expect(JSON.stringify(res).length).toBeLessThan(5500);
  });

  it.each([
    ['How do updates work?', ['install#updates']],
    ['How do I keep Meld running?', ['install#keep-it-running']],
    ['How do I set up autopay tracking and alerts?', ['features#recurring-payments-autopay--alerts']],
    ['How do category rules work?', ['features#overview--budgets']],
    ['How do I access Meld from my phone?', ['phone-access#turn-on-phone-access-mac--windows-app', 'docker#phone-access-over-tailscale']],
    ['What data does Meld send to AI providers?', ['features#ask-meld-ai-chat', 'privacy#overview']],
    ['How do I link my bank accounts with Plaid?', ['features#linking-accounts-plaid', 'plaid#2-your-real-accounts-trial-plan']],
    ['How do smart alerts and ntfy phone notifications work?', ['features#recurring-payments-autopay--alerts']],
    ['How do I back up Docker?', ['docker#back-up']],
    ['How does the estate checklist and family packet PDF work?', ['features#plan-estate']],
    ['phone access docker', ['docker#phone-access-over-tailscale']],
  ])('matches "%s" within budget', (query, expectedIds) => {
    const res = lookupMeldDocs({ query }) as { sections: { id: string }[] };
    const returnedIds = res.sections.map((s) => s.id);
    expect(expectedIds.some((id) => returnedIds.includes(id))).toBe(true);
    expect(JSON.stringify(res).length).toBeLessThan(8500);
  });

  it('returns empty sections and the guide outline when nothing matches', () => {
    const res = lookupMeldDocs({ query: 'quantum blockchain mining' }) as {
      sections: unknown[];
      guides: unknown[];
      note: string;
    };
    expect(res.sections).toEqual([]);
    expect(res.guides).toHaveLength(7);
    expect(res.note).toContain('No matching documentation section found');
  });
});

describe('formatDocsToolLabel', () => {
  it('formats labels for query, section id, guide slug, unknown topic, and empty input', () => {
    expect(formatDocsToolLabel({ query: 'autopay' })).toBe('Checked Meld guide for “autopay”');
    expect(formatDocsToolLabel({ topic: 'features#plan-estate' })).toBe('Checked Meld guide: Plan: estate');
    expect(formatDocsToolLabel({ topic: 'plaid' })).toBe('Checked Meld guide: Plaid Bank Setup');
    expect(formatDocsToolLabel({ topic: 'custom' })).toBe('Checked Meld guide for “custom”');
    expect(formatDocsToolLabel({})).toBe('Checked Meld feature guide');
  });
});
