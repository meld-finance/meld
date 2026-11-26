import { CreateScenario, RetirementPlan, SimulationSettings, UpdateScenario } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import {
  createScenario,
  deleteScenario,
  deleteSimulation,
  getRetirement,
  listSimulations,
  runSimulation,
  saveRetirementPlan,
  updateScenario,
} from '../services/retirement';

/** Which scenario; the active one when left out. */
const ScenarioQuery = z.object({ scenario: z.uuid().optional() });

export async function registerRetirementRoutes(app: FastifyInstance, { db: initialDb, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;

  app.get('/retirement', (req) => getRetirement(getDb(), undefined, parse(ScenarioQuery, req.query).scenario));
  app.put('/retirement', async (req) => {
    const db = getDb();
    const { scenario } = parse(ScenarioQuery, req.query);
    await saveRetirementPlan(db, parse(RetirementPlan, req.body), scenario);
    return getRetirement(db, undefined, scenario);
  });

  app.post('/retirement/scenarios', (req) => createScenario(getDb(), parse(CreateScenario, req.body)));
  app.patch('/retirement/scenarios/:id', (req) => updateScenario(getDb(), parse(IdParams, req.params).id, parse(UpdateScenario, req.body)));
  app.delete('/retirement/scenarios/:id', async (req) => {
    await deleteScenario(getDb(), parse(IdParams, req.params).id);
    return { ok: true };
  });

  app.get('/retirement/scenarios/:id/simulations', (req) => listSimulations(getDb(), parse(IdParams, req.params).id));
  app.post('/retirement/scenarios/:id/simulations', (req) =>
    runSimulation(getDb(), parse(IdParams, req.params).id, parse(SimulationSettings, req.body)),
  );
  app.delete('/retirement/simulations/:id', async (req) => {
    await deleteSimulation(getDb(), parse(IdParams, req.params).id);
    return { ok: true };
  });
}
