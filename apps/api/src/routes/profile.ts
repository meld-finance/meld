import { UserProfile } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/http';
import type { AppDeps } from '../server';
import { getProfile, saveProfile } from '../services/profile';

export async function registerProfileRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/profile', () => getProfile(db));
  app.put('/profile', (req) => saveProfile(db, parse(UserProfile, req.body)));
}
