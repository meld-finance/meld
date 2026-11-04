import { PhoneAccessUpdate, type PhoneAccess } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { readSettings, writeSettings } from '../config-file';
import type { Env } from '../env';
import { parse } from '../lib/http';
import type { PhoneAccessService } from '../services/tailscale';

/** Phone access over Tailscale, for the desktop app. The choice is saved so it's re-applied at the next start. */
export async function registerPhoneAccessRoutes(app: FastifyInstance, env: Env, phone: PhoneAccessService) {
  async function remember(enabled: boolean) {
    if (!env.MELD_CONFIG_FILE) return;
    const settings = readSettings(env.MELD_CONFIG_FILE, env.ENCRYPTION_KEY);
    await writeSettings(env.MELD_CONFIG_FILE, env.ENCRYPTION_KEY, { ...settings, PHONE_ACCESS: enabled ? '1' : '' });
  }

  app.get('/phone-access', async (): Promise<PhoneAccess> => phone.get());

  app.put('/phone-access', async (req): Promise<PhoneAccess> => {
    const { enabled } = parse(PhoneAccessUpdate, req.body);
    const result = enabled ? await phone.enable() : await phone.disable();
    await remember(enabled);
    return result;
  });
}
