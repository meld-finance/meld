import {
  ESTATE_DOCUMENT_LABELS,
  EstateCategory,
  isTrust,
  methodNamesPeople,
  type Beneficiary,
  type Child,
  type EstateDocument,
  type EstateDocumentKind,
  type EstateIssue,
  type EstateMethod,
  type EstateSettings,
  type EstateStatus,
  type EstateSummary,
  type EstateTarget,
} from '@meld/shared';

/** A target before its status is worked out. */
export type TargetDraft = Omit<EstateTarget, 'status' | 'trustName' | 'todo'> & {
  /** When Meld first saw the account, to call out new ones. */
  createdAt?: string;
};

export type EstateInput = {
  today: string;
  targets: TargetDraft[];
  documents: EstateDocument[];
  children: Child[];
  profileState: string | null;
  settings: EstateSettings;
  packet: { lastExportedAt: string | null; exportFingerprint: string | null; fingerprint: string };
};

/** Categories where the beneficiary form, not the will, decides who inherits. */
const NEEDS_BENEFICIARY = new Set<EstateCategory>(['retirement', 'hsa', 'life']);
/** Categories that go through probate unless set up to pass some other way. */
const PROBATE = new Set<EstateCategory>(['bank', 'taxable', 'property', 'education', 'other']);
const CATEGORY_ORDER = EstateCategory.options;
/** Accounts linked this recently are called out as new. */
const NEW_DAYS = 60;
/** A packet older than this is due for a fresh copy even if nothing changed. */
const PACKET_STALE_DAYS = 365;
const CORE_DOCUMENTS: EstateDocumentKind[] = ['will', 'financial_poa', 'healthcare_directive'];
/** Documents that say who inherits or raises the children, so a new child matters. */
const NAMES_HEIRS = new Set<EstateDocumentKind>(['will', 'revocable_trust', 'irrevocable_trust', 'guardianship']);
/** Documents drafted under one state's law. */
const STATE_LAW = new Set<EstateDocumentKind>(['will', 'revocable_trust', 'irrevocable_trust', 'financial_poa', 'healthcare_directive']);

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const yearsAgo = (today: string, years: number) => `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
const list = (names: string[], max = 4) =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const minorChildren = (children: Child[], today: string) => children.filter((c) => Number(today.slice(0, 4)) - c.birthYear < 18);

/** Minor children's first names, lowercased, for spotting them among beneficiaries. */
const firstNames = (children: Child[]) => children.flatMap((c) => (c.name ? [c.name.trim().split(/\s+/)[0]!.toLowerCase()] : []));

function shareProblem(beneficiaries: Beneficiary[]): string | null {
  for (const primary of [true, false]) {
    const group = beneficiaries.filter((b) => b.primary === primary);
    const total = group.reduce((sum, b) => sum + b.percentage, 0);
    if (group.length && Math.abs(total - 100) > 0.01) return `${primary ? 'Primary' : 'Contingent'} shares add up to ${total}%, not 100%.`;
  }
  return null;
}

/** What looks wrong with a target's named beneficiaries, if anything. */
function beneficiaryProblems(t: TargetDraft, minors: string[]): string[] {
  if (!methodNamesPeople(t.method)) return [];
  const problems: string[] = [];
  const share = shareProblem(t.beneficiaries);
  if (share) problems.push(share);
  if (t.beneficiaries.some((b) => /\bestate\b/i.test(b.name))) {
    problems.push('Your estate is named, so it goes through probate. Name people or your trust instead.');
  }
  const minor = t.beneficiaries.find((b) => {
    const words = b.name.toLowerCase().split(/\s+/);
    return minors.some((m) => words.includes(m));
  });
  if (minor) {
    problems.push(
      `${minor.name} is a minor. A child can’t take control of an inheritance, so a court may appoint someone to manage it. Name your trust, or a custodian under your state’s UTMA, instead.`,
    );
  }
  return problems;
}

function baseStatus(t: TargetDraft, hasRevocableTrust: boolean): EstateStatus {
  const primaries = t.beneficiaries.filter((b) => b.primary).length;
  const namesPeople = methodNamesPeople(t.method) && primaries > 0;
  const toTrust = t.method === 'trust' && t.trustId !== null;
  if (t.category === 'debt' || t.category === 'custodial') return 'n/a';
  if (t.category === 'vehicle') return t.designated ? 'ok' : 'n/a';
  if (NEEDS_BENEFICIARY.has(t.category)) return namesPeople || toTrust ? 'ok' : 'missing';
  if (t.category === 'education') return namesPeople || toTrust ? 'ok' : 'review';
  if (namesPeople || toTrust || t.method === 'joint_survivorship') return 'ok';
  // Leaving it to the will is a choice, unless there's a trust it should be funded into.
  if (t.method === 'will') return hasRevocableTrust ? 'review' : 'ok';
  return 'review';
}

const MISSING_BODY: Partial<Record<EstateCategory, string>> = {
  retirement:
    'The beneficiary form decides who inherits a retirement account, not your will. Without one it usually goes to your estate, through probate, and your heirs may have to withdraw it faster.',
  hsa: 'Without a beneficiary, an HSA goes to your estate and is taxed as income. A spouse named as beneficiary keeps it as their own HSA.',
  life: 'Without a named beneficiary, the death benefit is paid to your estate and goes through probate. Update it with the insurer, then here.',
};

/** The one-line version shown on the target's own row. */
const MISSING_TODO: Partial<Record<EstateCategory, string>> = {
  retirement: 'Name a beneficiary with the plan. Without one it goes to your estate, through probate.',
  hsa: 'Name a beneficiary with the HSA. Without one it goes to your estate and is taxed as income.',
  life: 'Name a beneficiary with the insurer. Without one the death benefit goes through probate.',
};

/** Issues whose id ends in the target's or document's id, so they can be shown on its row. */
const SUBJECT_PREFIXES = ['review:', 'missing:', 'stale:', 'child:', 'state:'];

/** Statuses, issues and readiness for everything Meld knows about. Pure, so it's easy to test. */
export function summarizeEstate(input: EstateInput): Omit<EstateSummary, 'documents' | 'settings'> {
  const { today, documents, settings } = input;
  const issues: Omit<EstateIssue, 'subject'>[] = [];
  const trusts = new Map(documents.filter((d) => isTrust(d.kind)).map((d) => [d.id, d.name]));
  const hasRevocableTrust = documents.some((d) => d.kind === 'revocable_trust');
  const minors = minorChildren(input.children, today);
  const minorFirstNames = firstNames(minors);
  const reviewCutoff = yearsAgo(today, settings.reviewIntervalYears);

  const problemsById = new Map<string, string>();
  const statused = input.targets
    .map(({ createdAt, ...t }) => {
      let status: EstateStatus = baseStatus(t, hasRevocableTrust);
      const problems = status === 'ok' ? beneficiaryProblems(t, minorFirstNames) : [];
      if (problems.length) {
        status = 'review';
        problemsById.set(t.id, problems.join(' '));
        issues.push({ id: `review:${t.id}`, severity: 'info', title: `Check the beneficiaries on ${t.name}`, body: problems.join(' '), href: t.href });
      }
      if (status === 'missing') {
        const isNew = createdAt && daysBetween(createdAt, today) <= NEW_DAYS;
        issues.push({
          id: `missing:${t.id}`,
          severity: 'warning',
          title: isNew ? `New account: name a beneficiary for ${t.name}` : `${t.name} has no beneficiary`,
          body: MISSING_BODY[t.category] ?? '',
          href: t.href,
        });
      }
      return { ...t, trustName: t.trustId ? (trusts.get(t.trustId) ?? null) : null, status };
    })
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));

  const probate = statused.filter((t) => t.status === 'review' && PROBATE.has(t.category) && !issues.some((i) => i.id === `review:${t.id}`));
  if (probate.length) {
    const education = probate.filter((t) => t.category === 'education');
    issues.push({
      id: 'probate',
      severity: 'info',
      title: hasRevocableTrust
        ? `Fund your trust: ${plural(probate.length, 'account or asset is', 'accounts and assets are')} outside it`
        : `${plural(probate.length, 'account or asset', 'accounts and assets')} would go through probate`,
      body: [
        `${list(probate.map((t) => t.name))}.`,
        hasRevocableTrust
          ? 'Retitle them to your trust (or name it as the TOD/POD beneficiary) so they skip probate.'
          : 'Add a transfer- or payable-on-death beneficiary with the bank or brokerage, a TOD deed for property where your state allows it, or title them to a trust.',
        education.length ? 'For a 529, name a successor owner so it isn’t stuck in probate.' : '',
        'If you’ve decided to leave something to your will, mark it “By will”.',
      ]
        .filter(Boolean)
        .join(' '),
      href: '/plan?tab=estate',
    });
  }

  const noContingent = statused.filter(
    (t) => t.status === 'ok' && NEEDS_BENEFICIARY.has(t.category) && methodNamesPeople(t.method) && !t.beneficiaries.some((b) => !b.primary),
  );
  if (noContingent.length) {
    issues.push({
      id: 'contingent',
      severity: 'info',
      title: `Add contingent beneficiaries to ${plural(noContingent.length, 'account or policy', 'accounts and policies')}`,
      body: `${list(noContingent.map((t) => t.name))}. If your primary beneficiary dies before or with you, these go to your estate instead.`,
      href: '/plan?tab=estate',
    });
  }

  const unreviewed = statused.filter((t) => t.kind !== 'policy' && t.designated && t.reviewedAt && t.reviewedAt < reviewCutoff);
  if (unreviewed.length) {
    issues.push({
      id: 'review-designations',
      severity: 'info',
      title: `Review beneficiaries on ${plural(unreviewed.length, 'account', 'accounts')}`,
      body: `${list(unreviewed.map((t) => t.name))}: last checked over ${settings.reviewIntervalYears} years ago. Compare them with the institution’s records, especially after a marriage, divorce, birth or death.`,
      href: '/plan?tab=estate',
    });
  }

  const probateIds = new Set(probate.map((t) => t.id));
  const noContingentIds = new Set(noContingent.map((t) => t.id));
  const unreviewedIds = new Set(unreviewed.map((t) => t.id));
  const todo = (t: (typeof statused)[number]): string | null => {
    if (problemsById.has(t.id)) return problemsById.get(t.id)!;
    if (t.status === 'missing') return MISSING_TODO[t.category] ?? 'Name a beneficiary.';
    if (probateIds.has(t.id)) {
      if (t.category === 'education') return 'Name a successor owner with the plan so it skips probate.';
      return hasRevocableTrust
        ? 'Outside your trust. Retitle it to the trust, or name the trust as its TOD/POD beneficiary.'
        : 'Would go through probate. Add a TOD/POD beneficiary with the institution, or mark it “By will” if that’s your plan.';
    }
    if (noContingentIds.has(t.id)) return 'No contingent beneficiary. If your primary beneficiary dies first, it goes to your estate.';
    if (unreviewedIds.has(t.id)) return `Last checked over ${settings.reviewIntervalYears} years ago. Compare it with the institution’s records.`;
    return null;
  };
  const targets: EstateTarget[] = statused.map((t) => ({ ...t, todo: todo(t) }));

  // --- Documents
  const kinds = new Set(documents.map((d) => d.kind));
  if (!kinds.has('will')) {
    issues.push({
      id: 'doc:will',
      severity: hasRevocableTrust ? 'info' : 'warning',
      title: hasRevocableTrust ? 'Add your pour-over will' : 'No will on file',
      body: hasRevocableTrust
        ? 'A pour-over will moves anything left outside your trust into it, and names guardians for minor children.'
        : 'Without a will, your state’s law decides who inherits anything that has no beneficiary, and a court picks guardians for minor children. Add it here once it’s signed.',
      href: '/estate/document/new?kind=will',
    });
  }
  if (!kinds.has('financial_poa')) {
    issues.push({
      id: 'doc:financial_poa',
      severity: 'info',
      title: 'No financial power of attorney on file',
      body: 'It lets someone you choose pay bills and manage accounts if you can’t. Without it, your family may need a court-appointed conservator.',
      href: '/estate/document/new?kind=financial_poa',
    });
  }
  if (!kinds.has('healthcare_directive')) {
    issues.push({
      id: 'doc:healthcare_directive',
      severity: 'info',
      title: 'No healthcare directive on file',
      body: 'It names who makes medical decisions for you and records your wishes for end-of-life care.',
      href: '/estate/document/new?kind=healthcare_directive',
    });
  }
  const guardianNamed = documents.some((d) => d.kind === 'guardianship' || d.people.some((p) => p.role === 'guardian'));
  if (minors.length && !guardianNamed) {
    issues.push({
      id: 'doc:guardianship',
      severity: 'warning',
      title: 'Name a guardian for your children',
      body: 'You have minor children and no guardian on file. Name one in your will or a separate nomination, and record who it is here.',
      href: kinds.has('will') ? `/estate/document/${documents.find((d) => d.kind === 'will')!.id}` : '/estate/document/new?kind=guardianship',
    });
  }

  for (const d of documents) {
    const label = ESTATE_DOCUMENT_LABELS[d.kind].toLowerCase();
    const href = `/estate/document/${d.id}`;
    const lastLook = d.reviewedAt ?? d.signedDate;
    if (lastLook && lastLook < reviewCutoff) {
      issues.push({
        id: `stale:${d.id}`,
        severity: 'info',
        title: `Review ${d.name}`,
        body: `It hasn’t been looked at in over ${settings.reviewIntervalYears} years. Check that the people it names and what it says still fit, then mark it reviewed.`,
        href,
      });
    }
    if (NAMES_HEIRS.has(d.kind) && d.signedDate) {
      const since = Number((d.reviewedAt ?? d.signedDate).slice(0, 4));
      const born = input.children.filter((c) => c.birthYear > since);
      if (born.length) {
        issues.push({
          id: `child:${d.id}`,
          severity: 'warning',
          title: `${d.name} predates ${born.length === 1 ? (born[0]!.name ?? 'a child') : 'some of your children'}`,
          body: `Your ${label} was signed before ${list(born.map((c) => c.name ?? `a child born ${c.birthYear}`))} was born. Check that it covers them, by name or as “my children”.`,
          href,
        });
      }
    }
    if (STATE_LAW.has(d.kind) && d.state && input.profileState && d.state !== input.profileState) {
      issues.push({
        id: `state:${d.id}`,
        severity: 'info',
        title: `${d.name} was drafted in ${d.state}`,
        body: `You live in ${input.profileState} now. Most states honor documents signed elsewhere, but powers of attorney and directives can run into trouble; ask an attorney in ${input.profileState} to look it over.`,
        href,
      });
    }
  }

  // --- Packet
  const { lastExportedAt, exportFingerprint, fingerprint } = input.packet;
  const changed = exportFingerprint !== fingerprint;
  const old = lastExportedAt !== null && daysBetween(lastExportedAt.slice(0, 10), today) > PACKET_STALE_DAYS;
  const stale = lastExportedAt === null || changed || old;
  if (lastExportedAt === null && targets.length) {
    issues.push({
      id: 'packet',
      severity: 'info',
      title: 'Export a family packet',
      body: 'Meld runs on this computer, so your family may not be able to open it. Export the packet, print it or store it with your will, and tell your executor where it is.',
      href: '/plan?tab=estate',
    });
  } else if (lastExportedAt !== null && (changed || old)) {
    issues.push({
      id: 'packet',
      severity: 'info',
      title: 'Your family packet is out of date',
      body: changed
        ? 'Accounts, beneficiaries, documents or contacts changed since you last exported it. Export a new copy and replace the old one.'
        : 'It’s over a year old. Export a new copy so balances and contacts are current.',
      href: '/plan?tab=estate',
    });
  }

  const applicable = targets.filter((t) => t.status !== 'n/a');
  const coreDocs = minors.length ? [...CORE_DOCUMENTS, 'guardianship' as const] : CORE_DOCUMENTS;
  const docsDone = coreDocs.filter((k) => (k === 'guardianship' ? guardianNamed : kinds.has(k))).length;
  const targetsDone = applicable.filter((t) => t.status === 'ok').length;
  const contacts = settings.contacts.length > 0;
  const severityRank = { warning: 0, info: 1 };
  return {
    asOf: today,
    targets,
    issues: issues
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
      .map((i) => {
        const prefix = SUBJECT_PREFIXES.find((p) => i.id.startsWith(p));
        return { ...i, subject: prefix ? i.id.slice(prefix.length) : null };
      }),
    readiness: {
      done: targetsDone + docsDone + (contacts ? 1 : 0) + (stale ? 0 : 1),
      total: applicable.length + coreDocs.length + 2,
      targets: { done: targetsDone, total: applicable.length },
      documents: { done: docsDone, total: coreDocs.length },
      contacts,
    },
    packet: { lastExportedAt, stale },
  };
}

/** How a policy passes: by its beneficiaries, set on the policy itself. */
export const policyMethod = (beneficiaries: Beneficiary[]): EstateMethod => (beneficiaries.length ? 'beneficiary' : 'none');
