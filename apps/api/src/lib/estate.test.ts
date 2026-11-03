import { EMPTY_ESTATE_SETTINGS, type EstateDocument, type EstateDocumentInput } from '@meld/shared';
import { describe, expect, it } from 'vitest';
import { summarizeEstate, type EstateInput, type TargetDraft } from './estate';

const TODAY = '2026-11-02';
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const target = (extra: Partial<TargetDraft> & Pick<TargetDraft, 'name' | 'category'>): TargetDraft => ({
  kind: 'account',
  id: uuid(),
  detail: '',
  value: 10_000,
  method: 'none',
  beneficiaries: [],
  trustId: null,
  reviewedAt: null,
  notes: null,
  designated: false,
  href: '/estate/account/x',
  ...extra,
});

const doc = (kind: EstateDocumentInput['kind'], extra: Partial<EstateDocument> = {}): EstateDocument => ({
  id: uuid(),
  kind,
  name: kind,
  signedDate: '2024-03-01',
  state: 'CA',
  reviewedAt: null,
  originalLocation: null,
  people: [],
  attorney: null,
  documentId: null,
  documentFilename: null,
  notes: null,
  createdAt: '2024-03-01T00:00:00Z',
  updatedAt: '2024-03-01T00:00:00Z',
  ...extra,
});

const spouse = { name: 'Sam Doe', relationship: 'Spouse', percentage: 100, primary: true };
const sibling = { name: 'Pat Doe', relationship: 'Sibling', percentage: 100, primary: false };

function run(extra: Partial<EstateInput>) {
  return summarizeEstate({
    today: TODAY,
    targets: [],
    documents: [doc('will'), doc('financial_poa'), doc('healthcare_directive')],
    children: [],
    profileState: 'CA',
    settings: EMPTY_ESTATE_SETTINGS,
    packet: { lastExportedAt: '2026-10-01T00:00:00Z', exportFingerprint: 'f', fingerprint: 'f' },
    ...extra,
  });
}
const ids = (r: ReturnType<typeof run>) => r.issues.map((i) => i.id);

describe('summarizeEstate', () => {
  it('flags a retirement account with no beneficiary, and calls out a new one', () => {
    const old = target({ name: 'Old IRA', category: 'retirement', createdAt: '2025-01-01' });
    const fresh = target({ name: 'New 401k', category: 'retirement', createdAt: '2026-10-20' });
    const r = run({ targets: [old, fresh] });
    expect(r.targets.map((t) => t.status)).toEqual(['missing', 'missing']);
    const titles = r.issues.filter((i) => i.severity === 'warning').map((i) => i.title);
    expect(titles).toEqual(['Old IRA has no beneficiary', 'New account: name a beneficiary for New 401k']);
    expect(r.targets[0]).not.toHaveProperty('createdAt');
  });

  it('counts a trust as the beneficiary, and a designation with people as set up', () => {
    const trust = doc('revocable_trust', { name: 'Doe Family Trust' });
    const r = run({
      documents: [trust, doc('will'), doc('financial_poa'), doc('healthcare_directive')],
      targets: [
        target({ name: 'IRA', category: 'retirement', method: 'beneficiary', beneficiaries: [spouse, sibling], designated: true }),
        target({ name: 'Roth', category: 'retirement', method: 'trust', trustId: trust.id, designated: true }),
      ],
    });
    expect(r.targets.map((t) => [t.name, t.status, t.trustName])).toEqual([
      ['IRA', 'ok', null],
      ['Roth', 'ok', 'Doe Family Trust'],
    ]);
    expect(r.issues).toEqual([]);
    expect(r.readiness).toEqual({ done: 6, total: 6 });
  });

  it('checks shares, estates named as beneficiary, and minors named directly', () => {
    const r = run({
      children: [{ id: 'c1', name: 'Emma', birthYear: 2015 }],
      documents: [doc('will', { people: [{ name: 'Lee', role: 'guardian', relationship: null, phone: null, email: null }] }), doc('financial_poa'), doc('healthcare_directive')],
      targets: [
        target({ name: 'Split', category: 'retirement', method: 'beneficiary', beneficiaries: [{ ...spouse, percentage: 60 }], designated: true }),
        target({ name: 'Estate', category: 'life', kind: 'policy', method: 'beneficiary', beneficiaries: [{ ...spouse, name: 'Estate of Alex Doe' }], designated: true }),
        target({ name: 'Kid', category: 'retirement', method: 'beneficiary', beneficiaries: [{ ...spouse, name: 'Emma Doe' }], designated: true }),
      ],
    });
    const body = (name: string) => r.issues.find((i) => i.title === `Check the beneficiaries on ${name}`)?.body;
    expect(body('Split')).toContain('Primary shares add up to 60%');
    expect(body('Estate')).toContain('goes through probate');
    expect(body('Kid')).toContain('Emma Doe is a minor');
    expect(r.targets.every((t) => t.status === 'review')).toBe(true);
  });

  it('groups accounts that would go through probate, and asks to fund the trust once there is one', () => {
    const targets = [
      target({ name: 'Checking', category: 'bank' }),
      target({ name: 'Brokerage', category: 'taxable', method: 'tod_pod', beneficiaries: [spouse], designated: true }),
      target({ name: 'House', category: 'property', kind: 'asset', method: 'will', designated: true }),
      target({ name: 'Car', category: 'vehicle', kind: 'asset' }),
      target({ name: 'Mortgage', category: 'debt' }),
    ];
    const without = run({ targets });
    expect(without.targets.map((t) => [t.name, t.status])).toEqual([
      ['Brokerage', 'ok'],
      ['Checking', 'review'],
      ['House', 'ok'],
      ['Car', 'n/a'],
      ['Mortgage', 'n/a'],
    ]);
    expect(without.issues.find((i) => i.id === 'probate')?.title).toBe('1 account or asset would go through probate');

    const withTrust = run({ targets, documents: [doc('revocable_trust'), doc('will'), doc('financial_poa'), doc('healthcare_directive')] });
    const probate = withTrust.issues.find((i) => i.id === 'probate')!;
    expect(probate.title).toBe('Fund your trust: 2 accounts and assets are outside it');
    expect(probate.body).toMatch(/^Checking, House\./);
  });

  it('asks for core documents and a guardian when there are minor children', () => {
    const r = run({ documents: [], children: [{ id: 'c1', name: null, birthYear: 2020 }] });
    expect(ids(r)).toEqual(['doc:will', 'doc:guardianship', 'doc:financial_poa', 'doc:healthcare_directive']);
    expect(r.readiness).toEqual({ done: 1, total: 5 });
  });

  it('flags old documents, children born after signing, and documents from another state', () => {
    const will = doc('will', { signedDate: '2019-05-01', state: 'NY' });
    const r = run({
      documents: [will, doc('financial_poa'), doc('healthcare_directive')],
      children: [{ id: 'c1', name: 'Max', birthYear: 2021 }],
      profileState: 'CA',
    });
    expect(ids(r)).toEqual(['doc:guardianship', `child:${will.id}`, `stale:${will.id}`, `state:${will.id}`]);
    expect(r.issues[1]!.body).toContain('before Max was born');

    // Reviewing it after the birth clears both.
    const reviewed = run({ documents: [{ ...will, reviewedAt: '2025-06-01', state: 'CA' }, doc('financial_poa'), doc('healthcare_directive')], children: [{ id: 'c1', name: 'Max', birthYear: 2021 }] });
    expect(ids(reviewed)).toEqual(['doc:guardianship']);
  });

  it('knows when the packet is missing, changed or old', () => {
    const targets = [target({ name: 'IRA', category: 'retirement', method: 'beneficiary', beneficiaries: [spouse, sibling], designated: true })];
    const never = run({ targets, packet: { lastExportedAt: null, exportFingerprint: null, fingerprint: 'a' } });
    expect(never.issues.map((i) => i.title)).toEqual(['Export a family packet']);
    expect(never.packet.stale).toBe(true);

    const changed = run({ targets, packet: { lastExportedAt: '2026-10-01T00:00:00Z', exportFingerprint: 'a', fingerprint: 'b' } });
    expect(changed.issues[0]!.body).toContain('changed since you last exported');

    const old = run({ targets, packet: { lastExportedAt: '2025-09-01T00:00:00Z', exportFingerprint: 'a', fingerprint: 'a' } });
    expect(old.issues[0]!.body).toContain('over a year old');

    const current = run({ targets });
    expect(current.packet.stale).toBe(false);
    expect(current.issues).toEqual([]);
  });
});
