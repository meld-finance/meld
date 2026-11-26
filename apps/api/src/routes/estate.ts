import {
  EstateDesignationInput,
  EstateDocumentInput,
  EstateSettings,
  LeaveToWillInput,
  PacketRequest,
  type BankNumberResult,
} from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, plaidItems } from '../db/schema';
import { decrypt } from '../lib/crypto';
import { HttpError, IdParams, parse } from '../lib/http';
import { localDate } from '../lib/networth';
import { getPlaidError } from '../plaid/client';
import type { AppDeps } from '../server';
import { getAlertSettings } from '../services/alert-settings';
import { evaluateAlerts } from '../services/alerts';
import {
  createEstateDocument,
  deleteEstateDocument,
  getEstateDocument,
  getEstateSummary,
  leaveToWill,
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

export async function registerEstateRoutes(app: FastifyInstance, { db, env, plaid, storage }: AppDeps) {
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

  app.post('/estate/designations/will', async (req) => {
    const updated = await leaveToWill(db, parse(LeaveToWillInput, req.body));
    recheck();
    return { updated };
  });

  /**
   * A linked checking or savings account's full number from the bank (Plaid Auth), for the user to
   * check and save on the designation form. Plaid bills Auth once per connection on first use.
   */
  app.post('/estate/accounts/:id/bank-number', async (req): Promise<BankNumberResult> => {
    const { id } = parse(IdParams, req.params);
    const account = await db.query.accounts.findFirst({ where: eq(accounts.id, id) });
    if (!account) throw new HttpError(404, 'Account not found');
    if (!account.plaidItemId || !account.plaidAccountId || account.type !== 'depository') {
      throw new HttpError(400, 'Only linked checking and savings accounts can be looked up');
    }
    const item = await db.query.plaidItems.findFirst({ where: eq(plaidItems.id, account.plaidItemId) });
    if (!item) throw new HttpError(404, 'Bank connection not found');
    if (env.MELD_DEMO) return { status: 'unavailable', message: 'Demo accounts have no real account numbers. Connect your banks to look yours up.' };
    try {
      const { data } = await plaid.authGet({
        access_token: decrypt(item.accessTokenEnc, env.ENCRYPTION_KEY),
        options: { account_ids: [account.plaidAccountId] },
      });
      const number = data.numbers.ach.find((n) => n.account_id === account.plaidAccountId)?.account;
      return number
        ? { status: 'ok', accountNumber: number }
        : { status: 'unavailable', message: 'The bank didn’t return a number for this account. Copy it from a statement instead.' };
    } catch (err) {
      const code = getPlaidError(err)?.error_code;
      if (code === 'ADDITIONAL_CONSENT_REQUIRED') return { status: 'consent_required', itemId: item.id };
      if (code === 'PRODUCTS_NOT_SUPPORTED' || code === 'NO_AUTH_ACCOUNTS' || code === 'INSTITUTION_NOT_SUPPORTED') {
        return { status: 'unavailable', message: 'This bank doesn’t share account numbers through Plaid. Copy it from a statement instead.' };
      }
      if (code === 'INVALID_PRODUCT' || code === 'PRODUCT_NOT_ENABLED') {
        return { status: 'unavailable', message: 'Auth isn’t enabled for your Plaid account. Turn it on in the Plaid dashboard, or copy the number from a statement.' };
      }
      throw err;
    }
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
