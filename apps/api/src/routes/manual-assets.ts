import { ManualAssetInput, PropertyEstimateRequest, VehicleEstimateRequest, type ManualAsset } from '@meld/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAI } from '../ai/provider';
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
  address: manualAssets.address,
  ownershipPercent: manualAssets.ownershipPercent,
  valuationSources: manualAssets.valuationSources,
  vehicle: manualAssets.vehicle,
  depreciationPercent: manualAssets.depreciationPercent,
};

export async function registerManualAssetRoutes(app: FastifyInstance, { db: initialDb, ai, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;

  app.get('/manual-assets', async () =>
    (await getDb().select(columns).from(manualAssets).orderBy(asc(manualAssets.name))) as ManualAsset[],
  );

  /** Rough market value from real estate sites; the app fills the form with it and nothing is saved. */
  app.post('/manual-assets/estimate', async (req) => {
    const { address } = parse(PropertyEstimateRequest, req.body);
    return requireAI(ai).estimatePropertyValue(address);
  });

  /** Rough private-party value from car pricing sites; like the property estimate, nothing is saved. */
  app.post('/manual-assets/estimate-vehicle', async (req) => {
    const vehicle = parse(VehicleEstimateRequest, req.body);
    return requireAI(ai).estimateVehicleValue(vehicle);
  });

  app.post('/manual-assets', async (req) => {
    const db = getDb();
    const input = parse(ManualAssetInput, req.body);
    const [row] = await db.insert(manualAssets).values(input).returning(columns);
    await recordSnapshot(db);
    return row;
  });

  app.patch('/manual-assets/:id', async (req) => {
    const db = getDb();
    const { id } = parse(IdParams, req.params);
    const input = parse(ManualAssetInput.partial(), req.body);
    const [row] = await db.update(manualAssets).set(input).where(eq(manualAssets.id, id)).returning(columns);
    if (!row) throw new HttpError(404, 'Asset not found');
    await recordSnapshot(db);
    return row;
  });

  app.delete('/manual-assets/:id', async (req) => {
    const db = getDb();
    const { id } = parse(IdParams, req.params);
    const [row] = await db.delete(manualAssets).where(eq(manualAssets.id, id)).returning({ id: manualAssets.id });
    if (!row) throw new HttpError(404, 'Asset not found');
    await recordSnapshot(db);
    return { ok: true };
  });
}
