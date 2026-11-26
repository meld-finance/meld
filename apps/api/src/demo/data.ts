import { randomUUID } from 'node:crypto';
import type { Beneficiary, Child, EstatePerson } from '@meld/shared';
import type {
  accounts,
  autopayLinks,
  balanceSnapshots,
  budgets,
  estateDesignations,
  estateDocuments,
  holdings,
  institutions,
  insurancePolicies,
  investmentTransactions,
  liabilities,
  manualAssets,
  plaidItems,
  securities,
  transactions,
  userProfile,
} from '../db/schema';
import { addDays, addMonths, detectRecurring, type RecurringTxn } from '../lib/recurring';

/**
 * A made-up household for trying Meld before linking banks: two years of history dated up to
 * `today`, built so every area of the app has something to show. The checking account is short
 * for the card's autopay, a streaming price went up, a subscription stopped, the savings rate
 * is low, there's 401(k) and IRA room and a fund to harvest, and the estate plan has gaps.
 * Everything is deterministic for a given `today` and prices.
 */

/** Plaid institution ids of demo data start with this, so it's never mistaken for a real link. */
export const DEMO_ID_PREFIX = 'demo_';

/** Prices to use when today's closes can't be looked up. */
export const DEFAULT_PRICES: Record<string, number> = {
  VTI: 318,
  VXUS: 71,
  BND: 73.5,
  VFIFX: 56.2,
  ARKK: 64,
  AAPL: 236,
};

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export type DemoData = {
  institutions: Insert<typeof institutions>[];
  plaidItems: Insert<typeof plaidItems>[];
  accounts: Insert<typeof accounts>[];
  transactions: Insert<typeof transactions>[];
  securities: Insert<typeof securities>[];
  holdings: Insert<typeof holdings>[];
  investmentTransactions: Insert<typeof investmentTransactions>[];
  liabilities: Insert<typeof liabilities>[];
  manualAssets: Insert<typeof manualAssets>[];
  insurancePolicies: Insert<typeof insurancePolicies>[];
  budgets: Insert<typeof budgets>[];
  profile: Insert<typeof userProfile>;
  estateDocuments: Insert<typeof estateDocuments>[];
  estateDesignations: Insert<typeof estateDesignations>[];
  autopayLinks: Insert<typeof autopayLinks>[];
  balanceSnapshots: Insert<typeof balanceSnapshots>[];
};

/** A small seeded random number generator (mulberry32), so the demo looks the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOfMonth = (date: string) => Number(date.slice(8, 10));
/** `date` moved to day `day` of its month (clamped to the month's length). */
function onDay(date: string, day: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
}
/** Monthly dates on day `day`, from `from` through `to`. */
function monthly(day: number, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = onDay(from, day); d <= to; d = onDay(addMonths(d.slice(0, 8) + '01', 1), day)) if (d >= from) out.push(d);
  return out;
}
/** Every `step` days ending at `last`, back to `from`. */
function every(step: number, last: string, from: string): string[] {
  const out: string[] = [];
  for (let d = last; d >= from; d = addDays(d, -step)) out.unshift(d);
  return out;
}

export function buildDemoData(today: string, prices: Record<string, number> = DEFAULT_PRICES): DemoData {
  const r = rng(20261125);
  const price = (t: string) => prices[t] ?? DEFAULT_PRICES[t]!;
  const year = Number(today.slice(0, 4));
  const start = addMonths(today, -25);

  // --- Institutions, connections and accounts ------------------------------
  const inst = (key: string, name: string) => ({ id: randomUUID(), plaidInstitutionId: `${DEMO_ID_PREFIX}${key}`, name });
  const summit = inst('summit', 'Summit Bank');
  const harbor = inst('harbor', 'Harbor Card Services');
  const evergreen = inst('evergreen', 'Evergreen Investments');
  const northstar = inst('northstar', 'Northstar Retirement');
  const keystone = inst('keystone', 'Keystone Home Loans');
  const allInstitutions = [summit, harbor, evergreen, northstar, keystone];
  const items = allInstitutions.map((i) => ({
    id: randomUUID(),
    plaidItemId: `${DEMO_ID_PREFIX}item_${i.plaidInstitutionId}`,
    institutionId: i.id,
    // Never decrypted: demo connections don't talk to Plaid.
    accessTokenEnc: 'demo',
    status: 'active' as const,
    lastSyncedAt: new Date(),
  }));
  const itemFor = (i: { id: string }) => items.find((it) => it.institutionId === i.id)!.id;

  type AccountRow = Insert<typeof accounts> & { id: string };
  const account = (
    i: typeof summit,
    key: string,
    fields: Pick<AccountRow, 'name' | 'type' | 'subtype' | 'mask'> & Partial<AccountRow>,
  ): AccountRow => ({
    id: randomUUID(),
    source: 'plaid',
    plaidItemId: itemFor(i),
    plaidAccountId: `${DEMO_ID_PREFIX}${key}`,
    institutionId: i.id,
    currentBalance: 0,
    ...fields,
  });
  const checking = account(summit, 'checking', { name: 'Everyday Checking', type: 'depository', subtype: 'checking', mask: '4821' });
  const savings = account(summit, 'savings', { name: 'Savings', type: 'depository', subtype: 'savings', mask: '9902' });
  const autoLoan = account(summit, 'auto', { name: 'Auto Loan', type: 'loan', subtype: 'auto', mask: '7714', currentBalance: 14820.1 });
  const card = account(harbor, 'card', { name: 'Rewards Visa', type: 'credit', subtype: 'credit card', mask: '1177', creditLimit: 15000 });
  const brokerage = account(evergreen, 'brokerage', { name: 'Individual Brokerage', type: 'investment', subtype: 'brokerage', mask: '3310' });
  const roth = account(evergreen, 'roth', { name: 'Roth IRA', type: 'investment', subtype: 'roth', mask: '3311' });
  const ira = account(evergreen, 'ira', { name: 'Rollover IRA', type: 'investment', subtype: 'ira', mask: '3312' });
  const k401 = account(northstar, '401k', { name: 'Acme 401(k)', type: 'investment', subtype: '401k', mask: '0042' });
  const hsa = account(northstar, 'hsa', { name: 'Health Savings Account', type: 'investment', subtype: 'hsa', mask: '0043' });
  const mortgage = account(keystone, 'mortgage', { name: 'Home Mortgage', type: 'loan', subtype: 'mortgage', mask: '5520', currentBalance: 412380.55 });

  // --- Cash transactions ---------------------------------------------------
  const txns: Insert<typeof transactions>[] = [];
  let n = 0;
  const txn = (
    a: AccountRow,
    date: string,
    amount: number,
    name: string,
    category: [string, string],
    merchantName: string | null = null,
  ) => {
    txns.push({
      accountId: a.id,
      plaidTransactionId: `${DEMO_ID_PREFIX}txn_${++n}`,
      amount: round2(amount),
      date,
      authorizedDate: date,
      name,
      merchantName,
      plaidCategoryPrimary: category[0],
      plaidCategoryDetailed: category[1],
      pending: date >= addDays(today, -1) && a.type === 'credit',
    });
  };

  // Paychecks every other week; the next one lands after the card is due.
  const lastPay = addDays(today, -8);
  for (const d of every(14, lastPay, start)) {
    const raised = d >= addMonths(today, -11);
    txn(checking, d, raised ? -4852.16 : -4710.84, 'ACME CORP PAYROLL PPD', ['INCOME', 'INCOME_WAGES'], 'Acme Corp');
  }

  // Bills from checking. Childcare and the phone bill come out just before the card is due.
  const cardDue = addDays(today, 4);
  for (const d of monthly(1, start, today)) {
    txn(checking, d, 2984.21, 'KEYSTONE HOME LOANS MTG PMT', ['LOAN_PAYMENTS', 'LOAN_PAYMENTS_MORTGAGE_PAYMENT'], 'Keystone Home Loans');
  }
  for (const d of monthly(15, start, today)) {
    txn(checking, d, 412.38, 'SUMMIT BANK AUTO LOAN PMT', ['LOAN_PAYMENTS', 'LOAN_PAYMENTS_CAR_PAYMENT'], 'Summit Bank');
  }
  for (const d of monthly(dayOfMonth(addDays(today, 1)), start, addDays(today, -1))) {
    txn(checking, d, 1450, 'BRIGHT STEPS PRESCHOOL', ['GENERAL_SERVICES', 'GENERAL_SERVICES_CHILDCARE'], 'Bright Steps Preschool');
  }
  for (const d of monthly(dayOfMonth(addDays(today, 2)), start, addDays(today, -1))) {
    txn(checking, d, 145.2, 'VERIZON WIRELESS PAYMENT', ['RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE'], 'Verizon');
  }
  for (const d of monthly(18, start, today)) {
    const month = Number(d.slice(5, 7));
    // Heating in winter, air conditioning in summer.
    const season = [1, 2, 12].includes(month) ? 1.5 : [7, 8, 9].includes(month) ? 1.35 : 1;
    txn(checking, d, 148 * season + r.between(-18, 22), 'PG&E WEB ONLINE', ['RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'], 'PG&E');
  }
  for (const d of monthly(22, start, today)) {
    txn(checking, d, r.between(62, 94), 'CITY WATER UTILITY', ['RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_WATER'], null);
  }
  for (const d of monthly(9, start, today)) {
    txn(checking, d, 79.99, 'COMCAST XFINITY', ['RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_INTERNET_AND_CABLE'], 'Comcast');
  }
  for (const d of monthly(12, start, today)) {
    txn(checking, d, d >= addMonths(today, -6) ? 168.4 : 151.1, 'GEICO AUTO INSURANCE', ['GENERAL_SERVICES', 'GENERAL_SERVICES_INSURANCE'], 'GEICO');
  }

  // $500 a month to savings and $500 to the brokerage account.
  for (const d of monthly(3, start, today)) {
    txn(checking, d, 500, 'ONLINE TRANSFER TO SAVINGS XXXXXX9902', ['TRANSFER_OUT', 'TRANSFER_OUT_SAVINGS']);
    txn(savings, d, -500, 'ONLINE TRANSFER FROM CHK XXXXXX4821', ['TRANSFER_IN', 'TRANSFER_IN_SAVINGS']);
  }
  for (const d of monthly(5, start, today)) {
    txn(checking, d, 500, 'EVERGREEN INVESTMENTS TRANSFER', ['TRANSFER_OUT', 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS'], 'Evergreen Investments');
  }

  // Savings earns 0.40% APY, posted at the end of each month, worked forward to today's balance.
  let savingsBalance = 25480.33;
  const savingsEvents = txns.filter((t) => t.accountId === savings.id).map((t) => ({ date: t.date, amount: t.amount }));
  for (const d of monthly(28, start, today)) savingsEvents.push({ date: d, amount: 0 });
  savingsEvents.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  for (const e of savingsEvents) {
    if (e.amount !== 0) {
      savingsBalance -= e.amount;
      continue;
    }
    const interest = round2((savingsBalance * 0.004) / 12);
    savingsBalance += interest;
    txn(savings, e.date, -interest, 'INTEREST PAYMENT', ['INCOME', 'INCOME_INTEREST_EARNED']);
  }
  savings.currentBalance = round2(savingsBalance);

  // Card spending: subscriptions and everyday purchases.
  const subscriptions: { name: string; merchant: string; day: number; amount: (d: string) => number; from?: string; to?: string; category: [string, string] }[] = [
    {
      name: 'NETFLIX.COM',
      merchant: 'Netflix',
      // The price just went up: the charge three days ago is the first at the new price.
      day: dayOfMonth(addDays(today, -3)),
      amount: (d) => (d > addDays(today, -20) ? 17.99 : 15.49),
      category: ['ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES'],
    },
    { name: 'SPOTIFY USA', merchant: 'Spotify', day: 14, amount: () => 16.99, category: ['ENTERTAINMENT', 'ENTERTAINMENT_MUSIC_AND_AUDIO'] },
    // Canceled four months ago.
    {
      name: 'DISNEY PLUS',
      merchant: 'Disney+',
      day: 20,
      amount: () => 13.99,
      to: addMonths(today, -4),
      category: ['ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES'],
    },
    { name: 'APPLE.COM/BILL ICLOUD', merchant: 'Apple', day: 2, amount: () => 2.99, category: ['GENERAL_SERVICES', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'] },
    { name: 'PEAK FITNESS CLUB', merchant: 'Peak Fitness', day: 1, amount: () => 59, category: ['PERSONAL_CARE', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS'] },
    { name: 'LIFELINE MUTUAL TERM LIFE', merchant: 'Lifeline Mutual', day: 10, amount: () => 38.5, category: ['GENERAL_SERVICES', 'GENERAL_SERVICES_INSURANCE'] },
    // New in the last three months.
    {
      name: 'HEADSPACE.COM',
      merchant: 'Headspace',
      day: dayOfMonth(addDays(today, -6)),
      amount: () => 12.99,
      from: addDays(today, -70),
      category: ['PERSONAL_CARE', 'PERSONAL_CARE_OTHER_PERSONAL_CARE'],
    },
  ];
  for (const s of subscriptions) {
    for (const d of monthly(s.day, s.from ?? start, s.to ?? today)) txn(card, d, s.amount(d), s.name, s.category, s.merchant);
  }

  const FOOD: [string, string] = ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'];
  const everyday = [
    { names: ['SAFEWAY #1423', 'TRADER JOE S #127'], merchants: ['Safeway', "Trader Joe's"], perMonth: [7, 9], amount: [38, 165], category: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'] as [string, string] },
    { names: ['COSTCO WHSE #0482'], merchants: ['Costco'], perMonth: [2, 2], amount: [160, 320], category: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'] as [string, string] },
    { names: ['CHIPOTLE 2291', 'SWEETGREEN MIDTOWN', 'LOTUS THAI KITCHEN', 'MARIO S PIZZERIA', 'THE GOOD EGG CAFE'], merchants: ['Chipotle', 'Sweetgreen', 'Lotus Thai Kitchen', "Mario's Pizzeria", 'The Good Egg Cafe'], perMonth: [5, 8], amount: [24, 96], category: FOOD },
    { names: ['STARBUCKS STORE 08812'], merchants: ['Starbucks'], perMonth: [8, 12], amount: [5.25, 9.8], category: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'] as [string, string] },
    { names: ['SHELL OIL 57442', 'CHEVRON 0091843'], merchants: ['Shell', 'Chevron'], perMonth: [3, 4], amount: [44, 72], category: ['TRANSPORTATION', 'TRANSPORTATION_GAS'] as [string, string] },
    { names: ['AMAZON MKTPL*2K4', 'AMAZON.COM*9H1'], merchants: ['Amazon', 'Amazon'], perMonth: [4, 7], amount: [14, 118], category: ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'] as [string, string] },
    { names: ['TARGET 00021477'], merchants: ['Target'], perMonth: [2, 3], amount: [28, 140], category: ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES'] as [string, string] },
    { names: ['CVS/PHARMACY #9921'], merchants: ['CVS'], perMonth: [1, 2], amount: [9, 46], category: ['MEDICAL', 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS'] as [string, string] },
    { names: ['UBER *TRIP'], merchants: ['Uber'], perMonth: [0, 2], amount: [14, 38], category: ['TRANSPORTATION', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES'] as [string, string] },
    { names: ['THE HOME DEPOT #1029'], merchants: ['The Home Depot'], perMonth: [0, 2], amount: [22, 210], category: ['HOME_IMPROVEMENT', 'HOME_IMPROVEMENT_HARDWARE'] as [string, string] },
  ];
  const thisMonth = today.slice(0, 7);
  for (let m = addMonths(start.slice(0, 8) + '01', 0); m <= today; m = addMonths(m, 1)) {
    const month = m.slice(0, 7);
    const daysIn = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    const lastDay = month === thisMonth ? dayOfMonth(today) : daysIn;
    const share = lastDay / daysIn;
    for (const e of everyday) {
      // Eating out picked up this month: it's what's pushing food over budget.
      const busier = month === thisMonth && e.category === FOOD ? 1.7 : 1;
      const count = Math.round(r.int(e.perMonth[0]!, e.perMonth[1]!) * share * busier);
      for (let i = 0; i < count; i++) {
        const d = onDay(m, r.int(1, lastDay));
        if (d < start || d > today) continue;
        const k = r.int(0, e.names.length - 1);
        txn(card, d, r.between(e.amount[0]!, e.amount[1]!) * (busier > 1 ? 1.25 : 1), e.names[k]!, e.category, e.merchants[k]!);
      }
    }
    // A summer trip and holiday shopping.
    if (month.endsWith('-07')) {
      txn(card, onDay(m, r.int(3, 12)), r.between(980, 1420), 'UNITED AIRLINES', ['TRAVEL', 'TRAVEL_FLIGHTS'], 'United Airlines');
      txn(card, onDay(m, r.int(13, 20)), r.between(1350, 1900), 'AIRBNB * HMQ2', ['TRAVEL', 'TRAVEL_LODGING'], 'Airbnb');
    }
    if (month.endsWith('-12')) {
      txn(card, onDay(m, r.int(5, 18)), r.between(420, 760), 'NORDSTROM #0412', ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES'], 'Nordstrom');
    }
  }

  // Everyday purchases can line up by chance (three lunches at one place, six months apart, at
  // nearly the same price) and read as a subscription. Drop the latest of any such run until none is left.
  const everydayMerchants = new Set([...everyday.flatMap((e) => e.merchants), 'United Airlines', 'Airbnb', 'Nordstrom']);
  for (let tries = 0; tries < 50; tries++) {
    const asRecurring: RecurringTxn[] = txns
      .filter((t) => t.accountId === card.id && t.amount > 0)
      .map((t) => ({
        id: t.plaidTransactionId!,
        accountId: t.accountId,
        accountName: card.name,
        date: t.date,
        amount: t.amount,
        name: t.name,
        merchantName: t.merchantName ?? null,
        category: t.plaidCategoryPrimary ?? null,
        plaidCategory: t.plaidCategoryPrimary ?? null,
        detailed: t.plaidCategoryDetailed ?? null,
      }));
    const chance = detectRecurring(asRecurring, today).find((series) => everydayMerchants.has(series.name));
    if (!chance) break;
    const latest = chance.recent[0]!;
    const i = txns.findIndex((t) => t.accountId === card.id && t.merchantName === chance.name && t.date === latest.date && t.amount === latest.amount);
    if (i < 0) break;
    txns.splice(i, 1);
  }

  // The card is paid in full from checking on each due date; this month's statement isn't paid yet.
  const statementDate = addDays(today, -21);
  /** Purchases on the card in (from, to]; each statement was paid in full, so that's what the next one owed. */
  const cardCharges = (from: string, to: string) =>
    round2(txns.filter((t) => t.accountId === card.id && t.amount > 0 && t.date > from && t.date <= to).reduce((s, t) => s + t.amount, 0));
  const dueDates = monthly(dayOfMonth(cardDue), addMonths(start, 1), addDays(today, -1));
  let prevStatement = addMonths(statementDate, -dueDates.length);
  let lastPayment = { amount: 0, date: '' };
  for (const due of dueDates) {
    const issued = addDays(due, -25);
    const amount = cardCharges(prevStatement, issued);
    prevStatement = issued;
    if (amount <= 0) continue;
    txn(checking, due, amount, 'HARBOR CARD AUTOPAY', ['LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'], 'Harbor Card Services');
    txn(card, due, -amount, 'AUTOPAY PAYMENT - THANK YOU', ['LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT']);
    lastPayment = { amount, date: due };
  }
  const statementBalance = cardCharges(addMonths(statementDate, -1), statementDate);
  card.currentBalance = round2(statementBalance + cardCharges(statementDate, today));
  // About $480 short of the card's autopay once childcare and the phone bill come out first.
  checking.currentBalance = round2(statementBalance + 1450 + 145.2 - 482.17);
  checking.availableBalance = checking.currentBalance;

  // --- Investments ----------------------------------------------------------
  const security = (ticker: string, name: string, type: string, extra: Partial<Insert<typeof securities>> = {}) => ({
    id: randomUUID(),
    plaidSecurityId: `${DEMO_ID_PREFIX}sec_${ticker}`,
    tickerSymbol: ticker,
    name,
    type,
    closePrice: price(ticker),
    closePriceAsOf: today,
    ...extra,
  });
  const vti = security('VTI', 'Vanguard Total Stock Market ETF', 'etf');
  const vxus = security('VXUS', 'Vanguard Total International Stock ETF', 'etf');
  const bnd = security('BND', 'Vanguard Total Bond Market ETF', 'etf');
  const vfifx = security('VFIFX', 'Vanguard Target Retirement 2050 Fund', 'mutual fund');
  const arkk = security('ARKK', 'ARK Innovation ETF', 'etf');
  const aapl = security('AAPL', 'Apple Inc.', 'equity', { sector: 'Technology', industry: 'Consumer Electronics' });
  const allSecurities = [vti, vxus, bnd, vfifx, arkk, aapl];

  const holdingRows: Insert<typeof holdings>[] = [];
  /** A position worth about `value` today, bought for `cost`. */
  const hold = (a: AccountRow, s: typeof vti, value: number, cost: number) => {
    const p = s.closePrice!;
    const quantity = Math.round((value / p) * 1000) / 1000;
    holdingRows.push({ accountId: a.id, securityId: s.id, quantity, institutionPrice: p, institutionValue: round2(quantity * p), costBasis: cost });
  };
  hold(brokerage, vti, 38200, 29400);
  hold(brokerage, vxus, 11300, 10100);
  // Down about a third: a tax-loss harvest.
  hold(brokerage, arkk, 6150, 9820);
  hold(brokerage, aapl, 8480, 4120);
  hold(k401, vfifx, 212400, 168000);
  hold(roth, vti, 29600, 21000);
  hold(roth, vxus, 11800, 10400);
  hold(roth, bnd, 6900, 7300);
  hold(ira, bnd, 9100, 9600);
  hold(ira, vti, 12900, 9200);
  hold(hsa, vti, 9560, 7900);
  for (const a of [brokerage, roth, ira, k401, hsa]) {
    a.currentBalance = round2(holdingRows.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.institutionValue!, 0));
  }

  const invTxns: Insert<typeof investmentTransactions>[] = [];
  let m = 0;
  const inv = (a: AccountRow, date: string, fields: Omit<Insert<typeof investmentTransactions>, 'accountId' | 'date' | 'plaidInvestmentTransactionId'>) =>
    invTxns.push({ accountId: a.id, date, plaidInvestmentTransactionId: `${DEMO_ID_PREFIX}inv_${++m}`, ...fields });
  const buy = (a: AccountRow, date: string, s: typeof vti, amount: number) => {
    // Prices drift up about 8% a year toward today's.
    const yearsAgo = (Date.parse(today) - Date.parse(date)) / (365 * 86_400_000);
    const p = round2(s.closePrice! / 1.08 ** yearsAgo);
    inv(a, date, { securityId: s.id, name: `BUY ${s.name}`, type: 'buy', subtype: 'buy', quantity: Math.round((amount / p) * 1000) / 1000, price: p, amount });
  };
  // 401(k): $750 from every paycheck, invested in the target date fund. That leaves room under this year's limit.
  for (const d of every(14, lastPay, start)) {
    inv(k401, d, { name: 'Employee Contribution', type: 'cash', subtype: 'contribution', amount: -750 });
    buy(k401, d, vfifx, 750);
  }
  // HSA: $150 a month, well under the family limit.
  for (const d of monthly(5, start, today)) {
    inv(hsa, d, { name: 'Payroll Contribution', type: 'cash', subtype: 'contribution', amount: -150 });
    buy(hsa, d, vti, 150);
  }
  // Brokerage: the $500 a month from checking buys the total market fund.
  for (const d of monthly(5, start, today)) {
    inv(brokerage, d, { name: 'Deposit from Summit Bank', type: 'cash', subtype: 'deposit', amount: -500 });
    buy(brokerage, d, vti, 500);
  }
  // Quarterly dividends in the taxable account.
  for (const d of monthly(26, start, today).filter((d) => ['03', '06', '09', '12'].includes(d.slice(5, 7)))) {
    inv(brokerage, d, { securityId: vti.id, name: 'DIVIDEND VTI', type: 'cash', subtype: 'qualified dividend', amount: -124.6 });
    inv(brokerage, d, { securityId: vxus.id, name: 'DIVIDEND VXUS', type: 'cash', subtype: 'qualified dividend', amount: -71.2 });
    inv(brokerage, d, { securityId: aapl.id, name: 'DIVIDEND AAPL', type: 'cash', subtype: 'qualified dividend', amount: -9.1 });
  }

  // --- Loans ------------------------------------------------------------------
  const nextFirst = onDay(addMonths(today.slice(0, 8) + '01', 1), 1);
  const liabilityRows: Insert<typeof liabilities>[] = [
    {
      accountId: card.id,
      kind: 'credit',
      interestRatePct: 24.99,
      minimumPayment: 41,
      nextPaymentDueDate: cardDue,
      details: {
        last_statement_balance: statementBalance,
        last_statement_issue_date: statementDate,
        last_payment_amount: lastPayment.amount || null,
        last_payment_date: lastPayment.date || null,
      },
    },
    {
      accountId: mortgage.id,
      kind: 'mortgage',
      interestRatePct: 6.125,
      minimumPayment: 2984.21,
      nextPaymentDueDate: nextFirst,
      originationDate: `${year - 4}-06-15`,
      originationPrincipal: 440000,
      maturityDate: `${year + 26}-07-01`,
      escrowBalance: 3120.44,
    },
  ];

  // --- Home, car, insurance -------------------------------------------------
  const home = { id: randomUUID(), kind: 'home', name: 'Home', value: 785000, valueAsOf: addMonths(today, -2), notes: 'Bought in ' + (year - 4) };
  const car = {
    id: randomUUID(),
    kind: 'vehicle',
    name: `${year - 5} Honda CR-V`,
    value: 24500,
    valueAsOf: addMonths(today, -3),
    depreciationPercent: 12,
    vehicle: { year: year - 5, make: 'Honda', model: 'CR-V', mileage: 41000 },
  };
  const spouse = (percentage = 100): Beneficiary => ({ name: 'Jordan Rivera', relationship: 'Spouse', percentage, primary: true });
  const kids: Beneficiary[] = [
    { name: 'Maya Rivera', relationship: 'Child', percentage: 50, primary: false },
    { name: 'Leo Rivera', relationship: 'Child', percentage: 50, primary: false },
  ];
  const policies: Insert<typeof insurancePolicies>[] = [
    {
      type: 'life_term',
      carrier: 'Acme Corp group life',
      insuredName: 'Alex Rivera',
      coverageAmount: 185000,
      employerProvided: true,
      beneficiaries: [spouse()],
      notes: 'One times salary, through work. Ends if Alex leaves Acme.',
    },
    {
      type: 'life_term',
      carrier: 'Lifeline Mutual',
      policyNumberMask: '4410',
      insuredName: 'Alex Rivera',
      coverageAmount: 500000,
      premiumAmount: 38.5,
      premiumFrequency: 'monthly',
      effectiveDate: `${year - 7}-03-01`,
      termEndDate: `${year + 13}-03-01`,
      // No contingent beneficiary: a check flags it.
      beneficiaries: [spouse()],
    },
    {
      type: 'disability_short',
      carrier: 'Acme Corp short-term disability',
      insuredName: 'Alex Rivera',
      benefitPercentOfIncome: 60,
      eliminationPeriodDays: 7,
      benefitPeriod: '12 weeks',
      employerProvided: true,
    },
  ];

  // --- Estate -----------------------------------------------------------------
  // An old will from before Leo was born, naming no guardian; no power of attorney or healthcare directive.
  const willPeople: EstatePerson[] = [{ name: 'Jordan Rivera', relationship: 'Spouse', role: 'executor', phone: null, email: null }];
  const will = {
    id: randomUUID(),
    kind: 'will',
    name: 'Last will and testament',
    signedDate: `${year - 9}-04-12`,
    state: 'CA',
    reviewedAt: `${year - 9}-04-12`,
    originalLocation: 'Fireproof box in the hall closet',
    people: willPeople,
  };
  const designations: Insert<typeof estateDesignations>[] = [
    { accountId: k401.id, method: 'beneficiary', beneficiaries: [spouse()], reviewedAt: addMonths(today, -20) },
    { accountId: roth.id, method: 'beneficiary', beneficiaries: [spouse(), ...kids], reviewedAt: addMonths(today, -20) },
    { accountId: hsa.id, method: 'beneficiary', beneficiaries: [spouse()], reviewedAt: addMonths(today, -20) },
    { accountId: checking.id, method: 'joint_survivorship', beneficiaries: [] },
    { manualAssetId: home.id, method: 'joint_survivorship', beneficiaries: [] },
  ];

  const children: Child[] = [
    { id: 'maya', name: 'Maya', birthYear: year - 10 },
    { id: 'leo', name: 'Leo', birthYear: year - 7 },
  ];

  // --- Net worth history ------------------------------------------------------
  const allAccounts = [checking, savings, autoLoan, card, brokerage, roth, ira, k401, hsa, mortgage];
  const snapshots: Insert<typeof balanceSnapshots>[] = [];
  const isDebt = (a: AccountRow) => a.type === 'credit' || a.type === 'loan';
  for (let back = 400; back >= 1; back--) {
    const date = addDays(today, -back);
    const years = back / 365;
    // Markets rose about 9% a year with a few wobbles; loans were higher before their payments.
    const market = 1 / 1.09 ** years + 0.025 * Math.sin(back / 23) + 0.012 * Math.sin(back / 5);
    const balances: Record<string, number> = {};
    let assets = 0;
    let debts = 0;
    for (const a of allAccounts) {
      const now = a.currentBalance ?? 0;
      let then = now;
      if (a.type === 'investment') then = now * market - (a.id === k401.id ? 1500 : a.id === brokerage.id ? 500 : 150) * (back / 30) * 0.5;
      else if (a.id === mortgage.id) then = now + 560 * (back / 30);
      else if (a.id === autoLoan.id) then = now + 330 * (back / 30);
      else if (a.id === savings.id) then = now - 500 * (back / 30);
      else then = now * (0.85 + 0.3 * ((Math.sin(back / 3) + 1) / 2));
      then = round2(Math.max(0, then));
      balances[a.id!] = then;
      if (isDebt(a)) debts += then;
      else assets += then;
    }
    balances[home.id] = 785000 - 18000 * years;
    balances[car.id] = round2(24500 * 1.12 ** years);
    assets += balances[home.id]! + balances[car.id]!;
    snapshots.push({
      date,
      totalAssets: round2(assets),
      totalLiabilities: round2(debts),
      netWorth: round2(assets - debts),
      balances,
    });
  }

  return {
    institutions: allInstitutions,
    plaidItems: items,
    accounts: allAccounts,
    transactions: txns,
    securities: allSecurities,
    holdings: holdingRows,
    investmentTransactions: invTxns,
    liabilities: liabilityRows,
    manualAssets: [home, car],
    insurancePolicies: policies,
    budgets: [
      { category: 'FOOD_AND_DRINK', monthlyTarget: 1800 },
      { category: 'GENERAL_MERCHANDISE', monthlyTarget: 550 },
      { category: 'ENTERTAINMENT', monthlyTarget: 60 },
      { category: 'TRANSPORTATION', monthlyTarget: 300 },
    ],
    profile: {
      id: 1,
      displayName: 'Alex Rivera',
      birthYear: year - 41,
      filingStatus: 'married_joint',
      state: 'CA',
      dependents: 2,
      children,
      annualGrossIncome: 185000,
      occupation: 'Product manager',
      employerBenefits: '401(k) with a 4% match, group term life at 1× salary, short-term disability at 60%. No long-term disability.',
      goals: 'Retire around 60, help pay for the kids’ college, and keep the family covered.',
    },
    estateDocuments: [will],
    estateDesignations: designations,
    autopayLinks: [{ payeeAccountId: card.id, fundingAccountId: checking.id, amountRule: 'statement_balance' }],
    balanceSnapshots: snapshots,
  };
}
