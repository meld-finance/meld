import {
  householdGrossIncome,
  isEducationAccount,
  ownedBalance,
  ownedValue,
  resolvePlan,
  RetirementPlan,
  EMPTY_RETIREMENT_PLAN,
  simulateRetirement,
  taxTreatment,
  type CreateScenario,
  type RetirementAccount,
  type RetirementMortgage,
  type RetirementScenario,
  type RetirementSummary,
  type SavedSimulation,
  type SimulationSettings,
  type UpdateScenario,
} from '@meld/shared';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, holdings, manualAssets, retirementScenarios, retirementSimulations } from '../db/schema';
import { HttpError } from '../lib/http';
import { localDate } from '../lib/networth';
import { listAccounts, listLiabilities } from './accounts';
import { getCashflow } from './overview';
import { getProfile } from './profile';

const DEFAULT_SCENARIO_NAME = 'My plan';

type ScenarioRow = typeof retirementScenarios.$inferSelect;
type Scenario = RetirementScenario & { plan: RetirementPlan };

/** Saved plans may predate fields added since; those read as empty. */
const toScenario = (row: ScenarioRow): Scenario => ({
  id: row.id,
  name: row.name,
  active: row.active,
  plan: RetirementPlan.parse({ ...EMPTY_RETIREMENT_PLAN, ...row.plan }),
});

/** Every scenario, oldest first; the first read creates an empty active "My plan". */
export async function listScenarios(db: Db): Promise<Scenario[]> {
  const rows = await db.select().from(retirementScenarios).orderBy(asc(retirementScenarios.createdAt), asc(retirementScenarios.id));
  if (rows.length) return rows.map(toScenario);
  // Two first reads at once: the active index lets only one insert through.
  await db.insert(retirementScenarios).values({ name: DEFAULT_SCENARIO_NAME, active: true, plan: EMPTY_RETIREMENT_PLAN }).onConflictDoNothing();
  return listScenarios(db);
}

/** A scenario by id, or the active one. */
async function findScenario(db: Db, scenarioId?: string): Promise<Scenario> {
  const all = await listScenarios(db);
  const scenario = scenarioId ? all.find((s) => s.id === scenarioId) : all.find((s) => s.active);
  if (!scenario) throw new HttpError(404, 'Scenario not found');
  return scenario;
}

export async function getRetirementPlan(db: Db, scenarioId?: string): Promise<RetirementPlan> {
  return (await findScenario(db, scenarioId)).plan;
}

export async function saveRetirementPlan(db: Db, plan: RetirementPlan, scenarioId?: string): Promise<RetirementPlan> {
  const scenario = await findScenario(db, scenarioId);
  await db.update(retirementScenarios).set({ plan }).where(eq(retirementScenarios.id, scenario.id));
  return getRetirementPlan(db, scenario.id);
}

export async function createScenario(db: Db, input: CreateScenario): Promise<RetirementScenario> {
  const plan = input.copyFrom ? (await findScenario(db, input.copyFrom)).plan : EMPTY_RETIREMENT_PLAN;
  // The first scenario ever is active; listScenarios makes "My plan" before this one.
  await listScenarios(db);
  const [row] = await db.insert(retirementScenarios).values({ name: input.name, plan }).returning();
  return toScenario(row!);
}

export async function updateScenario(db: Db, id: string, input: UpdateScenario): Promise<RetirementScenario> {
  await findScenario(db, id);
  await db.transaction(async (tx) => {
    if (input.name !== undefined) await tx.update(retirementScenarios).set({ name: input.name }).where(eq(retirementScenarios.id, id));
    if (input.active) {
      await tx.update(retirementScenarios).set({ active: false }).where(and(eq(retirementScenarios.active, true), ne(retirementScenarios.id, id)));
      await tx.update(retirementScenarios).set({ active: true }).where(eq(retirementScenarios.id, id));
    }
  });
  return findScenario(db, id);
}

/** Deleting the active scenario makes the most recently updated other one active; the last can't go. */
export async function deleteScenario(db: Db, id: string): Promise<void> {
  const all = await listScenarios(db);
  const scenario = all.find((s) => s.id === id);
  if (!scenario) throw new HttpError(404, 'Scenario not found');
  if (all.length === 1) throw new HttpError(400, 'Keep at least one scenario');
  await db.transaction(async (tx) => {
    await tx.delete(retirementScenarios).where(eq(retirementScenarios.id, id));
    if (!scenario.active) return;
    const [next] = await tx.select({ id: retirementScenarios.id }).from(retirementScenarios).orderBy(desc(retirementScenarios.updatedAt)).limit(1);
    await tx.update(retirementScenarios).set({ active: true }).where(eq(retirementScenarios.id, next!.id));
  });
}

const toSimulation = (row: typeof retirementSimulations.$inferSelect): SavedSimulation => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

/** Saved runs for a scenario, newest first. */
export async function listSimulations(db: Db, scenarioId: string): Promise<SavedSimulation[]> {
  await findScenario(db, scenarioId);
  const rows = await db
    .select()
    .from(retirementSimulations)
    .where(eq(retirementSimulations.scenarioId, scenarioId))
    .orderBy(desc(retirementSimulations.createdAt));
  return rows.map(toSimulation);
}

/** Runs the scenario's saved plan against today's balances and keeps the result. */
export async function runSimulation(db: Db, scenarioId: string, settings: SimulationSettings, today = localDate()): Promise<SavedSimulation> {
  const summary = await getRetirement(db, today, scenarioId);
  const { inputs, missing } = resolvePlan(summary.plan, summary);
  if (!inputs) throw new HttpError(400, `Add your ${missing.join(' and ')} first`);
  const [row] = await db
    .insert(retirementSimulations)
    .values({ scenarioId, settings, inputs, result: simulateRetirement(inputs, settings) })
    .returning();
  return toSimulation(row!);
}

export async function deleteSimulation(db: Db, id: string): Promise<void> {
  const [row] = await db.delete(retirementSimulations).where(eq(retirementSimulations.id, id)).returning({ id: retirementSimulations.id });
  if (!row) throw new HttpError(404, 'Simulation not found');
}

export async function getRetirement(db: Db, today = localDate(), scenarioId?: string): Promise<RetirementSummary> {
  const [scenarios, profile, cashflow, accountList, homes, mortgageAccounts, liabilityList] = await Promise.all([
    listScenarios(db),
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

  const current = scenarioId ? scenarios.find((s) => s.id === scenarioId) : scenarios.find((s) => s.active);
  if (!current) throw new HttpError(404, 'Scenario not found');
  const { plan, ...scenario } = current;
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

  const taxableIds = retirementAccounts
    .filter((a) => a.included && (a.taxTreatment === 'taxable' || a.taxTreatment === 'unknown'))
    .map((a) => a.id);
  let taxableBasisPercent: number | null = null;
  if (taxableIds.length > 0) {
    const shareById = new Map(accountList.map((a) => [a.id, (a.ownershipPercent ?? 100) / 100]));
    const holdingRows = await db
      .select({ accountId: holdings.accountId, value: holdings.institutionValue, costBasis: holdings.costBasis })
      .from(holdings)
      .where(inArray(holdings.accountId, taxableIds));
    let totalVal = 0;
    let totalBasis = 0;
    for (const h of holdingRows) {
      if (h.value !== null && h.value > 0 && h.costBasis !== null && h.costBasis >= 0) {
        const share = shareById.get(h.accountId) ?? 1;
        totalVal += h.value * share;
        totalBasis += Math.min(h.value, h.costBasis) * share;
      }
    }
    if (totalVal > 0) {
      taxableBasisPercent = Math.round((totalBasis / totalVal) * 1000) / 10;
    }
  }

  const spending = cashflow.reduce((sum, m) => sum + m.spending, 0);
  const year = Number(today.slice(0, 4));
  return {
    scenario,
    scenarios,
    plan,
    defaults: {
      currentAge: profile.birthYear === null ? null : year - profile.birthYear,
      birthYear: profile.birthYear,
      married: profile.filingStatus === 'married_joint' || profile.filingStatus === 'married_separate',
      annualSpending: spending > 0 ? Math.round(spending) : null,
      annualIncome: householdGrossIncome(profile),
      yourIncome: profile.annualGrossIncome,
      filingStatus: profile.filingStatus,
      state: profile.state,
      partner: profile.partner
        ? {
            name: profile.partner.name,
            currentAge: profile.partner.birthYear === null ? null : year - profile.partner.birthYear,
            birthYear: profile.partner.birthYear,
            annualIncome: profile.partner.annualGrossIncome,
          }
        : null,
      children: profile.children,
      taxableBasisPercent,
    },
    accounts: retirementAccounts,
    properties: homes.map((h) => ({ id: h.id, name: h.name, address: h.address, value: ownedValue(h, new Date(`${today}T00:00:00`)) })),
    mortgages,
  };
}
