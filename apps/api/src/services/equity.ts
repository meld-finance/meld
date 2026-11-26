import {
  addMonthsUtc,
  DEFAULT_FEDERAL_SUPPLEMENTAL_RATE,
  defaultSupplementalStateRate,
  MEDICARE_RATE,
  type EquityGrant,
  type EquityGrantInput,
  type EquityGrantStatus,
  type EquityNextVest,
  type EquityPriceSource,
  type EquitySummary,
  type EquityTickerBreakdown,
  type EquityTimelineBucket,
  type EquityVest,
  type EquityVestConfirmInput,
  type EquityVestStatus,
  type WithholdingMethod,
} from '@meld/shared';
import { asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, documents, equityGrants, equityVests, investmentTransactions, priceHistory, securities } from '../db/schema';
import { HttpError } from '../lib/http';
import { localDate } from '../lib/networth';
import { fetchYahooCloses, type FetchCloses } from '../lib/prices';
import { shiftYears } from './overview';
import { addDays, daysBetween, refreshPrices } from './performance';
import { getProfile } from './profile';

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const normalizeTicker = (t: string | null | undefined) => {
  const s = t?.trim().toUpperCase();
  return s || null;
};

export type EquityOptions = {
  /** 'blocking' awaits Yahoo closes; 'background' uses cached closes and refreshes asynchronously; 'none' skips fetching. */
  refresh?: 'blocking' | 'background' | 'none';
};

type GrantRow = typeof equityGrants.$inferSelect;
type VestRow = typeof equityVests.$inferSelect;

function latestCloseOnOrBefore(closes: Record<string, number> | undefined, targetDate: string, maxAgeDays?: number): { date: string; price: number } | null {
  if (!closes) return null;
  if (closes[targetDate] !== undefined && closes[targetDate]! > 0) {
    return { date: targetDate, price: closes[targetDate]! };
  }
  let bestDate = '';
  let bestPrice = 0;
  for (const [d, p] of Object.entries(closes)) {
    if (d <= targetDate && p > 0 && d > bestDate) {
      bestDate = d;
      bestPrice = p;
    }
  }
  if (!bestDate) return null;
  if (maxAgeDays !== undefined && daysBetween(bestDate, targetDate) > maxAgeDays) return null;
  return { date: bestDate, price: bestPrice };
}

function incomeTaxWithholdingForVest(
  vest: Pick<VestRow, 'vestPrice' | 'sharesWithheld' | 'taxWithheld'>,
  price: number | null,
  gross: number | null,
  fedRate: number,
  stateRate: number,
): number {
  if (gross === null || gross <= 0) return 0;
  const incomeTaxRate = fedRate + stateRate;
  const allInRate = incomeTaxRate + MEDICARE_RATE;
  if (vest.taxWithheld !== null) {
    return allInRate > 0 ? round2(vest.taxWithheld * (incomeTaxRate / allInRate)) : 0;
  }
  if (vest.sharesWithheld !== null && price !== null) {
    return allInRate > 0 ? round2(vest.sharesWithheld * price * (incomeTaxRate / allInRate)) : 0;
  }
  return round2(gross * (incomeTaxRate / 100));
}

function enrichGrant(
  row: GrantRow & { documentFilename: string | null; linkedAccountName: string | null },
  vestRows: VestRow[],
  closesByTicker: Map<string, Record<string, number>>,
  securityFallbackByTicker: Map<string, { price: number; asOf: string | null }>,
  defaultStateRate: number,
  today: string,
): EquityGrant {
  const ticker = normalizeTicker(row.ticker);
  const closes = ticker ? closesByTicker.get(ticker) : undefined;
  const marketLatest = latestCloseOnOrBefore(closes, today);
  const secFallback = ticker ? securityFallbackByTicker.get(ticker) : undefined;

  let currentPrice: number | null = null;
  let priceSource: EquityPriceSource = 'none';
  let effectivePriceAsOf: string | null = null;
  if (marketLatest) {
    currentPrice = marketLatest.price;
    priceSource = 'market';
    effectivePriceAsOf = marketLatest.date;
  } else if (secFallback && secFallback.price > 0) {
    currentPrice = secFallback.price;
    priceSource = 'market';
    effectivePriceAsOf = secFallback.asOf;
  } else if (row.manualPrice !== null) {
    currentPrice = row.manualPrice;
    priceSource = 'manual';
    effectivePriceAsOf = row.priceAsOf;
  }

  const fedRate = row.federalWithholdingRate ?? DEFAULT_FEDERAL_SUPPLEMENTAL_RATE;
  const stateRate = row.stateWithholdingRate ?? defaultStateRate;
  const allInRate = fedRate + stateRate + MEDICARE_RATE;
  const grantStatus = row.status as EquityGrantStatus;

  const vests: EquityVest[] = vestRows.map((v) => {
    const vestStatus = v.status as EquityVestStatus;
    let price: number | null = null;
    let vestPriceSource: EquityPriceSource = 'none';
    if (v.vestPrice !== null) {
      price = v.vestPrice;
      vestPriceSource = 'recorded';
    } else if (v.vestDate <= today && closes) {
      const hist = latestCloseOnOrBefore(closes, v.vestDate, 14);
      if (hist) {
        price = hist.price;
        vestPriceSource = 'market';
      } else {
        price = currentPrice;
        vestPriceSource = priceSource;
      }
    } else {
      price = currentPrice;
      vestPriceSource = priceSource;
    }

    const grossValue = price !== null ? round2(v.shares * price) : null;
    let estimatedWithholding: number | null = null;
    if (grossValue !== null) {
      if (v.taxWithheld !== null) {
        estimatedWithholding = round2(v.taxWithheld);
      } else if (v.sharesWithheld !== null && price !== null) {
        estimatedWithholding = round2(v.sharesWithheld * price);
      } else {
        estimatedWithholding = round2(grossValue * (allInRate / 100));
      }
    }
    const estimatedNetValue = grossValue !== null && estimatedWithholding !== null ? round2(Math.max(0, grossValue - estimatedWithholding)) : null;

    return {
      id: v.id,
      grantId: v.grantId,
      vestDate: v.vestDate,
      shares: v.shares,
      status: vestStatus,
      vestPrice: v.vestPrice,
      sharesWithheld: v.sharesWithheld,
      taxWithheld: v.taxWithheld,
      matchedTxnId: v.matchedTxnId,
      price,
      priceSource: vestPriceSource,
      grossValue,
      estimatedWithholding,
      estimatedNetValue,
      needsConfirmation: grantStatus !== 'forfeited' && vestStatus === 'scheduled' && v.vestDate <= today,
    };
  });

  const vestedShares = round4(vests.filter((v) => v.status === 'vested').reduce((s, v) => s + v.shares, 0));
  const scheduledVests = grantStatus === 'forfeited' ? [] : vests.filter((v) => v.status === 'scheduled');
  const unvestedShares = round4(scheduledVests.reduce((s, v) => s + v.shares, 0));
  const forfeitedShares = round4(
    vests.filter((v) => v.status === 'forfeited' || (grantStatus === 'forfeited' && v.status === 'scheduled')).reduce((s, v) => s + v.shares, 0),
  );

  const pricedScheduled = scheduledVests.filter((v) => v.grossValue !== null && v.estimatedNetValue !== null);
  const unvestedGrossValue =
    scheduledVests.length === 0 ? 0 : pricedScheduled.length > 0 ? round2(pricedScheduled.reduce((s, v) => s + v.grossValue!, 0)) : null;
  const unvestedNetValue =
    scheduledVests.length === 0 ? 0 : pricedScheduled.length > 0 ? round2(pricedScheduled.reduce((s, v) => s + v.estimatedNetValue!, 0)) : null;

  const upcoming = scheduledVests.find((v) => v.vestDate > today) ?? scheduledVests[0] ?? null;

  return {
    id: row.id,
    kind: row.kind as EquityGrant['kind'],
    employer: row.employer,
    name: row.name,
    ticker,
    manualPrice: row.manualPrice,
    priceAsOf: row.priceAsOf,
    grantDate: row.grantDate,
    grantNumberMask: row.grantNumberMask,
    totalShares: row.totalShares,
    linkedAccountId: row.linkedAccountId,
    withholdingMethod: row.withholdingMethod as WithholdingMethod,
    federalWithholdingRate: row.federalWithholdingRate,
    stateWithholdingRate: row.stateWithholdingRate,
    status: grantStatus,
    documentId: row.documentId,
    notes: row.notes,
    documentFilename: row.documentFilename,
    linkedAccountName: row.linkedAccountName,
    currentPrice,
    priceSource,
    effectivePriceAsOf,
    vestedShares,
    unvestedShares,
    forfeitedShares,
    unvestedGrossValue,
    unvestedNetValue,
    nextVestDate: upcoming?.vestDate ?? null,
    nextVestShares: upcoming?.shares ?? null,
    nextVestGrossValue: upcoming?.grossValue ?? null,
    vests,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function quarterKey(date: string): { key: string; label: string; startDate: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const q = Math.floor((month - 1) / 3) + 1;
  const startMonth = String((q - 1) * 3 + 1).padStart(2, '0');
  return { key: `${year}-Q${q}`, label: `Q${q} ${year}`, startDate: `${year}-${startMonth}-01` };
}

function nextQuarterKey(key: string): { key: string; label: string; startDate: string } {
  const [yStr, qStr] = key.split('-Q') as [string, string];
  let y = Number(yStr);
  let q = Number(qStr) + 1;
  if (q > 4) {
    q = 1;
    y += 1;
  }
  const startMonth = String((q - 1) * 3 + 1).padStart(2, '0');
  return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, startDate: `${y}-${startMonth}-01` };
}

function buildTimelines(grants: EquityGrant[], today: string): { quarterlyTimeline: EquityTimelineBucket[]; yearlyTimeline: EquityTimelineBucket[] } {
  const scheduledItems: { grant: EquityGrant; vest: EquityVest }[] = [];
  for (const grant of grants) {
    if (grant.status === 'forfeited') continue;
    for (const vest of grant.vests) {
      if (vest.status === 'scheduled') scheduledItems.push({ grant, vest });
    }
  }
  if (!scheduledItems.length) return { quarterlyTimeline: [], yearlyTimeline: [] };

  const qBuckets = new Map<string, EquityTimelineBucket>();
  const yBuckets = new Map<string, EquityTimelineBucket>();

  const addToBucket = (
    map: Map<string, EquityTimelineBucket>,
    meta: { key: string; label: string; startDate: string },
    grant: EquityGrant,
    vest: EquityVest,
  ) => {
    let b = map.get(meta.key);
    if (!b) {
      b = { key: meta.key, label: meta.label, startDate: meta.startDate, totalGross: 0, totalNet: 0, totalShares: 0, byGrant: [] };
      map.set(meta.key, b);
    }
    const gross = vest.grossValue ?? 0;
    const net = vest.estimatedNetValue ?? 0;
    b.totalGross = round2(b.totalGross + gross);
    b.totalNet = round2(b.totalNet + net);
    b.totalShares = round4(b.totalShares + vest.shares);
    const existing = b.byGrant.find((g) => g.grantId === grant.id);
    if (existing) {
      existing.gross = round2(existing.gross + gross);
      existing.net = round2(existing.net + net);
      existing.shares = round4(existing.shares + vest.shares);
    } else {
      b.byGrant.push({
        grantId: grant.id,
        label: `${grant.employer} · ${grant.name}`,
        ticker: grant.ticker,
        gross,
        net,
        shares: vest.shares,
      });
    }
  };

  for (const { grant, vest } of scheduledItems) {
    addToBucket(qBuckets, quarterKey(vest.vestDate), grant, vest);
    const y = vest.vestDate.slice(0, 4);
    addToBucket(yBuckets, { key: y, label: y, startDate: `${y}-01-01` }, grant, vest);
  }

  // Fill intermediate empty quarters/years so vesting cliffs are visually true to time.
  const qKeys = [...qBuckets.keys()].sort();
  const currentQ = quarterKey(today).key;
  const firstQ = qKeys[0]! < currentQ ? qKeys[0]! : currentQ;
  const lastQ = qKeys.at(-1)!;
  const quarterlyTimeline: EquityTimelineBucket[] = [];
  for (let cur = quarterKey(`${firstQ.slice(0, 4)}-${String((Number(firstQ.slice(6)) - 1) * 3 + 1).padStart(2, '0')}-01`); cur.key <= lastQ && quarterlyTimeline.length < 24; cur = nextQuarterKey(cur.key)) {
    quarterlyTimeline.push(qBuckets.get(cur.key) ?? { ...cur, totalGross: 0, totalNet: 0, totalShares: 0, byGrant: [] });
  }

  const yKeys = [...yBuckets.keys()].sort();
  const firstYear = Math.min(Number(today.slice(0, 4)), Number(yKeys[0]!));
  const lastYear = Number(yKeys.at(-1)!);
  const yearlyTimeline: EquityTimelineBucket[] = [];
  for (let y = firstYear; y <= lastYear && yearlyTimeline.length < 12; y++) {
    const k = String(y);
    yearlyTimeline.push(yBuckets.get(k) ?? { key: k, label: k, startDate: `${k}-01-01`, totalGross: 0, totalNet: 0, totalShares: 0, byGrant: [] });
  }

  return { quarterlyTimeline, yearlyTimeline };
}

async function loadAndEnrichGrants(
  db: Db,
  fetchCloses: FetchCloses,
  today: string,
  options: EquityOptions,
  grantId?: string,
) {
  const [grantRows, vestRows, profile] = await Promise.all([
    db
      .select({
        grant: equityGrants,
        documentFilename: documents.filename,
        linkedAccountName: accounts.name,
      })
      .from(equityGrants)
      .leftJoin(documents, eq(documents.id, equityGrants.documentId))
      .leftJoin(accounts, eq(accounts.id, equityGrants.linkedAccountId))
      .where(grantId ? eq(equityGrants.id, grantId) : undefined)
      .orderBy(desc(equityGrants.grantDate), asc(equityGrants.employer)),
    db
      .select()
      .from(equityVests)
      .where(grantId ? eq(equityVests.grantId, grantId) : undefined)
      .orderBy(asc(equityVests.vestDate), asc(equityVests.id)),
    getProfile(db),
  ]);

  if (grantId && grantRows.length === 0) return { grants: [] as EquityGrant[], vestRowsByGrant: new Map<string, VestRow[]>(), closesByTicker: new Map<string, Record<string, number>>(), defaultStateRate: defaultSupplementalStateRate(profile.state) };

  const tickers = [...new Set(grantRows.map((r) => normalizeTicker(r.grant.ticker)).filter((t): t is string => t !== null))];
  const twoYearsAgo = shiftYears(today, -2);
  let earliestNeeded = addDays(today, -14);
  for (const v of vestRows) {
    if (v.vestPrice === null && v.vestDate <= today && v.vestDate < earliestNeeded) {
      earliestNeeded = v.vestDate < twoYearsAgo ? twoYearsAgo : v.vestDate;
    }
  }

  const refreshMode = options.refresh ?? 'blocking';
  if (tickers.length) {
    if (refreshMode === 'blocking') {
      await refreshPrices(db, tickers, earliestNeeded, today, fetchCloses);
    } else if (refreshMode === 'background') {
      void refreshPrices(db, tickers, earliestNeeded, today, fetchCloses).catch(() => {});
    }
  }

  const [priceRows, secRows] = tickers.length
    ? await Promise.all([
        db.select().from(priceHistory).where(inArray(priceHistory.ticker, tickers)),
        db
          .select({ ticker: securities.tickerSymbol, closePrice: securities.closePrice, closePriceAsOf: securities.closePriceAsOf })
          .from(securities)
          .where(isNotNull(securities.closePrice)),
      ])
    : [[], []];

  const closesByTicker = new Map<string, Record<string, number>>();
  for (const p of priceRows) {
    if (p.closes) closesByTicker.set(p.ticker.toUpperCase(), p.closes);
  }
  const securityFallbackByTicker = new Map<string, { price: number; asOf: string | null }>();
  for (const s of secRows) {
    const t = normalizeTicker(s.ticker);
    if (!t || !s.closePrice || s.closePrice <= 0) continue;
    const prev = securityFallbackByTicker.get(t);
    if (!prev || ((s.closePriceAsOf ?? '') > (prev.asOf ?? ''))) {
      securityFallbackByTicker.set(t, { price: s.closePrice, asOf: s.closePriceAsOf });
    }
  }

  const vestRowsByGrant = new Map<string, VestRow[]>();
  for (const v of vestRows) {
    vestRowsByGrant.set(v.grantId, [...(vestRowsByGrant.get(v.grantId) ?? []), v]);
  }
  const defaultStateRate = defaultSupplementalStateRate(profile.state);
  const grants = grantRows.map((r) =>
    enrichGrant(
      { ...r.grant, documentFilename: r.documentFilename, linkedAccountName: r.linkedAccountName },
      vestRowsByGrant.get(r.grant.id) ?? [],
      closesByTicker,
      securityFallbackByTicker,
      defaultStateRate,
      today,
    ),
  );
  return { grants, vestRowsByGrant, closesByTicker, defaultStateRate, rawGrants: grantRows.map((r) => r.grant) };
}

export async function getEquitySummary(
  db: Db,
  fetchCloses: FetchCloses = fetchYahooCloses,
  today = localDate(),
  options: EquityOptions = {},
): Promise<EquitySummary> {
  const { grants } = await loadAndEnrichGrants(db, fetchCloses, today, options);
  const currentYear = today.slice(0, 4);
  const next12End = addMonthsUtc(today, 12);

  let totalUnvestedGross = 0;
  let totalUnvestedNet = 0;
  let next12MonthsGross = 0;
  let next12MonthsNet = 0;
  let ytdVestedGross = 0;
  let ytdVestedWithheld = 0;
  let remainingThisYearGross = 0;
  let remainingThisYearWithheld = 0;
  let unpricedGrants = 0;
  let nextVest: EquityNextVest | null = null;

  const tickerGroups = new Map<string, EquityTickerBreakdown>();

  for (const g of grants) {
    if (g.status === 'active' && g.currentPrice === null) unpricedGrants++;
    if (g.status !== 'forfeited') {
      totalUnvestedGross += g.unvestedGrossValue ?? 0;
      totalUnvestedNet += g.unvestedNetValue ?? 0;

      if (g.unvestedShares > 0) {
        const key = g.ticker ?? `private:${g.employer}`;
        const label = g.ticker ? `${g.ticker} · ${g.employer}` : g.employer;
        const entry = tickerGroups.get(key) ?? { ticker: g.ticker, label, shares: 0, grossValue: 0, netValue: 0, price: g.currentPrice };
        entry.shares = round4(entry.shares + g.unvestedShares);
        entry.grossValue = round2(entry.grossValue + (g.unvestedGrossValue ?? 0));
        entry.netValue = round2(entry.netValue + (g.unvestedNetValue ?? 0));
        if (entry.price === null && g.currentPrice !== null) entry.price = g.currentPrice;
        tickerGroups.set(key, entry);
      }
    }

    for (const v of g.vests) {
      if (v.status === 'forfeited' || g.status === 'forfeited') continue;
      if (v.status === 'scheduled') {
        if (v.vestDate <= next12End) {
          next12MonthsGross += v.grossValue ?? 0;
          next12MonthsNet += v.estimatedNetValue ?? 0;
        }
        if (v.vestDate > today && (!nextVest || v.vestDate < nextVest.vestDate)) {
          nextVest = {
            grantId: g.id,
            vestId: v.id,
            employer: g.employer,
            grantName: g.name,
            ticker: g.ticker,
            vestDate: v.vestDate,
            shares: v.shares,
            grossValue: v.grossValue,
            netValue: v.estimatedNetValue,
          };
        }
      }
      if (v.vestDate.startsWith(currentYear)) {
        if (v.status === 'vested' || v.vestDate <= today) {
          ytdVestedGross += v.grossValue ?? 0;
          ytdVestedWithheld += v.estimatedWithholding ?? 0;
        } else {
          remainingThisYearGross += v.grossValue ?? 0;
          remainingThisYearWithheld += v.estimatedWithholding ?? 0;
        }
      }
    }
  }

  const { quarterlyTimeline, yearlyTimeline } = buildTimelines(grants, today);

  return {
    asOf: today,
    totalUnvestedGross: round2(totalUnvestedGross),
    totalUnvestedNet: round2(totalUnvestedNet),
    next12MonthsGross: round2(next12MonthsGross),
    next12MonthsNet: round2(next12MonthsNet),
    ytdVestedGross: round2(ytdVestedGross),
    ytdVestedWithheld: round2(ytdVestedWithheld),
    remainingThisYearGross: round2(remainingThisYearGross),
    remainingThisYearWithheld: round2(remainingThisYearWithheld),
    unpricedGrants,
    nextVest,
    byTicker: [...tickerGroups.values()].sort((a, b) => b.grossValue - a.grossValue),
    quarterlyTimeline,
    yearlyTimeline,
    grants,
  };
}

export async function getGrant(
  db: Db,
  id: string,
  fetchCloses: FetchCloses = fetchYahooCloses,
  today = localDate(),
  options: EquityOptions = {},
): Promise<EquityGrant> {
  const { grants } = await loadAndEnrichGrants(db, fetchCloses, today, options, id);
  const grant = grants[0];
  if (!grant) throw new HttpError(404, 'Grant not found');
  return grant;
}

async function validateGrantRefs(db: Db, input: Pick<EquityGrantInput, 'documentId' | 'linkedAccountId'>) {
  if (input.documentId) {
    const doc = await db.query.documents.findFirst({ where: eq(documents.id, input.documentId) });
    if (!doc) throw new HttpError(400, 'Attached document not found');
  }
  if (input.linkedAccountId) {
    const acct = await db.query.accounts.findFirst({ where: eq(accounts.id, input.linkedAccountId) });
    if (!acct) throw new HttpError(400, 'Linked account not found');
  }
}

function resolveGrantStatus(requested: EquityGrantStatus, vests: { status: EquityVestStatus }[]): EquityGrantStatus {
  if (requested === 'forfeited') return 'forfeited';
  return vests.some((v) => v.status === 'scheduled') ? 'active' : 'completed';
}

export async function createGrant(
  db: Db,
  input: EquityGrantInput,
  fetchCloses: FetchCloses = fetchYahooCloses,
  today = localDate(),
  options: EquityOptions = { refresh: 'blocking' },
): Promise<EquityGrant> {
  await validateGrantRefs(db, input);
  const status = resolveGrantStatus(input.status, input.vests);
  const ticker = normalizeTicker(input.ticker);

  const grantId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(equityGrants)
      .values({
        kind: input.kind,
        employer: input.employer,
        name: input.name,
        ticker,
        manualPrice: input.manualPrice,
        priceAsOf: input.priceAsOf,
        grantDate: input.grantDate,
        grantNumberMask: input.grantNumberMask,
        totalShares: input.totalShares,
        linkedAccountId: input.linkedAccountId,
        withholdingMethod: input.withholdingMethod,
        federalWithholdingRate: input.federalWithholdingRate,
        stateWithholdingRate: input.stateWithholdingRate,
        status,
        documentId: input.documentId,
        notes: input.notes,
      })
      .returning({ id: equityGrants.id });

    await tx.insert(equityVests).values(
      input.vests.map((v) => ({
        grantId: row!.id,
        vestDate: v.vestDate,
        shares: v.shares,
        status: v.status,
        vestPrice: v.vestPrice,
        sharesWithheld: v.sharesWithheld,
        taxWithheld: v.taxWithheld,
        matchedTxnId: v.matchedTxnId ?? null,
      })),
    );
    return row!.id;
  });

  return getGrant(db, grantId, fetchCloses, today, options);
}

export async function updateGrant(
  db: Db,
  id: string,
  input: EquityGrantInput,
  fetchCloses: FetchCloses = fetchYahooCloses,
  today = localDate(),
  options: EquityOptions = { refresh: 'blocking' },
): Promise<{ grant: EquityGrant; previousDocumentId: string | null }> {
  const existing = await db.query.equityGrants.findFirst({ where: eq(equityGrants.id, id) });
  if (!existing) throw new HttpError(404, 'Grant not found');
  await validateGrantRefs(db, input);

  const status = resolveGrantStatus(input.status, input.vests);
  const ticker = normalizeTicker(input.ticker);

  await db.transaction(async (tx) => {
    const existingVests = await tx.select({ id: equityVests.id }).from(equityVests).where(eq(equityVests.grantId, id));
    const ownedVestIds = new Set(existingVests.map((v) => v.id));

    await tx
      .update(equityGrants)
      .set({
        kind: input.kind,
        employer: input.employer,
        name: input.name,
        ticker,
        manualPrice: input.manualPrice,
        priceAsOf: input.priceAsOf,
        grantDate: input.grantDate,
        grantNumberMask: input.grantNumberMask,
        totalShares: input.totalShares,
        linkedAccountId: input.linkedAccountId,
        withholdingMethod: input.withholdingMethod,
        federalWithholdingRate: input.federalWithholdingRate,
        stateWithholdingRate: input.stateWithholdingRate,
        status,
        documentId: input.documentId,
        notes: input.notes,
      })
      .where(eq(equityGrants.id, id));

    await tx.delete(equityVests).where(eq(equityVests.grantId, id));
    await tx.insert(equityVests).values(
      input.vests.map((v) => ({
        ...(v.id && ownedVestIds.has(v.id) ? { id: v.id } : {}),
        grantId: id,
        vestDate: v.vestDate,
        shares: v.shares,
        status: v.status,
        vestPrice: v.vestPrice,
        sharesWithheld: v.sharesWithheld,
        taxWithheld: v.taxWithheld,
        matchedTxnId: v.matchedTxnId ?? null,
      })),
    );
  });

  return {
    grant: await getGrant(db, id, fetchCloses, today, options),
    previousDocumentId: existing.documentId !== input.documentId ? existing.documentId : null,
  };
}

export async function deleteGrant(db: Db, id: string): Promise<{ documentId: string | null }> {
  const [row] = await db
    .delete(equityGrants)
    .where(eq(equityGrants.id, id))
    .returning({ documentId: equityGrants.documentId });
  if (!row) throw new HttpError(404, 'Grant not found');
  return { documentId: row.documentId };
}

export async function confirmVest(
  db: Db,
  vestId: string,
  input: EquityVestConfirmInput,
  fetchCloses: FetchCloses = fetchYahooCloses,
  today = localDate(),
  options: EquityOptions = { refresh: 'background' },
): Promise<EquityGrant> {
  const vest = await db.query.equityVests.findFirst({ where: eq(equityVests.id, vestId) });
  if (!vest) throw new HttpError(404, 'Vest tranche not found');
  if (input.matchedTxnId) {
    const txn = await db.query.investmentTransactions.findFirst({ where: eq(investmentTransactions.id, input.matchedTxnId) });
    if (!txn) throw new HttpError(400, 'Matched investment transaction not found');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(equityVests)
      .set({
        status: input.status,
        vestPrice: input.vestPrice,
        sharesWithheld: input.sharesWithheld,
        taxWithheld: input.taxWithheld,
        ...(input.matchedTxnId !== undefined ? { matchedTxnId: input.matchedTxnId } : {}),
      })
      .where(eq(equityVests.id, vestId));

    const grant = await tx.query.equityGrants.findFirst({ where: eq(equityGrants.id, vest.grantId) });
    if (grant && grant.status !== 'forfeited') {
      const siblingVests = await tx.select({ status: equityVests.status }).from(equityVests).where(eq(equityVests.grantId, vest.grantId));
      const nextStatus = siblingVests.some((v) => v.status === 'scheduled') ? 'active' : 'completed';
      if (nextStatus !== grant.status) {
        await tx.update(equityGrants).set({ status: nextStatus }).where(eq(equityGrants.id, vest.grantId));
      }
    }
  });

  return getGrant(db, vest.grantId, fetchCloses, today, options);
}

/** RSU income and income-tax withholding figures for a given tax year (excluding Medicare/FICA). */
export async function getTaxYearEquity(
  db: Db,
  year: number,
  today = localDate(),
  profileState: string | null = null,
  fetchCloses: FetchCloses = fetchYahooCloses,
  options: EquityOptions = { refresh: 'background' },
): Promise<{
  vestedYtd: number;
  scheduledRemaining: number;
  withheldIncomeTaxYtd: number;
  projectedIncomeTaxWithholdingRemaining: number;
  tickers: Set<string>;
}> {
  const { grants, vestRowsByGrant, defaultStateRate } = await loadAndEnrichGrants(db, fetchCloses, today, options);
  const yearPrefix = `${year}-`;
  const end = `${year}-12-31` < today ? `${year}-12-31` : today;

  let vestedYtd = 0;
  let scheduledRemaining = 0;
  let withheldIncomeTaxYtd = 0;
  let projectedIncomeTaxWithholdingRemaining = 0;
  const tickers = new Set<string>();

  for (const g of grants) {
    if (g.status === 'forfeited') continue;
    if (g.ticker) tickers.add(g.ticker);
    const fedRate = g.federalWithholdingRate ?? DEFAULT_FEDERAL_SUPPLEMENTAL_RATE;
    const stateRate = g.stateWithholdingRate ?? (profileState ? defaultSupplementalStateRate(profileState) : defaultStateRate);
    const rawVests = new Map((vestRowsByGrant.get(g.id) ?? []).map((v) => [v.id, v]));

    for (const v of g.vests) {
      if (v.status === 'forfeited' || !v.vestDate.startsWith(yearPrefix)) continue;
      const gross = v.grossValue ?? 0;
      const raw = rawVests.get(v.id)!;
      const incomeTaxWithheld = incomeTaxWithholdingForVest(raw, v.price, v.grossValue, fedRate, stateRate);
      if (v.status === 'vested' || v.vestDate <= end) {
        vestedYtd += gross;
        withheldIncomeTaxYtd += incomeTaxWithheld;
      } else {
        scheduledRemaining += gross;
        projectedIncomeTaxWithholdingRemaining += incomeTaxWithheld;
      }
    }
  }

  return {
    vestedYtd: round2(vestedYtd),
    scheduledRemaining: round2(scheduledRemaining),
    withheldIncomeTaxYtd: round2(withheldIncomeTaxYtd),
    projectedIncomeTaxWithholdingRemaining: round2(projectedIncomeTaxWithholdingRemaining),
    tickers,
  };
}

/** RSU vest events within +-30 days of `today`, used for tax-loss harvesting wash-sale checks. */
export async function getRsuVestEventsForWashSale(
  db: Db,
  today = localDate(),
): Promise<{ ticker: string; date: string; kind: 'rsu_past' | 'rsu_upcoming' }[]> {
  const from = addDays(today, -30);
  const to = addDays(today, 30);
  const rows = await db
    .select({
      ticker: equityGrants.ticker,
      grantStatus: equityGrants.status,
      vestDate: equityVests.vestDate,
      vestStatus: equityVests.status,
    })
    .from(equityVests)
    .innerJoin(equityGrants, eq(equityGrants.id, equityVests.grantId))
    .where(sql`${equityVests.vestDate} >= ${from} and ${equityVests.vestDate} <= ${to}`);

  const out: { ticker: string; date: string; kind: 'rsu_past' | 'rsu_upcoming' }[] = [];
  for (const r of rows) {
    const ticker = normalizeTicker(r.ticker);
    if (!ticker || r.grantStatus === 'forfeited' || r.vestStatus === 'forfeited') continue;
    out.push({
      ticker,
      date: r.vestDate,
      kind: r.vestDate <= today ? 'rsu_past' : 'rsu_upcoming',
    });
  }
  return out;
}
