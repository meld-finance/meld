import { AlertSettings } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import { getAlertSettings, saveAlertSettings } from '../services/alert-settings';
import { dismissAlert, evaluateAlerts, listAlerts, markAlertsRead, ntfyNotifier } from '../services/alerts';

const ReadBody = z.object({ ids: z.array(z.uuid()).optional() });
const DismissBody = z.object({ dismissed: z.boolean() });

export async function registerAlertRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/alerts', () => listAlerts(db));

  app.post('/alerts/read', async (req) => {
    await markAlertsRead(db, parse(ReadBody, req.body ?? {}).ids);
    return { ok: true };
  });

  app.post('/alerts/:id/dismiss', async (req) => {
    const { id } = parse(IdParams, req.params);
    await dismissAlert(db, id, parse(DismissBody, req.body).dismissed);
    return { ok: true };
  });

  /** Checks for new alerts now instead of waiting for the next sync. */
  app.post('/alerts/check', () => evaluateAlerts(db));

  app.get('/alerts/settings', () => getAlertSettings(db));

  app.put('/alerts/settings', async (req) => {
    const saved = await saveAlertSettings(db, parse(AlertSettings, req.body));
    // New thresholds can open or clear alerts.
    void evaluateAlerts(db).catch((err) => app.log.error({ err }, 'Alert check failed'));
    return saved;
  });

  /** Sends a test push to the ntfy URL given (or saved), so you can check it arrives before saving. */
  app.post('/alerts/test', async (req) => {
    const { ntfyUrl } = parse(z.object({ ntfyUrl: AlertSettings.shape.ntfyUrl.optional() }), req.body ?? {});
    const settings = await getAlertSettings(db);
    const url = ntfyUrl ?? settings.ntfyUrl;
    if (!url) throw new HttpError(400, 'Enter an ntfy topic URL first');
    try {
      await ntfyNotifier(
        { type: 'connection', severity: 'info', key: 'test', title: 'Meld test alert', body: 'Alerts from Meld will arrive here.', href: null },
        { ...settings, ntfyUrl: url },
      );
    } catch (err) {
      throw new HttpError(502, `Couldn’t send the test: ${(err as Error).message}`);
    }
    return { ok: true };
  });
}
