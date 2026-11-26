import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client';
import { loadEnv } from '../env';
import { createDemoModeController, staticRuntimeMode } from './mode';

const key = Buffer.alloc(32, 7).toString('base64');

function makeEnv(extra: NodeJS.ProcessEnv = {}) {
  return loadEnv({
    SANDBOX_DATABASE_URL: 'postgres://meld:meld@127.0.0.1:5432/meld_sandbox',
    PRODUCTION_DATABASE_URL: 'postgres://meld:meld@127.0.0.1:5432/meld',
    PLAID_ENV: 'production',
    PLAID_CLIENT_ID: 'client-id',
    PLAID_PRODUCTION_SECRET: 'prod-secret',
    SESSION_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: key,
    ...extra,
  });
}

describe('demo mode controller', () => {
  it('switches to demo mode lazily, caches the demo connection, and returns to real mode', async () => {
    const realDb = { kind: 'real' } as unknown as Db;
    const realSql = { end: vi.fn(async () => {}) };
    const demoDb = { kind: 'demo' } as unknown as Db;
    const demoSql = { end: vi.fn(async () => {}) };
    const createDb = vi.fn(() => ({ db: demoDb, sql: demoSql }));
    const ensureDatabase = vi.fn(async () => {});
    const migrate = vi.fn(async () => {});
    const ensureDemoData = vi.fn(async () => true);
    const seedDemo = vi.fn(async () => {});
    const persistDemo = vi.fn(async () => {});

    const controller = createDemoModeController({
      env: makeEnv(),
      initialDb: realDb,
      initialSql: realSql,
      createDb,
      ensureDatabase,
      migrate,
      ensureDemoData,
      seedDemo,
      persistDemo,
    });

    expect(controller.demoAvailable).toBe(true);
    expect(controller.isDemo()).toBe(false);
    expect(controller.getDb()).toBe(realDb);

    await controller.setDemo!(true);
    expect(controller.isDemo()).toBe(true);
    expect(controller.getDb()).toBe(demoDb);
    expect(ensureDatabase).toHaveBeenCalledWith('postgres://meld:meld@127.0.0.1:5432/meld_demo');
    expect(migrate).toHaveBeenCalledWith('postgres://meld:meld@127.0.0.1:5432/meld_demo');
    expect(createDb).toHaveBeenCalledTimes(1);
    expect(ensureDemoData).toHaveBeenCalledWith(demoDb);
    expect(seedDemo).not.toHaveBeenCalled();
    expect(persistDemo).toHaveBeenLastCalledWith(true);

    // Entering demo again reuses the existing pool instead of creating another one.
    await controller.setDemo!(true);
    expect(createDb).toHaveBeenCalledTimes(1);
    expect(ensureDemoData).toHaveBeenCalledTimes(2);

    // Resetting invokes seedDemo instead of ensureDemoData.
    await controller.setDemo!(true, { reset: true });
    expect(seedDemo).toHaveBeenCalledWith(demoDb);

    // Returning to real mode uses the original DB connection without re-migrating.
    await controller.setDemo!(false);
    expect(controller.isDemo()).toBe(false);
    expect(controller.getDb()).toBe(realDb);
    expect(persistDemo).toHaveBeenLastCalledWith(false);

    await controller.close!();
    expect(realSql.end).toHaveBeenCalledTimes(1);
    expect(demoSql.end).toHaveBeenCalledTimes(1);
  });

  it('starts in demo mode and lazily connects/migrates the real database when Plaid keys exist', async () => {
    const demoDb = { kind: 'demo' } as unknown as Db;
    const realDb = { kind: 'real' } as unknown as Db;
    const realSql = { end: vi.fn(async () => {}) };
    const migrate = vi.fn(async () => {});
    const onRealDbReady = vi.fn();

    const controller = createDemoModeController({
      env: makeEnv({ MELD_DEMO: '1', MIGRATE_ON_START: '0' }),
      initialDb: demoDb,
      createDb: vi.fn(() => ({ db: realDb, sql: realSql })),
      migrate,
      onRealDbReady,
    });

    expect(controller.isDemo()).toBe(true);
    expect(controller.getDb()).toBe(demoDb);

    await controller.setDemo!(false);
    expect(migrate).toHaveBeenCalledWith('postgres://meld:meld@127.0.0.1:5432/meld');
    expect(onRealDbReady).toHaveBeenCalledWith(realDb);
    expect(controller.isDemo()).toBe(false);
    expect(controller.getDb()).toBe(realDb);
  });

  it('refuses to leave demo mode when Plaid keys are missing', async () => {
    const controller = createDemoModeController({
      env: makeEnv({ MELD_DEMO: '1', PLAID_CLIENT_ID: '', PLAID_PRODUCTION_SECRET: '' }),
      initialDb: {} as Db,
    });
    await expect(controller.setDemo!(false)).rejects.toThrow(/Add your Plaid keys first/);
    expect(controller.isDemo()).toBe(true);
  });

  it('disables demo mode switching when no separate demo database URL is configured', async () => {
    const controller = createDemoModeController({
      env: loadEnv({
        DATABASE_URL: 'postgres://meld:meld@127.0.0.1:5432/meld',
        PLAID_ENV: 'production',
        PLAID_CLIENT_ID: 'client-id',
        PLAID_PRODUCTION_SECRET: 'prod-secret',
        SESSION_SECRET: 'x'.repeat(32),
        ENCRYPTION_KEY: key,
      }),
      initialDb: {} as Db,
    });
    expect(controller.demoAvailable).toBe(false);
    await expect(controller.setDemo!(true)).rejects.toThrow(/separate demo database/);
  });

  it('refuses demo mode if DEMO_DATABASE_URL points at the real database', async () => {
    const controller = createDemoModeController({
      env: makeEnv({ DEMO_DATABASE_URL: 'postgres://meld:meld@127.0.0.1:5432/meld' }),
      initialDb: {} as Db,
    });
    expect(controller.demoAvailable).toBe(false);
    await expect(controller.setDemo!(true)).rejects.toThrow(/separate demo database/);
  });

  it('serializes concurrent mode switches via its mutex', async () => {
    const order: string[] = [];
    let releaseSeed!: () => void;
    const seedGate = new Promise<void>((resolve) => {
      releaseSeed = resolve;
    });

    const realDb = { kind: 'real' } as unknown as Db;
    const demoDb = { kind: 'demo' } as unknown as Db;
    const controller = createDemoModeController({
      env: makeEnv(),
      initialDb: realDb,
      createDb: () => ({ db: demoDb, sql: { end: async () => {} } }),
      ensureDatabase: async () => {},
      migrate: async () => {},
      ensureDemoData: async () => true,
      seedDemo: async () => {
        order.push('seed:start');
        await seedGate;
        order.push('seed:end');
      },
      persistDemo: async (enabled) => {
        order.push(`persist:${enabled}`);
      },
    });

    const p1 = controller.setDemo!(true, { reset: true });
    const p2 = controller.setDemo!(false);
    // Allow microtasks up to seedDemo to run before releasing the gate.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['seed:start']);
    releaseSeed();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['seed:start', 'seed:end', 'persist:true', 'persist:false']);
    expect(controller.isDemo()).toBe(false);
    expect(controller.getDb()).toBe(realDb);
  });

  it('staticRuntimeMode exposes the fixed database and env flag', () => {
    const db = {} as Db;
    const mode = staticRuntimeMode(db, makeEnv({ MELD_DEMO: '1' }));
    expect(mode.getDb()).toBe(db);
    expect(mode.isDemo()).toBe(true);
    expect(mode.demoAvailable).toBe(false);
    expect(mode.setDemo).toBeUndefined();
  });
});
