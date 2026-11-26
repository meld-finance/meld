import { CashSettings } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/http';
import type { AppDeps } from '../server';
import { getCashPlan, saveCashSettings } from '../services/cash';

export async function registerCashRoutes(app: FastifyInstance, { db: initialDb, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;
  app.get('/cash', () => getCashPlan(getDb()));
  app.put('/cash/settings', (req) => saveCashSettings(getDb(), parse(CashSettings, req.body)));
}
