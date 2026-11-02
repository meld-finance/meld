import { CashSettings } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/http';
import type { AppDeps } from '../server';
import { getCashPlan, saveCashSettings } from '../services/cash';

export async function registerCashRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/cash', () => getCashPlan(db));
  app.put('/cash/settings', (req) => saveCashSettings(db, parse(CashSettings, req.body)));
}
