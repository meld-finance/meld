import { ExchangeRequest, LinkTokenRequest, type LinkTokenResponse, type PlaidItemSummary, type SyncResult } from '@meld/shared';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CountryCode, Products, type LinkTokenCreateRequest } from 'plaid';
import { accounts, institutions, plaidItems } from '../db/schema';
import { decrypt, encrypt } from '../lib/crypto';
import { HttpError, IdParams, parse } from '../lib/http';
import { getPlaidError } from '../plaid/client';
import { syncItem, syncUntilReady } from '../plaid/sync';
import type { AppDeps } from '../server';

/** Shown when something needs Plaid while Meld is showing demo data. */
export const DEMO_PLAID_MESSAGE = 'This is demo data. Connect your banks to link your own accounts.';

export async function registerPlaidRoutes(app: FastifyInstance, { db, plaid, env, sync }: AppDeps) {
  const countryCodes = env.PLAID_COUNTRY_CODES as CountryCode[];
  const requireRealData = () => {
    if (env.MELD_DEMO) throw new HttpError(409, DEMO_PLAID_MESSAGE);
  };

  async function loadItem(id: string) {
    const item = await db.query.plaidItems.findFirst({ where: eq(plaidItems.id, id) });
    if (!item) throw new HttpError(404, 'Item not found');
    return item;
  }

  app.post('/plaid/link-token', async (req): Promise<LinkTokenResponse> => {
    requireRealData();
    const { itemId, consentAuth } = parse(LinkTokenRequest, req.body ?? {});
    const request: LinkTokenCreateRequest = {
      user: { client_user_id: 'owner' },
      client_name: 'Meld',
      country_codes: countryCodes,
      language: 'en',
    };
    if (itemId) {
      // Update mode: re-authenticate an existing item; products must be omitted.
      request.access_token = decrypt((await loadItem(itemId)).accessTokenEnc, env.ENCRYPTION_KEY);
      if (consentAuth) request.additional_consented_products = [Products.Auth];
    } else {
      request.products = env.PLAID_PRODUCTS as Products[];
      request.optional_products = env.PLAID_OPTIONAL_PRODUCTS as Products[];
      if (env.PLAID_ADDITIONAL_CONSENTED_PRODUCTS.length) {
        request.additional_consented_products = env.PLAID_ADDITIONAL_CONSENTED_PRODUCTS as Products[];
      }
      request.transactions = { days_requested: 730 };
    }
    const { data } = await plaid.linkTokenCreate(request);
    return { linkToken: data.link_token };
  });

  app.post('/plaid/exchange', async (req) => {
    requireRealData();
    const { publicToken } = parse(ExchangeRequest, req.body);
    const { data: exchanged } = await plaid.itemPublicTokenExchange({ public_token: publicToken });

    const { data: itemData } = await plaid.itemGet({ access_token: exchanged.access_token });
    let institutionId: string | null = null;
    const plaidInstitutionId = itemData.item.institution_id;
    if (plaidInstitutionId) {
      const { data: inst } = await plaid.institutionsGetById({
        institution_id: plaidInstitutionId,
        country_codes: countryCodes,
      });
      const [row] = await db
        .insert(institutions)
        .values({ plaidInstitutionId, name: inst.institution.name })
        .onConflictDoUpdate({ target: institutions.plaidInstitutionId, set: { name: inst.institution.name } })
        .returning({ id: institutions.id });
      institutionId = row!.id;
    }

    const [item] = await db
      .insert(plaidItems)
      .values({
        plaidItemId: exchanged.item_id,
        institutionId,
        accessTokenEnc: encrypt(exchanged.access_token, env.ENCRYPTION_KEY),
      })
      .returning({ id: plaidItems.id });

    const result = await syncItem(sync, item!.id);
    syncUntilReady(sync, item!.id, (msg) => app.log.warn(msg));
    return { itemId: item!.id, ...result };
  });

  app.get('/items', async (): Promise<PlaidItemSummary[]> => {
    const rows = await db
      .select({
        id: plaidItems.id,
        institutionName: institutions.name,
        status: plaidItems.status,
        lastError: plaidItems.lastError,
        lastSyncedAt: plaidItems.lastSyncedAt,
        accountCount: count(accounts.id),
      })
      .from(plaidItems)
      .leftJoin(institutions, eq(institutions.id, plaidItems.institutionId))
      .leftJoin(accounts, eq(accounts.plaidItemId, plaidItems.id))
      .groupBy(plaidItems.id, institutions.name)
      .orderBy(institutions.name);
    return rows.map((r) => ({ ...r, lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null }));
  });

  app.post('/items/:id/sync', async (req): Promise<SyncResult> => {
    const item = await loadItem(parse(IdParams, req.params).id);
    // Demo connections have nothing to fetch; Refresh just says they're up to date.
    if (env.MELD_DEMO) {
      const [{ n }] = (await db.select({ n: count() }).from(accounts).where(eq(accounts.plaidItemId, item.id))) as [{ n: number }];
      return { accounts: n, added: 0, modified: 0, removed: 0, transactionsReady: true, holdings: 0, liabilities: 0 };
    }
    return syncItem(sync, item.id);
  });

  app.delete('/items/:id', async (req) => {
    const item = await loadItem(parse(IdParams, req.params).id);
    // A shared item is still in use by the other copy, so it stays linked at Plaid. Demo items never were.
    if (!env.PLAID_SHARED_ITEMS && !env.MELD_DEMO) {
      try {
        await plaid.itemRemove({ access_token: decrypt(item.accessTokenEnc, env.ENCRYPTION_KEY) });
      } catch (err) {
        // Still remove locally if Plaid already considers the item gone or invalid.
        app.log.warn({ plaidError: getPlaidError(err)?.error_code }, 'Plaid itemRemove failed; deleting locally anyway');
      }
    }
    await db.delete(plaidItems).where(eq(plaidItems.id, item.id));
    return { ok: true };
  });
}
