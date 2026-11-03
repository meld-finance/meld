import { AlertSettings, DEFAULT_ALERT_SETTINGS } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { alertSettings } from '../db/schema';

export async function getAlertSettings(db: Db): Promise<AlertSettings> {
  const row = await db.query.alertSettings.findFirst({ where: eq(alertSettings.id, 1) });
  // Saved settings over the defaults, so fields added later still parse.
  const parsed = AlertSettings.safeParse({ ...DEFAULT_ALERT_SETTINGS, ...(row?.settings ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_ALERT_SETTINGS;
}

export async function saveAlertSettings(db: Db, settings: AlertSettings): Promise<AlertSettings> {
  await db
    .insert(alertSettings)
    .values({ id: 1, settings })
    .onConflictDoUpdate({ target: alertSettings.id, set: { settings } });
  return settings;
}
