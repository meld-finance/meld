import {
  isEducationAccount,
  ownedBalance,
  ownedValue,
  RetirementPlan,
  EMPTY_RETIREMENT_PLAN,
  taxTreatment,
  type RetirementAccount,
  type RetirementMortgage,
  type RetirementSummary,
} from '@meld/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, manualAssets, retirementPlan } from '../db/schema';
import { localDate } from '../lib/networth';
import { listAccounts, listLiabilities } from './accounts';
import { getCashflow } from './overview';
import { getProfile } from './profile';

export async function getRetirementPlan(db: Db): Promise<RetirementPlan> {
  const row = await db.query.retirementPlan.findFirst({ where: eq(retirementPlan.id, 1) });
  if (!row) return EMPTY_RETIREMENT_PLAN;
  // Pick known fields only (drops id/timestamps).
  return RetirementPlan.parse(Object.fromEntries(Object.keys(EMPTY_RETIREMENT_PLAN).map((k) => [k, row[k as keyof typeof row]])));
}

export async function saveRetirementPlan(db: Db, plan: RetirementPlan): Promise<RetirementPlan> {
  await db.insert(retirementPlan).values({ id: 1, ...plan }).onConflictDoUpdate({ target: retirementPlan.id, set: plan });
  return getRetirementPlan(db);
}

export async function getRetirement(db: Db, today = localDate()): Promise<RetirementSummary> {
  const [plan, profile, cashflow, accountList, homes, mortgageAccounts, liabilityList] = await Promise.all([
    getRetirementPlan(db),
    getProfile(db),
    // The last 12 full months: drop the month in progress.
    getCashflow(db, 13, today).then((months) => months.slice(0, -1)),
    listAccounts(db, and(eq(accounts.hidden, false), eq(accounts.type, 'investment'))),
    db
      .select({
        id: manualAssets.id,
        name: manualAssets.name,
        address: manualAssets.address,
        value: manualAssets.value,
        valueAsOf: manualAssets.valueAsOf,
        depreciationPercent: manualAssets.depreciationPercent,
        ownershipPercent: manualAssets.ownershipPercent,
      })
      .from(manualAssets)
      .where(eq(manualAssets.kind, 'home'))
      .orderBy(desc(manualAssets.value)),
    listAccounts(db, and(eq(accounts.hidden, false), eq(accounts.type, 'mortgage'))),
    listLiabilities(db),
  ]);

  const excluded = new Set(plan.excludedAccountIds);
  const retirementAccounts: RetirementAccount[] = accountList
    .map((a) => {
      const excludedReason = isEducationAccount(a.subtype) ? 'education' : excluded.has(a.id) ? 'user' : null;
      return {
        id: a.id,
        name: a.name,
        institutionName: a.institutionName,
        subtype: a.subtype,
        taxTreatment: taxTreatment(a.subtype),
        value: ownedBalance(a),
        included: excludedReason === null,
        excludedReason,
      } as const;
    })
    .sort((a, b) => b.value - a.value);

  const terms = new Map(liabilityList.map((l) => [l.accountId, l]));
  const mortgages: RetirementMortgage[] = mortgageAccounts.map((a) => {
    const share = (a.ownershipPercent ?? 100) / 100;
    const t = terms.get(a.id);
    return {
      id: a.id,
      name: a.name,
      institutionName: a.institutionName,
      balance: ownedBalance(a),
      interestRatePct: t?.interestRatePct ?? null,
      monthlyPayment: t?.minimumPayment == null ? null : Math.round(t.minimumPayment * share * 100) / 100,
    };
  });

  const spending = cashflow.reduce((sum, m) => sum + m.spending, 0);
  return {
    plan,
    defaults: {
      currentAge: profile.birthYear === null ? null : Number(today.slice(0, 4)) - profile.birthYear,
      annualSpending: spending > 0 ? Math.round(spending) : null,
      annualIncome: profile.annualGrossIncome,
    },
    accounts: retirementAccounts,
    properties: homes.map((h) => ({ id: h.id, name: h.name, address: h.address, value: ownedValue(h, new Date(`${today}T00:00:00`)) })),
    mortgages,
  };
}
