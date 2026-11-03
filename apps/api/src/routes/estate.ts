import { EstateDesignationInput, EstateDocumentInput, EstateSettings, PacketRequest } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { IdParams, parse } from '../lib/http';
import { localDate } from '../lib/networth';
import type { AppDeps } from '../server';
import { getAlertSettings } from '../services/alert-settings';
import { evaluateAlerts } from '../services/alerts';
import {
  createEstateDocument,
  deleteEstateDocument,
  getEstateDocument,
  getEstateSummary,
  loadAccountNumbers,
  recordPacketExport,
  saveDesignation,
  saveEstateSettings,
  updateEstateDocument,
} from '../services/estate';
import { renderPacket } from '../services/estate-packet';
import { getProfile } from '../services/profile';
import { getAutopayStatuses, getRecurringSeries } from '../services/recurring';
import { deleteDocumentIfUnused } from './insurance';

export async function registerEstateRoutes(app: FastifyInstance, { db, env, storage }: AppDeps) {
  // Beneficiaries and the packet's freshness raise and clear estate alerts.
  const recheck = () => void evaluateAlerts(db).catch((err) => app.log.error({ err }, 'Alert check failed'));

  app.get('/estate', async () => {
    const { fingerprint: _f, ...summary } = await getEstateSummary(db);
    return summary;
  });

  app.put('/estate/designations', async (req) => {
    await saveDesignation(db, parse(EstateDesignationInput, req.body), env.ENCRYPTION_KEY);
    recheck();
    return { ok: true };
  });

  app.get('/estate/documents/:id', (req) => getEstateDocument(db, parse(IdParams, req.params).id));

  app.post('/estate/documents', async (req) => {
    const doc = await createEstateDocument(db, parse(EstateDocumentInput, req.body));
    recheck();
    return doc;
  });

  app.put('/estate/documents/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { doc, replaced } = await updateEstateDocument(db, id, parse(EstateDocumentInput, req.body));
    await deleteDocumentIfUnused(db, storage, replaced);
    recheck();
    return doc;
  });

  app.delete('/estate/documents/:id', async (req) => {
    const documentId = await deleteEstateDocument(db, parse(IdParams, req.params).id);
    await deleteDocumentIfUnused(db, storage, documentId);
    recheck();
    return { ok: true };
  });

  app.put('/estate/settings', async (req) => {
    const saved = await saveEstateSettings(db, parse(EstateSettings, req.body));
    recheck();
    return saved;
  });

  /** The family packet as a PDF, built from today's data; encrypted when a password is given. */
  app.post('/estate/packet', async (req, reply) => {
    const { password } = parse(PacketRequest, req.body ?? {});
    const today = localDate();
    const [{ fingerprint, ...summary }, accountNumbers, profile, series, alertSettings] = await Promise.all([
      getEstateSummary(db, today),
      loadAccountNumbers(db, env.ENCRYPTION_KEY),
      getProfile(db),
      getRecurringSeries(db, today),
      getAlertSettings(db),
    ]);
    const { statuses } = await getAutopayStatuses(db, series, alertSettings, today);
    const pdf = await renderPacket(
      {
        preparedFor: profile.displayName,
        summary,
        accountNumbers,
        bills: series.filter((s) => s.status === 'active' && s.kind !== 'income'),
        autopay: statuses,
      },
      password,
    );
    await recordPacketExport(db, fingerprint);
    recheck();
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="family-packet-${today}.pdf"`)
      .header('Cache-Control', 'private, no-store')
      .send(pdf);
  });
}
