import type { ReleaseList } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import type { ReleaseNotes } from '../services/releases';

/** What's new: Meld's published releases, for the release notes page. */
export async function registerReleaseRoutes(app: FastifyInstance, notes: ReleaseNotes) {
  app.get('/releases', async (): Promise<ReleaseList> => ({ releases: await notes.list() }));
}
