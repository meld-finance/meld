import type { EstateDocument, EstateDocumentInput, EstateSummary, UploadedDocument } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { PlaidApi } from 'plaid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, alerts, estateDesignations, manualAssets } from '../db/schema';
import { loadEnv } from '../env';
import { buildServer } from '../server';
import { evaluateAlerts } from '../services/alerts';
import type { DocumentStorage } from '../storage';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { pruneOrphanDocuments } from './insurance';

class MemoryStorage implements DocumentStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    const data = this.files.get(key);
    if (!data) throw new Error('missing');
    return data;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

const PDF = Buffer.from('%PDF-1.7\nscanned will\n%%EOF');
const spouse = { name: 'Sam Doe', relationship: 'Spouse', percentage: 100, primary: true };
const will: EstateDocumentInput = {
  kind: 'will',
  name: 'Last will',
  signedDate: '2024-03-01',
  state: null,
  reviewedAt: null,
  originalLocation: 'Fireproof safe',
  people: [{ name: 'Pat Doe', role: 'executor', relationship: 'Sibling', phone: '555-0100', email: null }],
  attorney: null,
  documentId: null,
  notes: null,
};

describe.skipIf(!testDatabaseUrl)('estate routes (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let headers: Record<string, string>;
  let ira: string;
  const storage = new MemoryStorage();

  beforeAll(async () => {
    ctx = await setupTestDb();
    const env = loadEnv({ ...process.env, DATABASE_URL: testDatabaseUrl });
    const plaid = {} as PlaidApi;
    app = await buildServer({ env, db: ctx.db, plaid, sync: { db: ctx.db, plaid, encryptionKey: env.ENCRYPTION_KEY }, ai: null, storage });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: env.APP_PASSPHRASE } });
    headers = { authorization: `Bearer ${login.json().token}` };
  });
  afterAll(async () => {
    await app?.close();
    await ctx?.sql.end();
  });
  beforeEach(async () => {
    await ctx.reset();
    storage.files.clear();
    const [row] = await ctx.db
      .insert(accounts)
      .values({ source: 'manual', name: 'Rollover IRA', type: 'investment', subtype: 'ira', currentBalance: 120_000 })
      .returning({ id: accounts.id });
    ira = row!.id;
  });

  const summary = async () => (await app.inject({ method: 'GET', url: '/estate', headers })).json<EstateSummary>();
  const designate = (payload: object) => app.inject({ method: 'PUT', url: '/estate/designations', headers, payload });

  it('records a beneficiary, which clears the warning and the alert', async () => {
    let s = await summary();
    expect(s.targets.find((t) => t.id === ira)).toMatchObject({ category: 'retirement', status: 'missing', designated: false });
    await evaluateAlerts(ctx.db, async () => {});
    expect((await ctx.db.select().from(alerts)).map((a) => [a.key, a.title])).toEqual([['estate:beneficiaries', 'Rollover IRA has no beneficiary']]);

    const base = { accountId: ira, manualAssetId: null, trustId: null, reviewedAt: '2026-11-01', notes: null };
    expect((await designate({ ...base, method: 'beneficiary', beneficiaries: [spouse] })).statusCode).toBe(200);
    // Saving again updates the same row.
    await designate({ ...base, method: 'beneficiary', beneficiaries: [spouse, { ...spouse, name: 'Pat Doe', primary: false }] });
    expect(await ctx.db.select().from(estateDesignations)).toHaveLength(1);

    s = await summary();
    expect(s.targets.find((t) => t.id === ira)).toMatchObject({ status: 'ok', method: 'beneficiary', designated: true });
    await evaluateAlerts(ctx.db, async () => {});
    expect((await ctx.db.select().from(alerts))[0]!.resolvedAt).not.toBeNull();

    // Deleting the account takes its designation with it.
    await ctx.db.delete(accounts).where(eq(accounts.id, ira));
    expect(await ctx.db.select().from(estateDesignations)).toEqual([]);
  });

  it('validates designations', async () => {
    const both = await designate({ accountId: ira, manualAssetId: ira, method: 'none', beneficiaries: [], trustId: null, reviewedAt: null, notes: null });
    expect(both.statusCode).toBe(400);
    const notATrust = await app.inject({ method: 'POST', url: '/estate/documents', headers, payload: will });
    const res = await designate({ accountId: ira, manualAssetId: null, method: 'trust', beneficiaries: [], trustId: notATrust.json<EstateDocument>().id, reviewedAt: null, notes: null });
    expect(res.statusCode).toBe(400);
  });

  it('titles a home to a trust and keeps the trust’s scanned copy until the trust is deleted', async () => {
    const form = new FormData();
    form.append('file', new Blob([PDF], { type: 'application/pdf' }), 'trust.pdf');
    const upload = (await app.inject({ method: 'POST', url: '/documents', headers, payload: form })).json<UploadedDocument>();
    const trust = (
      await app.inject({
        method: 'POST',
        url: '/estate/documents',
        headers,
        payload: { ...will, kind: 'revocable_trust', name: 'Doe Family Trust', people: [], documentId: upload.documentId },
      })
    ).json<EstateDocument>();
    expect(trust.documentFilename).toBe('trust.pdf');

    const [home] = await ctx.db.insert(manualAssets).values({ kind: 'home', name: 'House', value: 900_000 }).returning({ id: manualAssets.id });
    await designate({ accountId: null, manualAssetId: home!.id, method: 'trust', beneficiaries: [spouse], trustId: trust.id, reviewedAt: null, notes: null });
    const house = (await summary()).targets.find((t) => t.id === home!.id)!;
    // Beneficiaries don't apply to a trust.
    expect(house).toMatchObject({ status: 'ok', trustName: 'Doe Family Trust', beneficiaries: [] });

    // An attached upload isn't pruned as an orphan.
    expect(await pruneOrphanDocuments(ctx.db, storage, -1)).toBe(0);
    expect(storage.files.size).toBe(1);

    await app.inject({ method: 'DELETE', url: `/estate/documents/${trust.id}`, headers });
    expect(storage.files.size).toBe(0);
    expect((await summary()).targets.find((t) => t.id === home!.id)).toMatchObject({ trustId: null, status: 'review' });
  });

  it('exports the packet, encrypted with a password, and notices when it goes stale', async () => {
    await app.inject({ method: 'POST', url: '/estate/documents', headers, payload: will });
    await app.inject({
      method: 'PUT',
      url: '/estate/settings',
      headers,
      payload: { contacts: [{ role: 'attorney', name: 'Lee Law', relationship: null, phone: '555-0199', email: null }], credentialsNote: '1Password family vault', instructions: 'Call Lee first.', reviewIntervalYears: 3 },
    });
    expect((await summary()).packet).toEqual({ lastExportedAt: null, stale: true });

    const plain = await app.inject({ method: 'POST', url: '/estate/packet', headers, payload: { password: null } });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-type']).toBe('application/pdf');
    expect(plain.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(plain.rawPayload.includes('/Encrypt')).toBe(false);
    expect((await summary()).packet.stale).toBe(false);

    const locked = await app.inject({ method: 'POST', url: '/estate/packet', headers, payload: { password: 'correct horse' } });
    expect(locked.rawPayload.includes('/Encrypt')).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/estate/packet', headers, payload: { password: '123' } })).statusCode).toBe(400);

    // A balance change doesn't make it stale; a new beneficiary does.
    await ctx.db.update(accounts).set({ currentBalance: 130_000 }).where(eq(accounts.id, ira));
    expect((await summary()).packet.stale).toBe(false);
    await designate({ accountId: ira, manualAssetId: null, method: 'beneficiary', beneficiaries: [spouse], trustId: null, reviewedAt: null, notes: null });
    const s = await summary();
    expect(s.packet.stale).toBe(true);
    expect(s.issues.find((i) => i.id === 'packet')?.title).toBe('Your family packet is out of date');
  });
});
