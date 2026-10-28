import { RetirementPlan } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/http';
import type { AppDeps } from '../server';
import { getRetirement, saveRetirementPlan } from '../services/retirement';

export async function registerRetirementRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/retirement', () => getRetirement(db));
  app.put('/retirement', async (req) => {
    await saveRetirementPlan(db, parse(RetirementPlan, req.body));
    return getRetirement(db);
  });
}
