import { AutopayLinkInput, RecurringOverride } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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

export async function registerRecurringRoutes(app: FastifyInstance, { db }: AppDeps) {
  // Autopay changes what's due from each bank account, so alerts are checked again right away.
  const recheck = () => void evaluateAlerts(db).catch((err) => app.log.error({ err }, 'Alert check failed'));

  app.get('/recurring', () => getRecurringSummary(db));

  app.put('/recurring/:key', async (req) => {
    const { key } = parse(KeyParams, req.params);
    await saveRecurringOverride(db, key, parse(RecurringOverride, req.body));
    return { ok: true };
  });

  app.post('/autopay', async (req) => {
    const row = await createAutopayLink(db, parse(AutopayLinkInput, req.body));
    recheck();
    return row;
  });

  app.put('/autopay/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const row = await updateAutopayLink(db, id, parse(AutopayLinkInput, req.body));
    recheck();
    return row;
  });

  app.delete('/autopay/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    await deleteAutopayLink(db, id);
    recheck();
    return { ok: true };
  });
}
