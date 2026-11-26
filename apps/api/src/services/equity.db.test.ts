import { EMPTY_TAX_SETTINGS, type EquityGrant, type EquityGrantExtraction, type EquitySummary } from '@meld/shared';
import type { PlaidApi } from 'plaid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChatTools, runTool } from '../ai/chat-tools';
import type { AIProvider } from '../ai/provider';
import { accounts, documents, equityGrants, holdings, priceHistory, securities, userProfile } from '../db/schema';
import { loadEnv } from '../env';
import { buildServer } from '../server';
import type { DocumentStorage } from '../storage';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { confirmVest, createGrant, getEquitySummary } from './equity';
import { getInvestmentsSummary } from './investments';
import { getNetWorth } from './overview';
import { pruneOrphanDocuments } from '../routes/insurance';
import { getTaxPlan, saveTaxSettings } from './tax';

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

const PDF = Buffer.from('%PDF-1.7\nfake grant\n%%EOF');

const fakeAI: AIProvider = {
  name: 'fake',
  listChatModels: async () => [],
  extractInsurancePolicy: () => Promise.reject(new Error('not used')),
  async extractEquityGrantFromPdf() {
    return {
      draft: {
        kind: 'rsu',
        employer: 'Acme Corp',
        name: '2026 Grant',
        ticker: 'ACME',
        manualPrice: null,
        priceAsOf: null,
        grantDate: '2026-01-15',
        grantNumberMask: '4321',
        totalShares: 400,
        linkedAccountId: null,
        withholdingMethod: 'sell_to_cover',
        federalWithholdingRate: null,
        stateWithholdingRate: null,
        status: 'active',
        notes: null,
        vests: [
          { vestDate: '2026-05-15', shares: 100, status: 'scheduled', vestPrice: null, sharesWithheld: null, taxWithheld: null },
          { vestDate: '2026-11-15', shares: 100, status: 'scheduled', vestPrice: null, sharesWithheld: null, taxWithheld: null },
          { vestDate: '2027-05-15', shares: 200, status: 'scheduled', vestPrice: null, sharesWithheld: null, taxWithheld: null },
        ],
      },
      warnings: [],
    };
  },
  async extractEquityGrantFromText() {
    return this.extractEquityGrantFromPdf(PDF);
  },
  estimatePropertyValue: () => Promise.reject(new Error('not used')),
  estimateVehicleValue: () => Promise.reject(new Error('not used')),
  profileSecurities: () => Promise.reject(new Error('not used')),
  chat: () => Promise.reject(new Error('not used')),
};

function pdfForm(data = PDF) {
  const form = new FormData();
  form.append('file', new Blob([data], { type: 'application/pdf' }), 'grant.pdf');
  return form;
}

const TODAY = '2026-06-30';

describe.skipIf(!testDatabaseUrl)('equity grants, vested guard & tax integration (Postgres)', () => {
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

  it('extracts PDF/table drafts, persists grants & documents, protects docs from pruning, and confirms vests', async () => {
    const extractRes = await app.inject({ method: 'POST', url: '/equity/extract', headers, payload: pdfForm() });
    expect(extractRes.statusCode).toBe(200);
    const extracted = extractRes.json<EquityGrantExtraction>();
    expect(extracted.draft).toMatchObject({ employer: 'Acme Corp', ticker: 'ACME', documentId: extracted.documentId });
    expect(storage.files.size).toBe(1);

    const textRes = await app.inject({
      method: 'POST',
      url: '/equity/extract-text',
      headers,
      payload: { text: '2026-05-15 100 shares ACME' },
    });
    expect(textRes.statusCode).toBe(200);
    expect(textRes.json<EquityGrantExtraction>().documentId).toBeNull();

    // Seed cached price history so getGrant/getEquitySummary don't need network access.
    await ctx.db.insert(priceHistory).values({
      ticker: 'ACME',
      closes: { '2026-05-15': 100, '2026-06-30': 120 },
      fetchedAt: new Date(),
    });

    const saveRes = await app.inject({ method: 'POST', url: '/equity', headers, payload: extracted.draft });
    expect(saveRes.statusCode).toBe(200);
    const created = saveRes.json<EquityGrant>();
    expect(created.vests).toHaveLength(3);

    // Attached grant PDFs must NOT be deleted by pruneOrphanDocuments.
    expect(await pruneOrphanDocuments(ctx.db, storage, -1000)).toBe(0);
    expect(storage.files.size).toBe(1);

    const summary = await getEquitySummary(ctx.db, async () => null, TODAY, { refresh: 'none' });
    expect(summary.grants).toHaveLength(1);
    const g = summary.grants[0]!;
    expect(g.currentPrice).toBe(120);
    expect(g.vests[0]).toMatchObject({ vestDate: '2026-05-15', needsConfirmation: true, price: 100, grossValue: 10_000 });
    expect(g.unvestedShares).toBe(400);
    expect(summary.totalUnvestedGross).toBe(10_000 + 300 * 120);

    // Confirming the May vest updates vestedShares and marks it confirmed.
    const confirmed = await confirmVest(
      ctx.db,
      g.vests[0]!.id,
      { status: 'vested', vestPrice: 105, sharesWithheld: null, taxWithheld: 3500 },
      async () => null,
      TODAY,
      { refresh: 'none' },
    );
    expect(confirmed.vestedShares).toBe(100);
    expect(confirmed.unvestedShares).toBe(300);

    // Deleting the grant cleans up the attached document.
    const delRes = await app.inject({ method: 'DELETE', url: `/equity/${created.id}`, headers });
    expect(delRes.statusCode).toBe(200);
    expect(storage.files.size).toBe(0);
    expect(await ctx.db.select().from(documents)).toEqual([]);
    expect(await ctx.db.select().from(equityGrants)).toEqual([]);

    const routeSummary = await app.inject({ method: 'GET', url: '/equity', headers });
    expect(routeSummary.statusCode).toBe(200);
    expect(routeSummary.json<EquitySummary>().grants).toEqual([]);
  });

  it('excludes unvested RSUs and Plaid unvested stock-plan excess from Net Worth and portfolio totals', async () => {
    const [stockPlan, brokerage] = await ctx.db
      .insert(accounts)
      .values([
        { source: 'plaid', name: 'E*TRADE Stock Plan', type: 'investment', subtype: 'stock plan', currentBalance: 50_000 },
        { source: 'plaid', name: 'Fidelity Brokerage', type: 'investment', subtype: 'brokerage', currentBalance: 10_000 },
      ])
      .returning({ id: accounts.id });
    const [acme, vti] = await ctx.db
      .insert(securities)
      .values([
        { tickerSymbol: 'ACME', name: 'Acme Corp', type: 'equity' },
        { tickerSymbol: 'VTI', name: 'Total Market', type: 'etf' },
      ])
      .returning({ id: securities.id });
    await ctx.db.insert(holdings).values([
      // 500 total shares ($50k), only 100 shares ($10k) vested.
      { accountId: stockPlan!.id, securityId: acme!.id, quantity: 500, institutionPrice: 100, institutionValue: 50_000, vestedQuantity: 100, vestedValue: 10_000 },
      { accountId: brokerage!.id, securityId: vti!.id, quantity: 100, institutionPrice: 100, institutionValue: 10_000 },
    ]);

    await createGrant(
      ctx.db,
      {
        kind: 'rsu',
        employer: 'Acme Corp',
        name: '2026 RSU',
        ticker: 'ACME',
        manualPrice: 100,
        priceAsOf: TODAY,
        grantDate: '2026-01-01',
        grantNumberMask: null,
        totalShares: 400,
        linkedAccountId: stockPlan!.id,
        withholdingMethod: 'sell_to_cover',
        federalWithholdingRate: 22,
        stateWithholdingRate: 10.23,
        status: 'active',
        documentId: null,
        notes: null,
        vests: [{ vestDate: '2027-01-01', shares: 400, status: 'scheduled', vestPrice: null, sharesWithheld: null, taxWithheld: null }],
      },
      async () => null,
      TODAY,
      { refresh: 'none' },
    );

    const nw = await getNetWorth(ctx.db);
    // Only the $10k vested portion of Stock Plan + $10k Brokerage count; $40k unvested + manual $40k RSU grant stay out.
    expect(nw.netWorth).toBe(20_000);

    const inv = await getInvestmentsSummary(ctx.db, null, TODAY);
    expect(inv.totalValue).toBe(20_000);
    expect(inv.holdings.find((h) => h.accountId === stockPlan!.id)).toMatchObject({ quantity: 100, value: 10_000 });
  });

  it('adds RSU vesting to Tax income, detects withholding gap & $0 basis, flags RSU wash sales, and exposes get_equity_grants', async () => {
    await ctx.db.insert(userProfile).values({
      id: 1,
      filingStatus: 'single',
      state: 'CA',
      annualGrossIncome: 300_000,
      birthYear: 1988,
    });
    const [brokerage] = await ctx.db
      .insert(accounts)
      .values({ source: 'manual', name: 'Brokerage', type: 'investment', subtype: 'brokerage', currentBalance: 20_000 })
      .returning({ id: accounts.id });
    const [acme, lossStock] = await ctx.db
      .insert(securities)
      .values([
        { tickerSymbol: 'ACME', name: 'Acme Corp', type: 'equity' },
        { tickerSymbol: 'ACME', name: 'Acme Corp Loss Lot', type: 'equity' },
      ])
      .returning({ id: securities.id });
    await ctx.db.insert(holdings).values([
      { accountId: brokerage!.id, securityId: acme!.id, quantity: 100, institutionValue: 10_000, costBasis: 0 },
      { accountId: brokerage!.id, securityId: lossStock!.id, quantity: 100, institutionValue: 8_000, costBasis: 12_000 },
    ]);
    await ctx.db.insert(priceHistory).values({
      ticker: 'ACME',
      closes: { '2026-06-15': 100, '2026-06-30': 100 },
      fetchedAt: new Date(),
    });

    await createGrant(
      ctx.db,
      {
        kind: 'rsu',
        employer: 'Acme Corp',
        name: '2026 RSU',
        ticker: 'ACME',
        manualPrice: null,
        priceAsOf: null,
        grantDate: '2025-01-01',
        grantNumberMask: null,
        totalShares: 1000,
        linkedAccountId: brokerage!.id,
        withholdingMethod: 'sell_to_cover',
        federalWithholdingRate: 22,
        stateWithholdingRate: 10.23,
        status: 'active',
        documentId: null,
        notes: null,
        vests: [
          { vestDate: '2026-06-15', shares: 500, status: 'vested', vestPrice: 100, sharesWithheld: null, taxWithheld: null },
          { vestDate: '2026-07-15', shares: 500, status: 'scheduled', vestPrice: null, sharesWithheld: null, taxWithheld: null },
        ],
      },
      async () => null,
      TODAY,
      { refresh: 'none' },
    );

    const plan = await getTaxPlan(ctx.db, 2026, TODAY);
    expect(plan.income?.wages).toBe(300_000);
    expect(plan.income?.rsuVesting).toBe(100_000);
    expect(plan.detected.rsuVestedYtd).toBe(50_000);
    expect(plan.detected.rsuScheduledRemaining).toBe(50_000);
    // 22% + 10.23% = 32.23% on $100k = $32,230; at $300k-$400k single CA (35% fed + 9.3% CA + 0.9% Addl Medicare, partially offset by SALT), gap is ~$9.9k.
    expect(plan.detected.rsuWithholdingGap).toBeGreaterThan(9_000);
    expect(plan.detected.rsuZeroBasisTickers).toEqual(['ACME']);
    expect(plan.suggestions.map((s) => s.id)).toEqual(expect.arrayContaining(['rsu-withholding-gap', 'rsu-cost-basis']));
    expect(plan.harvest[0]).toMatchObject({ recentVest: '2026-06-15', upcomingVest: '2026-07-15' });

    // Flipping profileIncludesRsus carves the $100k RSUs out of profile gross income so total income stays $300k.
    await saveTaxSettings(ctx.db, 2026, { ...EMPTY_TAX_SETTINGS, profileIncludesRsus: true });
    const carved = await getTaxPlan(ctx.db, 2026, TODAY);
    expect(carved.income?.wages).toBe(200_000);
    expect(carved.income?.rsuVesting).toBe(100_000);

    // Ask Meld / MCP tool exposes the grant summary cleanly.
    const tools = createChatTools(ctx.db);
    const equityTool = tools.find((t) => t.name === 'get_equity_grants');
    const toolRes = await runTool(equityTool, { includeVests: false });
    expect(toolRes.isError).toBe(false);
    expect(JSON.parse(toolRes.content)).toMatchObject({
      totalUnvestedGross: 50_000,
      grants: [expect.objectContaining({ employer: 'Acme Corp', ticker: 'ACME' })],
    });
  });
});
