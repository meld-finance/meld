import {
  isEducationAccount,
  ownedBalance,
  RetirementPlan,
  EMPTY_RETIREMENT_PLAN,
  taxTreatment,
  type RetirementAccount,
  type RetirementSummary,
} from '@meld/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, retirementPlan } from '../db/schema';
import { localDate } from '../lib/networth';
import { listAccounts } from './accounts';
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
  const [plan, profile, cashflow, accountList] = await Promise.all([
    getRetirementPlan(db),
    getProfile(db),
    // The last 12 full months: drop the month in progress.
    getCashflow(db, 13, today).then((months) => months.slice(0, -1)),
    listAccounts(db, and(eq(accounts.hidden, false), eq(accounts.type, 'investment'))),
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

  const spending = cashflow.reduce((sum, m) => sum + m.spending, 0);
  return {
    plan,
    defaults: {
      currentAge: profile.birthYear === null ? null : Number(today.slice(0, 4)) - profile.birthYear,
      annualSpending: spending > 0 ? Math.round(spending) : null,
      annualIncome: profile.annualGrossIncome,
    },
    accounts: retirementAccounts,
  };
}
