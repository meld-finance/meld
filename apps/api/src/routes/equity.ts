import {
  EquityGrantInput,
  EquityTableExtractRequest,
  EquityVestConfirmInput,
  type EquityGrantExtraction,
} from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAI } from '../ai/provider';
import { IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import { confirmVest, createGrant, deleteGrant, getEquitySummary, getGrant, updateGrant } from '../services/equity';
import { deleteDocumentIfUnused, storeUploadedPdf } from './insurance';

const VestParams = z.object({ vestId: z.string().uuid() });

export async function registerEquityRoutes(app: FastifyInstance, { db: initialDb, ai, storage, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;

  app.get('/equity', () => getEquitySummary(getDb()));

  app.get('/equity/:id', (req) => getGrant(getDb(), parse(IdParams, req.params).id));

  app.post('/equity', (req) => createGrant(getDb(), parse(EquityGrantInput, req.body)));

  app.put('/equity/:id', async (req) => {
    const db = getDb();
    const { id } = parse(IdParams, req.params);
    const input = parse(EquityGrantInput, req.body);
    const { grant, previousDocumentId } = await updateGrant(db, id, input);
    if (previousDocumentId) await deleteDocumentIfUnused(db, storage, previousDocumentId);
    return grant;
  });

  app.delete('/equity/:id', async (req) => {
    const db = getDb();
    const { id } = parse(IdParams, req.params);
    const { documentId } = await deleteGrant(db, id);
    await deleteDocumentIfUnused(db, storage, documentId);
    return { ok: true };
  });

  app.patch('/equity/vests/:vestId', (req) => {
    const { vestId } = parse(VestParams, req.params);
    return confirmVest(getDb(), vestId, parse(EquityVestConfirmInput, req.body));
  });

  app.post('/equity/extract', async (req): Promise<EquityGrantExtraction> => {
    const db = getDb();
    const provider = requireAI(ai);
    const { documentId, filename, data } = await storeUploadedPdf(req, db, storage, 'equity');
    try {
      const { draft, warnings } = await provider.extractEquityGrantFromPdf(data);
      return { documentId, filename, draft: { ...draft, documentId }, warnings };
    } catch (err) {
      await deleteDocumentIfUnused(db, storage, documentId);
      throw err;
    }
  });

  app.post('/equity/extract-text', async (req): Promise<EquityGrantExtraction> => {
    const provider = requireAI(ai);
    const { text } = parse(EquityTableExtractRequest, req.body);
    const { draft, warnings } = await provider.extractEquityGrantFromText(text);
    return { documentId: null, filename: null, draft: { ...draft, documentId: null }, warnings };
  });
}
