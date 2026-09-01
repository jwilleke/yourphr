/**
 * Companion device tokens — the credential a patient hands a phone so it can POST health samples.
 *
 * Lives next to the SQLite provider because the teeth that must not regress (hash not stored,
 * unreadable expiry) inspect the table. check:store allows the driver under providers/.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { DeviceTokensManager, DEVICE_TOKEN_PREFIX, NO_EXPIRY } from '../../managers/DeviceTokensManager.js';
import { SqliteDeviceTokensProvider } from '../SqliteDeviceTokensProvider.js';

let db: InstanceType<typeof Database>;
let engine: Engine;
let tokens: DeviceTokensManager;
let jim: ApiContext;
let pat: ApiContext;

async function boot(): Promise<void> {
  db = new Database(':memory:');
  engine = new Engine();
  tokens = new DeviceTokensManager(engine, new SqliteDeviceTokensProvider(db));
  engine.register('deviceTokens', tokens);
  await engine.initialize();
  jim = ApiContext.from({ username: 'jim', role: 'user' }, engine);
  pat = ApiContext.from({ username: 'pat', role: 'user' }, engine);
}

beforeEach(async () => { await boot(); });

describe('minting', () => {
  it('returns the cleartext once and never stores it', async () => {
    const { token, record } = await tokens.mint(jim, 'iPhone', 0);
    expect(token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect((record as Record<string, unknown>).hash).toBeUndefined();
    const stored = db.prepare('SELECT hash, prefix FROM device_tokens').get() as { hash: string; prefix: string };
    expect(stored.hash.startsWith('sha256:')).toBe(true);
    expect(stored.hash).not.toContain(token);
    expect(token.startsWith(stored.prefix)).toBe(true);
    expect(record.expiresAt).toBe(NO_EXPIRY);
    expect(record.status).toBe('active');
  });

  it('names an unnamed token and honours an expiry in days', async () => {
    const unnamed = await tokens.mint(jim, '  ', 0);
    expect(unnamed.record.name).toMatch(/^Access Token -/);
    const week = await tokens.mint(jim, 'Watch', 7);
    const remaining = Date.parse(week.record.expiresAt) - Date.now();
    expect(remaining).toBeGreaterThan(6 * 86_400_000);
    expect(remaining).toBeLessThanOrEqual(7 * 86_400_000);
  });

  it('refuses a negative expiration', async () => {
    await expect(tokens.mint(jim, 'x', -1)).rejects.toThrow(/non-negative/);
  });
});

describe('verifying', () => {
  it('accepts a live token and answers the owner', async () => {
    const { token } = await tokens.mint(jim, 'iPhone', 30);
    const verified = await tokens.verify(token);
    expect(verified?.owner).toBe('jim');
    expect(verified?.name).toBe('iPhone');
  });

  it('refuses an unknown value, a prefix-less one, an expired one and a revoked one', async () => {
    const { token, record } = await tokens.mint(jim, 'x', 1);
    expect(await tokens.verify(`${DEVICE_TOKEN_PREFIX}made-up`)).toBeUndefined();
    expect(await tokens.verify(token.slice(DEVICE_TOKEN_PREFIX.length))).toBeUndefined();
    expect(await tokens.verify(token, Date.now() + 2 * 86_400_000)).toBeUndefined();
    await tokens.revoke(jim, record.id);
    expect(await tokens.verify(token)).toBeUndefined();
  });

  it('an unreadable expiry stops the token AND keeps it visible', async () => {
    const { token, record } = await tokens.mint(jim, 'x', 0);
    db.prepare('UPDATE device_tokens SET expires_at = ? WHERE id = ?').run('soon', record.id);
    expect(await tokens.verify(token)).toBeUndefined();
    const listed = (await tokens.listForOwner(jim)).find((t) => t.id === record.id);
    expect(listed).toBeDefined();
    expect(listed?.live).toBe(false);
    expect(listed?.status).toBe('expired');
  });

  it('stamps last use', async () => {
    const { token, record } = await tokens.mint(jim, 'x', 0);
    expect((await tokens.listForOwner(jim))[0]?.lastUsedAt).toBe('');
    await tokens.verify(token);
    expect((await tokens.listForOwner(jim)).find((t) => t.id === record.id)?.lastUsedAt).not.toBe('');
  });
});

describe('a companion cannot manage tokens — including its own', () => {
  it('refuses mint, list and revoke from a device context or an agent context', async () => {
    const { record } = await tokens.mint(jim, 'x', 0);
    const device = ApiContext.device('jim', 'user', { id: record.id, name: 'iPhone' }, engine);
    const agent = ApiContext.agent('jim', { id: 'tok_x', name: 'Claude', scopes: ['Health'] }, engine);
    await expect(tokens.mint(device, 'y', 0)).rejects.toThrow(/cannot manage device tokens/);
    await expect(tokens.listForOwner(device)).rejects.toThrow(/cannot manage device tokens/);
    await expect(tokens.revoke(device, record.id)).rejects.toThrow(/cannot manage device tokens/);
    await expect(tokens.mint(agent, 'y', 0)).rejects.toThrow(/cannot manage device tokens/);
  });
});

describe('listing and revocation', () => {
  it('one account never sees or revokes another\'s tokens', async () => {
    const mine = await tokens.mint(jim, 'mine', 0);
    await tokens.mint(pat, 'theirs', 0);
    expect((await tokens.listForOwner(jim)).map((t) => t.name)).toEqual(['mine']);
    await expect(tokens.revoke(pat, mine.record.id)).rejects.toThrow(/no such token/);
  });

  it('an account\'s tokens go when the account does', async () => {
    await tokens.mint(jim, 'x', 0);
    await tokens.mint(pat, 'y', 0);
    await tokens.removeForUser(jim);
    expect(await tokens.listForOwner(jim)).toHaveLength(0);
    expect(await tokens.listForOwner(pat)).toHaveLength(1);
  });
});
