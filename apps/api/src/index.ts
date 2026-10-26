import { createDb } from './db/client';
import { loadEnv } from './env';
import { buildServer } from './server';

const env = loadEnv();
const { db } = createDb(env.DATABASE_URL);
const app = await buildServer(env, db);

// Listen on localhost only; change when hosting.
await app.listen({ port: env.API_PORT, host: '127.0.0.1' });
