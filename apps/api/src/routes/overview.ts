import { BudgetUpsert, CashflowPeriodQuery, Month } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { budgets } from '../db/schema';
import { HttpError, parse } from '../lib/http';
import { localDate } from '../lib/networth';
import {
  getBudgetStatus,
  getCashflow,
  getCashflowPeriod,
  getNetWorth,
  getNetWorthHistory,
  getSpendingByCategory,
  getSpendingByMonth,
} from '../services/overview';
import type { AppDeps } from '../server';

const currentMonth = () => localDate().slice(0, 7);
const MonthQuery = z.object({ month: Month.default(currentMonth) });

export async function registerOverviewRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/networth', () => getNetWorth(db));

  app.get('/networth/history', (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(3650).default(365) }), req.query);
    const since = new Date();
    since.setDate(since.getDate() - days);
    return getNetWorthHistory(db, localDate(since));
  });

  app.get('/cashflow', (req) => {
    const { months } = parse(z.object({ months: z.coerce.number().int().min(1).max(36).default(6) }), req.query);
    return getCashflow(db, months);
  });

  app.get('/cashflow/period', (req) => {
    const { from, to } = parse(CashflowPeriodQuery, req.query);
    return getCashflowPeriod(db, from, to);
  });

  app.get('/cashflow/categories', (req) => {
    const { months, end } = parse(
      z.object({ months: z.coerce.number().int().min(1).max(36).default(12), end: Month.default(currentMonth) }),
      req.query,
    );
    return getSpendingByMonth(db, months, end);
  });

  app.get('/spending', (req) => getSpendingByCategory(db, parse(MonthQuery, req.query).month));

  app.get('/budgets', (req) => getBudgetStatus(db, parse(MonthQuery, req.query).month));

  app.put('/budgets', async (req) => {
    const { category, monthlyTarget } = parse(BudgetUpsert, req.body);
    await db
      .insert(budgets)
      .values({ category, monthlyTarget })
      .onConflictDoUpdate({ target: budgets.category, set: { monthlyTarget } });
    return { ok: true };
  });

  app.delete('/budgets/:category', async (req) => {
    const { category } = parse(z.object({ category: z.string().min(1) }), req.params);
    const [row] = await db.delete(budgets).where(eq(budgets.category, category)).returning({ id: budgets.id });
    if (!row) throw new HttpError(404, 'Budget not found');
    return { ok: true };
  });
}
