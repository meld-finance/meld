import { UserProfile } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/http';
import type { AppDeps } from '../server';
import { getProfile, saveProfile } from '../services/profile';

export async function registerProfileRoutes(app: FastifyInstance, { db: initialDb, runtime }: AppDeps) {
  const getDb = () => runtime?.getDb() ?? initialDb;
  app.get('/profile', () => getProfile(getDb()));
  app.put('/profile', (req) => saveProfile(getDb(), parse(UserProfile, req.body)));
}
