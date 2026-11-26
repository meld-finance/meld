import { AutopayLinkInput, RecurringOverride } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import { evaluateAlerts } from '../services/alerts';
import {
  createAutopayLink,
  deleteAutopayLink,
  getRecurringSummary,
  saveRecurringOverride,
  updateAutopayLink,
} from '../services/recurring';

const KeyParams = z.object({ key: z.string().min(1).max(200) });

export async function registerRecurringRoutes(app: FastifyInstance, { db: initialDb, env, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;
  const isDemo = () => runtime?.isDemo() ?? env.MELD_DEMO;
  // Autopay changes what's due from each bank account, so alerts are checked again right away.
  const recheck = (db: Db, demo: boolean) =>
    void evaluateAlerts(db, demo ? async () => {} : undefined).catch((err) => app.log.error({ err }, 'Alert check failed'));

  app.get('/recurring', () => getRecurringSummary(getDb()));

  app.put('/recurring/:key', async (req) => {
    const { key } = parse(KeyParams, req.params);
    await saveRecurringOverride(getDb(), key, parse(RecurringOverride, req.body));
    return { ok: true };
  });

  app.post('/autopay', async (req) => {
    const db = getDb();
    const row = await createAutopayLink(db, parse(AutopayLinkInput, req.body));
    recheck(db, isDemo());
    return row;
  });

  app.put('/autopay/:id', async (req) => {
    const db = getDb();
    const { id } = parse(IdParams, req.params);
    const row = await updateAutopayLink(db, id, parse(AutopayLinkInput, req.body));
    recheck(db, isDemo());
    return row;
  });

  app.delete('/autopay/:id', async (req) => {
    const db = getDb();
    const { id } = parse(IdParams, req.params);
    await deleteAutopayLink(db, id);
    recheck(db, isDemo());
    return { ok: true };
  });
}
