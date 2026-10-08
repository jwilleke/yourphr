import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { Engine } from '../../Engine.js';
import { ConfigurationManager } from '../../ConfigurationManager.js';
import { PolicyManager } from '../PolicyManager.js';
import { FakeConfigProvider } from '../../providers/__tests__/FakeConfigProvider.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { SqliteDatabaseProvider } from '../../providers/SqliteDatabaseProvider.js';
import { addColumnWithDefault, type Migration } from '../../providers/sqlite-migrations.js';

const M1: Migration = { id: '20260101000000', description: 'accounts', up: (db) => db.exec('CREATE TABLE accounts (username TEXT PRIMARY KEY)') };
const M2: Migration = { id: '20260102000000', description: 'token generation', up: (db) => addColumnWithDefault(db, 'accounts', 'token_generation', 'INTEGER', 0) };

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'spike-database-spec-')); });

async function boot(ledger: Migration[], key = 'at-rest-key'): Promise<{ engine: Engine; database: DatabaseManager<InstanceType<typeof Database>>; provider: SqliteDatabaseProvider }> {
  const engine = new Engine();
  const provider = new SqliteDatabaseProvider(join(dir, 'app.db'), key, ledger);
  const database = new DatabaseManager(engine, provider);
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider())).register('policy', new PolicyManager(engine)).register('database', database);
  await engine.initialize();
  return { engine, database, provider };
}

describe('DatabaseManager — the engine owns the app database', () => {
  it('storage() answers the admin Database card for its own file — and only for an admin (yourphr#619)', async () => {
    const { engine, database } = await boot([M1]);
    const { ApiContext } = await import('../../ApiContext.js');
    const admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
    const member = ApiContext.from({ username: 'alice', role: 'user' }, engine);
    const storage = database.storage(admin);
    expect(storage.location).toBe(join(dir, 'app.db'));
    expect(storage.sizeBytes).toBeGreaterThan(0);
    expect(() => database.storage(member)).toThrow(/admin/);
    await engine.shutdown();
  });

  it('opens under the key and runs the ledger before anything is built over the handle; a reopen skips what was applied', async () => {
    const first = await boot([M1, M2]);
    expect(first.provider.migrations).toEqual({ applied: ['20260101000000', '20260102000000'], skipped: 0 });
    first.database.handle.prepare("INSERT INTO accounts (username) VALUES ('alice')").run();
    expect(await first.database.integrityOk()).toBe(true);
    await first.engine.shutdown();
    expect(() => first.database.handle.prepare('SELECT 1').get()).toThrow(/not open/);
    const again = await boot([M1, M2]);
    expect(again.provider.migrations).toEqual({ applied: [], skipped: 2 });
    expect(again.database.handle.prepare('SELECT token_generation FROM accounts').get()).toEqual({ token_generation: 0 });
    await again.engine.shutdown();
  });

  it('refuses a database from the future (a ledger entry this build does not know), and the wrong key', async () => {
    const newer = await boot([M1, M2]);
    await newer.engine.shutdown();
    expect(() => new SqliteDatabaseProvider(join(dir, 'app.db'), 'at-rest-key', [M1])).toThrow(/schema is newer than this build/);
    expect(() => new SqliteDatabaseProvider(join(dir, 'app.db'), 'another-key', [M1, M2])).toThrow();
  });

  it('opens in WAL with synchronous FULL, as ngdpbase does, so a backup never blocks a write (yourphr#867)', async () => {
    const { provider, engine } = await boot([]);
    expect((provider.handle.pragma('journal_mode') as { journal_mode: string }[])[0]?.journal_mode).toBe('wal');
    expect((provider.handle.pragma('synchronous') as { synchronous: number }[])[0]?.synchronous).toBe(2); // FULL
    await engine.shutdown();
  });

  it('is registered first so its shutdown runs last, and closes once', async () => {
    const { engine, provider } = await boot([M1]);
    expect(engine.registered).toEqual(['configuration', 'policy', 'database']);
    await engine.shutdown();
    await expect(provider.close()).resolves.toBeUndefined();
  });
});
