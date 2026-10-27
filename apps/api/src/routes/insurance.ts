import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import {
  InsurancePolicyInput,
  maskPolicyNumber,
  type PolicyExtraction,
} from '@meld/shared';
import { and, eq, lt, notExists } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAI } from '../ai/provider';
import type { Db } from '../db/client';
import { documents, insurancePolicies } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';
import { listPolicies } from '../services/insurance';
import type { DocumentStorage } from '../storage';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** A document no policy references. */
const unreferenced = (db: Db) =>
  notExists(db.select().from(insurancePolicies).where(eq(insurancePolicies.documentId, documents.id)));

/** Deletes uploads that never became a policy (abandoned drafts), after a grace period. */
export async function pruneOrphanDocuments(db: Db, storage: DocumentStorage, olderThanMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const removed = await db
    .delete(documents)
    .where(and(lt(documents.createdAt, cutoff), unreferenced(db)))
    .returning({ storageKey: documents.storageKey });
  await Promise.all(removed.map((d) => storage.delete(d.storageKey)));
  return removed.length;
}

export async function registerInsuranceRoutes(app: FastifyInstance, { db, ai, storage }: AppDeps) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  async function getPolicy(id: string) {
    const [policy] = await listPolicies(db, eq(insurancePolicies.id, id));
    if (!policy) throw new HttpError(404, 'Policy not found');
    return policy;
  }

  async function parsePolicyInput(body: unknown) {
    const input = parse(InsurancePolicyInput, body);
    if (input.documentId) {
      const doc = await db.query.documents.findFirst({ where: eq(documents.id, input.documentId) });
      if (!doc) throw new HttpError(400, 'Attached document not found');
    }
    // Belt and braces: the column only ever holds the last 4 characters.
    return { ...input, policyNumberMask: maskPolicyNumber(input.policyNumberMask) };
  }

  /** Removes a document once nothing references it. */
  async function deleteDocumentIfUnused(documentId: string | null) {
    if (!documentId) return;
    const [doc] = await db
      .delete(documents)
      .where(and(eq(documents.id, documentId), unreferenced(db)))
      .returning({ storageKey: documents.storageKey });
    if (doc) await storage.delete(doc.storageKey);
  }

  app.get('/insurance', () => listPolicies(db));

  app.get('/insurance/:id', async (req) => getPolicy(parse(IdParams, req.params).id));

  app.post('/insurance', async (req) => {
    const input = await parsePolicyInput(req.body);
    const [row] = await db.insert(insurancePolicies).values(input).returning({ id: insurancePolicies.id });
    return getPolicy(row!.id);
  });

  app.put('/insurance/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const input = await parsePolicyInput(req.body);
    const before = await getPolicy(id);
    await db.update(insurancePolicies).set(input).where(eq(insurancePolicies.id, id));
    if (before.documentId !== input.documentId) await deleteDocumentIfUnused(before.documentId);
    return getPolicy(id);
  });

  app.delete('/insurance/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const [row] = await db
      .delete(insurancePolicies)
      .where(eq(insurancePolicies.id, id))
      .returning({ documentId: insurancePolicies.documentId });
    if (!row) throw new HttpError(404, 'Policy not found');
    await deleteDocumentIfUnused(row.documentId);
    return { ok: true };
  });

  /** Upload a policy PDF and get a draft back. Nothing is saved as a policy until the user confirms. */
  app.post('/insurance/extract', async (req): Promise<PolicyExtraction> => {
    const provider = requireAI(ai);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Attach a PDF file');
    const data = await file.toBuffer().catch((err: { code?: string }) => {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'PDFs must be 20 MB or smaller');
      throw err;
    });
    // Check the bytes, not just the client-supplied type.
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Only PDF files are supported');

    const filename = file.filename || 'policy.pdf';
    const storageKey = `insurance/${randomUUID()}.pdf`;
    await storage.put(storageKey, data);
    const [doc] = await db
      .insert(documents)
      .values({ filename, mimeType: 'application/pdf', sizeBytes: data.length, storageKey })
      .returning({ id: documents.id });

    try {
      const { draft, warnings } = await provider.extractInsurancePolicy(data);
      return { documentId: doc!.id, filename, draft: { ...draft, documentId: doc!.id }, warnings };
    } catch (err) {
      await deleteDocumentIfUnused(doc!.id);
      throw err;
    }
  });

  app.get('/documents/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
    if (!doc) throw new HttpError(404, 'Document not found');
    const data = await storage.get(doc.storageKey);
    return reply
      .type(doc.mimeType)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`)
      .header('Cache-Control', 'private, no-store')
      .send(data);
  });

  /** Discards an upload whose draft was cancelled. Documents attached to a policy are kept. */
  app.delete('/documents/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    await deleteDocumentIfUnused(id);
    return { ok: true };
  });
}
