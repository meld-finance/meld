import type { InsurancePolicy, InsurancePolicyInput, PolicyExtraction } from '@meld/shared';
import type { PlaidApi } from 'plaid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AIProvider } from '../ai/provider';
import { documents } from '../db/schema';
import { loadEnv } from '../env';
import { buildServer } from '../server';
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

const PDF = Buffer.from('%PDF-1.7\nfake policy\n%%EOF');

const fakeAI: AIProvider = {
  name: 'fake',
  async extractInsurancePolicy() {
    return {
      draft: {
        type: 'life_term',
        carrier: 'Acme Life',
        policyNumberMask: '4321',
        insuredName: 'Alex Doe',
        coverageAmount: 1_000_000,
        benefitPercentOfIncome: null,
        premiumAmount: 55,
        premiumFrequency: 'monthly',
        effectiveDate: '2020-05-01',
        termEndDate: '2040-05-01',
        eliminationPeriodDays: null,
        benefitPeriod: null,
        ownOccupation: null,
        employerProvided: false,
        cashValue: null,
        beneficiaries: [{ name: 'Sam Doe', relationship: 'Spouse', percentage: 100, primary: true }],
        notes: null,
      },
      warnings: ['Term end date computed from a 20-year term.'],
    };
  },
  chat: () => Promise.reject(new Error('not used')),
};

function pdfForm(data = PDF) {
  const form = new FormData();
  form.append('file', new Blob([data], { type: 'application/pdf' }), 'policy.pdf');
  return form;
}

describe.skipIf(!testDatabaseUrl)('insurance routes (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let headers: Record<string, string>;
  const storage = new MemoryStorage();

  beforeAll(async () => {
    ctx = await setupTestDb();
    const env = loadEnv({ ...process.env, DATABASE_URL: testDatabaseUrl });
    const plaid = {} as PlaidApi;
    app = await buildServer({
      env,
      db: ctx.db,
      plaid,
      sync: { db: ctx.db, plaid, encryptionKey: env.ENCRYPTION_KEY },
      ai: fakeAI,
      storage,
    });
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
  });

  async function extract() {
    const res = await app.inject({ method: 'POST', url: '/insurance/extract', headers, payload: pdfForm() });
    expect(res.statusCode).toBe(200);
    return res.json<PolicyExtraction>();
  }

  it('extracts a draft, saves it, serves the document, and cleans up on delete', async () => {
    const extraction = await extract();
    expect(extraction.draft).toMatchObject({ carrier: 'Acme Life', documentId: extraction.documentId });
    expect(storage.files.size).toBe(1);

    // Nothing is a policy until the user confirms.
    expect((await app.inject({ method: 'GET', url: '/insurance', headers })).json()).toEqual([]);

    const saved = await app.inject({ method: 'POST', url: '/insurance', headers, payload: extraction.draft });
    expect(saved.statusCode).toBe(200);
    const policy = saved.json<InsurancePolicy>();
    expect(policy).toMatchObject({ carrier: 'Acme Life', documentFilename: 'policy.pdf', policyNumberMask: '4321' });

    const doc = await app.inject({ method: 'GET', url: `/documents/${extraction.documentId}`, headers });
    expect(doc.headers['content-type']).toBe('application/pdf');
    expect(doc.rawPayload.equals(PDF)).toBe(true);

    // A document attached to a policy survives a discard request.
    await app.inject({ method: 'DELETE', url: `/documents/${extraction.documentId}`, headers });
    expect(storage.files.size).toBe(1);

    await app.inject({ method: 'DELETE', url: `/insurance/${policy.id}`, headers });
    expect(storage.files.size).toBe(0);
    expect(await ctx.db.select().from(documents)).toEqual([]);
  });

  it('discards a cancelled draft’s upload', async () => {
    const extraction = await extract();
    await app.inject({ method: 'DELETE', url: `/documents/${extraction.documentId}`, headers });
    expect(storage.files.size).toBe(0);
  });

  it('prunes old uploads that never became policies', async () => {
    await extract();
    expect(await pruneOrphanDocuments(ctx.db, storage)).toBe(0);
    expect(await pruneOrphanDocuments(ctx.db, storage, -1000)).toBe(1);
    expect(storage.files.size).toBe(0);
  });

  it('rejects files that aren’t PDFs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/insurance/extract',
      headers,
      payload: pdfForm(Buffer.from('<html>not a pdf</html>')),
    });
    expect(res.statusCode).toBe(400);
    expect(storage.files.size).toBe(0);
  });

  it('masks policy numbers on manual entry and validates input', async () => {
    const input: InsurancePolicyInput = { ...(await fakeAI.extractInsurancePolicy(PDF)).draft, documentId: null };
    const res = await app.inject({
      method: 'POST',
      url: '/insurance',
      headers,
      payload: { ...input, policyNumberMask: '9876' },
    });
    expect(res.json().policyNumberMask).toBe('9876');

    const tooLong = await app.inject({ method: 'POST', url: '/insurance', headers, payload: { ...input, policyNumberMask: '123456789' } });
    expect(tooLong.statusCode).toBe(400);
    const noCarrier = await app.inject({ method: 'POST', url: '/insurance', headers, payload: { ...input, carrier: ' ' } });
    expect(noCarrier.statusCode).toBe(400);
  });

  it('updates a policy in place', async () => {
    const input: InsurancePolicyInput = { ...(await fakeAI.extractInsurancePolicy(PDF)).draft, documentId: null };
    const created = (await app.inject({ method: 'POST', url: '/insurance', headers, payload: input })).json<InsurancePolicy>();
    const updated = await app.inject({
      method: 'PUT',
      url: `/insurance/${created.id}`,
      headers,
      payload: { ...input, coverageAmount: 750_000 },
    });
    expect(updated.json()).toMatchObject({ id: created.id, coverageAmount: 750_000 });
  });
});
