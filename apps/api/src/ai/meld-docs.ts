import { MELD_DOC_GUIDES, MELD_DOC_SECTIONS, type MeldDocGuide, type MeldDocSection } from './meld-docs.generated';

export type MeldDocsInput = {
  query?: string;
  topic?: string;
  limit?: number;
};

type CompactSection = {
  id: string;
  doc: string;
  docTitle: string;
  heading: string;
  content: string;
};

type IndexedSection = {
  section: MeldDocSection;
  normHeading: string;
  normDocTitle: string;
  normBody: string;
  headingCounts: Map<string, number>;
  docCounts: Map<string, number>;
  bodyCounts: Map<string, number>;
};

const MAX_RETURN_CHARS = 7500;
const MIN_RELATIVE_SCORE = 0.35;

const STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'get',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'may',
  'me',
  'might',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'out',
  'should',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'up',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

const QUERY_ALIASES: Record<string, readonly string[]> = {
  notification: ['alert', 'push', 'ntfy'],
  notify: ['alert', 'push', 'ntfy'],
  backup: ['back', 'pg_dump', 'keychain'],
  password: ['passphrase', 'login'],
  mobile: ['phone', 'tailscale'],
  iphone: ['phone', 'tailscale'],
  android: ['phone', 'tailscale'],
  house: ['home', 'property'],
  car: ['vehicle'],
  ai: ['ask', 'claude', 'ollama', 'chatgpt'],
  llm: ['ask', 'claude', 'ollama', 'chatgpt'],
  import: ['plaid', 'link', 'sync'],
  csv: ['plaid', 'link', 'sync'],
  bank: ['plaid', 'link', 'sync'],
  rule: ['recategorize', 'category'],
  send: ['sent'],
};

const ING_NOUNS = new Set(['anything', 'checking', 'evening', 'everything', 'morning', 'nothing', 'recurring', 'setting', 'something']);
const BROAD_OVERVIEW_TERMS = new Set(['capability', 'doc', 'feature', 'guide', 'help', 'meld', 'overview', 'start']);

function stemToken(token: string): string {
  let w = token;
  if (w.length > 4 && w.endsWith('ies')) {
    w = `${w.slice(0, -3)}y`;
  } else if (w.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(w)) {
    w = w.slice(0, -2);
  } else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
    w = w.slice(0, -1);
  }
  if (w.length > 5 && w.endsWith('ing') && !ING_NOUNS.has(w)) {
    const base = w.slice(0, -3);
    w = /([bdgmnprt])\1$/.test(base) ? base.slice(0, -1) : base;
  }
  return w;
}

function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/(\d+)\(([a-z])\)/g, '$1$2')
    .replace(/[^\da-z_]+/g, ' ')
    .trim();
}

function tokenize(text: string, dropStopwords = true): string[] {
  const raw = normalizePhrase(text).split(/\s+/).filter(Boolean);
  const filtered = dropStopwords ? raw.filter((t) => !STOPWORDS.has(t)) : raw;
  const chosen = filtered.length > 0 ? filtered : raw;
  return chosen.map(stemToken);
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

const GUIDE_BY_SLUG = new Map<string, MeldDocGuide>(MELD_DOC_GUIDES.map((g) => [g.slug, g]));
const SECTION_BY_ID = new Map<string, MeldDocSection>(MELD_DOC_SECTIONS.map((s) => [s.id, s]));
const SECTIONS_BY_DOC = new Map<string, MeldDocSection[]>();
for (const section of MELD_DOC_SECTIONS) {
  const list = SECTIONS_BY_DOC.get(section.doc) ?? [];
  list.push(section);
  SECTIONS_BY_DOC.set(section.doc, list);
}

const INDEXED_SECTIONS: IndexedSection[] = MELD_DOC_SECTIONS.map((section) => ({
  section,
  normHeading: normalizePhrase(section.heading),
  normDocTitle: normalizePhrase(`${section.doc} ${section.docTitle}`),
  normBody: normalizePhrase(section.content),
  headingCounts: countTokens(tokenize(section.heading)),
  docCounts: countTokens(tokenize(`${section.doc} ${section.docTitle}`)),
  bodyCounts: countTokens(tokenize(section.content)),
}));

const DOC_FREQ = new Map<string, number>();
for (const entry of INDEXED_SECTIONS) {
  const unique = new Set([...entry.headingCounts.keys(), ...entry.docCounts.keys(), ...entry.bodyCounts.keys()]);
  for (const term of unique) DOC_FREQ.set(term, (DOC_FREQ.get(term) ?? 0) + 1);
}

function idf(term: string): number {
  const df = DOC_FREQ.get(term) ?? 0;
  return Math.log(1 + (INDEXED_SECTIONS.length - df + 0.5) / (df + 0.5));
}

function compactGuideIndex() {
  return MELD_DOC_GUIDES.map(({ slug, title, description, sections }) => ({
    slug,
    title,
    description,
    sections,
  }));
}

function compactSection(s: MeldDocSection): CompactSection {
  return {
    id: s.id,
    doc: s.doc,
    docTitle: s.docTitle,
    heading: s.heading,
    content: s.content,
  };
}

function fieldMatch(counts: Map<string, number>, term: string): { exactTf: number; hasPrefix: boolean } {
  const exactTf = counts.get(term) ?? 0;
  if (exactTf > 0) return { exactTf, hasPrefix: false };
  if (term.length < 4) return { exactTf: 0, hasPrefix: false };
  for (const key of counts.keys()) {
    if (key.length >= 4 && key.startsWith(term)) return { exactTf: 0, hasPrefix: true };
  }
  return { exactTf: 0, hasPrefix: false };
}

function searchSections(query: string, limit: number) {
  const normQuery = normalizePhrase(query);
  const originalTerms = [...new Set(tokenize(query))];
  if (originalTerms.length === 0) {
    return {
      guides: compactGuideIndex(),
      tip: 'Pass `query` to search across all guides or `topic` with a section id (e.g. "features/estate#family-packet") or guide slug (e.g. "features/estate", "plaid", "privacy").',
    };
  }
  if (originalTerms.every((t) => BROAD_OVERVIEW_TERMS.has(t))) {
    const overview = SECTION_BY_ID.get('features#overview');
    return {
      query,
      guides: compactGuideIndex(),
      sections: overview ? [compactSection(overview)] : ([] as CompactSection[]),
      note: 'Call get_meld_docs again with a specific `topic` section id (e.g. "features/estate#family-packet") or feature keyword for full details.',
    };
  }

  const termWeights = new Map<string, { weight: number; original: boolean }>();
  for (const term of originalTerms) {
    termWeights.set(term, { weight: 1, original: true });
    for (const alias of QUERY_ALIASES[term] ?? []) {
      const stemmed = stemToken(alias);
      if (!termWeights.has(stemmed)) termWeights.set(stemmed, { weight: 0.45, original: false });
    }
  }

  const scored: { section: MeldDocSection; score: number }[] = [];
  for (const entry of INDEXED_SECTIONS) {
    let score = 0;
    let matchedOriginal = 0;

    if (normQuery.includes(' ')) {
      if (entry.normHeading.includes(normQuery) || entry.normDocTitle.includes(normQuery)) score += 8;
      else if (entry.normBody.includes(normQuery)) score += 4;
    }

    for (const [term, meta] of termWeights) {
      const termIdf = idf(term);
      const h = fieldMatch(entry.headingCounts, term);
      const d = fieldMatch(entry.docCounts, term);
      const b = fieldMatch(entry.bodyCounts, term);

      let termScore = 0;
      if (h.exactTf > 0) termScore += 3.5 * termIdf;
      else if (h.hasPrefix) termScore += 1.5 * termIdf;

      if (d.exactTf > 0) termScore += 2.0 * termIdf;
      else if (d.hasPrefix) termScore += 0.8 * termIdf;

      if (b.exactTf > 0) termScore += 1.0 * termIdf * (b.exactTf / (b.exactTf + 1.5));
      else if (b.hasPrefix) termScore += 0.5 * termIdf;

      if (termScore > 0) {
        score += termScore * meta.weight;
        if (meta.original) matchedOriginal++;
      }
    }

    if (score > 0) {
      const coverage = 0.5 + 0.5 * (matchedOriginal / originalTerms.length);
      scored.push({ section: entry.section, score: score * coverage });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      query,
      sections: [] as CompactSection[],
      guides: compactGuideIndex(),
      note: 'No matching documentation section found. Check the guide index above or let the user know if Meld does not document this feature.',
    };
  }

  const topScore = scored[0]!.score;
  const maxSections = Math.max(1, Math.min(5, limit));
  const selected: MeldDocSection[] = [];
  let usedChars = 0;

  for (const candidate of scored) {
    if (selected.length >= maxSections) break;
    if (selected.length > 0 && candidate.score < topScore * MIN_RELATIVE_SCORE) break;
    const nextChars = candidate.section.content.length;
    if (selected.length > 0 && usedChars + nextChars > MAX_RETURN_CHARS) break;
    selected.push(candidate.section);
    usedChars += nextChars;
  }

  const selectedIds = new Set(selected.map((s) => s.id));
  const otherMatches = scored
    .filter((c) => !selectedIds.has(c.section.id))
    .slice(0, 4)
    .map(({ section }) => ({ id: section.id, doc: section.doc, heading: section.heading }));

  return {
    query,
    sections: selected.map(compactSection),
    ...(otherMatches.length ? { otherMatches } : {}),
  };
}

/** Human-readable status label shown in Ask Meld while looking up docs. */
export function formatDocsToolLabel(input: MeldDocsInput): string {
  const query = input.query?.trim();
  if (query) return `Checked Meld guide for “${query}”`;

  const topic = input.topic?.trim().toLowerCase();
  if (topic) {
    const section = SECTION_BY_ID.get(topic);
    if (section) return `Checked Meld guide: ${section.heading}`;
    const guide = GUIDE_BY_SLUG.get(topic);
    if (guide) return `Checked Meld guide: ${guide.title}`;
    return `Checked Meld guide for “${input.topic!.trim()}”`;
  }

  return 'Checked Meld feature guide';
}

/** Searches or retrieves Meld's canonical documentation sections within a strict context budget. */
export function lookupMeldDocs(input: MeldDocsInput = {}) {
  const limit = input.limit ?? 3;
  const topicRaw = input.topic?.trim();
  const queryRaw = input.query?.trim();

  if (topicRaw) {
    const topic = topicRaw.toLowerCase();
    const section = SECTION_BY_ID.get(topic);
    if (section) {
      return { sections: [compactSection(section)] };
    }

    const guide = GUIDE_BY_SLUG.get(topic);
    if (guide) {
      const guideSections = SECTIONS_BY_DOC.get(guide.slug) ?? [];
      const totalChars = guideSections.reduce((sum, s) => sum + s.content.length, 0);
      if (totalChars <= MAX_RETURN_CHARS) {
        return {
          guide: { slug: guide.slug, title: guide.title, description: guide.description },
          sections: guideSections.map(compactSection),
        };
      }
      return {
        guide: {
          slug: guide.slug,
          title: guide.title,
          description: guide.description,
          sections: guide.sections,
        },
        note: 'This guide is large; call get_meld_docs again with a specific section id in `topic` (e.g. "features/estate#family-packet") or keywords in `query`.',
      };
    }

    if (!queryRaw) {
      return searchSections(topicRaw, limit);
    }
  }

  if (queryRaw) {
    return searchSections(queryRaw, limit);
  }

  return {
    guides: compactGuideIndex(),
    tip: 'Pass `query` to search across all guides or `topic` with a section id (e.g. "features/estate#family-packet") or guide slug (e.g. "features/estate", "plaid", "privacy").',
  };
}
