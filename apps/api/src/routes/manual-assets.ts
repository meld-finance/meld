import { ManualAssetInput, type ManualAsset } from '@meld/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { manualAssets } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import { recordSnapshot } from '../services/overview';
import type { AppDeps } from '../server';

const columns = {
  id: manualAssets.id,
  kind: manualAssets.kind,
  name: manualAssets.name,
  value: manualAssets.value,
  valueAsOf: manualAssets.valueAsOf,
  notes: manualAssets.notes,
};

export async function registerManualAssetRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/manual-assets', async () =>
    (await db.select(columns).from(manualAssets).orderBy(asc(manualAssets.name))) as ManualAsset[],
  );

  app.post('/manual-assets', async (req) => {
    const input = parse(ManualAssetInput, req.body);
    const [row] = await db.insert(manualAssets).values(input).returning(columns);
    await recordSnapshot(db);
    return row;
  });

  app.patch('/manual-assets/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const input = parse(ManualAssetInput.partial(), req.body);
    const [row] = await db.update(manualAssets).set(input).where(eq(manualAssets.id, id)).returning(columns);
    if (!row) throw new HttpError(404, 'Asset not found');
    await recordSnapshot(db);
    return row;
  });

  app.delete('/manual-assets/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const [row] = await db.delete(manualAssets).where(eq(manualAssets.id, id)).returning({ id: manualAssets.id });
    if (!row) throw new HttpError(404, 'Asset not found');
    await recordSnapshot(db);
    return { ok: true };
  });
}
