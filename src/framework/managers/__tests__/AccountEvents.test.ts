/**
 * Account events in the person's own access log, and trimming it (yourphr#507, Jim 2026-09-30):
 * successful sign-ins appear; the failure that pauses sign-ins appears ONCE, for a real account only;
 * the throttled answer is the same for any username; the person trims entries older than the
 * protected window, and the trim is recorded and survives later trims.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../ApiContext.js';
import { GENERIC_SIGNIN_ERROR, THROTTLED_SIGNIN_ERROR } from '../SessionsManager.js';

const PASSWORD = 'a-long-enough-password';
const req = { remoteAddr: '127.0.0.1' };
const DAY = 86_400_000;
let dir: string;
let s: Stores;
let jim: ApiContext;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'account-events-'));
  s = await openStores(dir, { YOURPHR_AUTH_THROTTLE_MAX_FAILURES: '3' });
  await s.users.createUser(ApiContext.system('test', 'test', s.engine), 'jim', PASSWORD);
  jim = ApiContext.system('test', 'jim', s.engine);
});
afterEach(async () => { await s.close(); rmSync(dir, { recursive: true, force: true }); });

const categories = async () => (await s.engine.managers.audit.list(jim)).map((e) => `${e.category}×${e.count}`);

describe('sign-in events in the person\'s own access log', () => {
  it('a successful sign-in appears as "Signed in", under the person\'s own name', async () => {
    expect((await s.sessions.signIn('jim', { password: PASSWORD }, req)).ok).toBe(true);
    const log = await s.engine.managers.audit.list(jim);
    expect(log).toContainEqual(expect.objectContaining({ category: 'Signed in', actor_username: 'jim', count: 1 }));
  });

  it('failures that pause sign-ins are recorded ONCE, and individual failures not at all', async () => {
    for (let i = 0; i < 3; i++) await s.sessions.signIn('jim', { password: 'wrong' }, req);
    for (let i = 0; i < 3; i++) await s.sessions.signIn('jim', { password: 'wrong' }, req); // still paused: no second line
    expect(await categories()).toEqual(['Sign-ins paused after repeated failed attempts×1']);
  });

  it('the throttled answer is the same for a real account and a made-up one, and the wrong-password answer stays generic', async () => {
    const first = await s.sessions.signIn('jim', { password: 'wrong' }, { remoteAddr: '10.0.0.1' });
    expect(first).toEqual({ ok: false, error: GENERIC_SIGNIN_ERROR });
    for (const name of ['jim', 'nobody-here']) {
      for (let i = 0; i < 3; i++) await s.sessions.signIn(name, { password: 'wrong' }, { remoteAddr: `10.0.1.${name.length}` });
      const paused = await s.sessions.signIn(name, { password: 'wrong' }, { remoteAddr: `10.0.1.${name.length}` });
      expect(paused).toMatchObject({ ok: false, error: THROTTLED_SIGNIN_ERROR, throttled: { retryAfterSeconds: expect.any(Number) } });
    }
  });
});

describe('trimming the access log (yourphr#507)', () => {
  const at = (msAgo: number) => new Date(Date.now() - msAgo);

  it('removes only entries older than the protected window, keeps recent ones, and records the trim', async () => {
    await s.engine.managers.audit.record(jim, 'Medications', at(200 * DAY));
    await s.engine.managers.audit.record(jim, 'Conditions', at(100 * DAY));
    await s.engine.managers.audit.record(jim, 'Summary', at(10 * DAY));
    const { removed } = await s.engine.managers.audit.trim(jim);
    expect(removed).toBe(2);
    expect(await categories()).toEqual(expect.arrayContaining(['Summary×1', 'Access log trimmed×1']));
    expect(await categories()).toHaveLength(2);
  });

  it('a later trim never removes the record of an earlier trim', async () => {
    await s.engine.managers.audit.trim(jim, at(200 * DAY));
    await s.engine.managers.audit.trim(jim);
    expect((await categories()).filter((c) => c.startsWith('Access log trimmed'))).toHaveLength(2);
  });

  it('a delegated credential cannot trim', async () => {
    const agent = ApiContext.agent('jim', { id: 'tok_x', name: 'agent', scopes: ['Summary'] }, s.engine);
    await expect(s.engine.managers.audit.trim(agent)).rejects.toMatchObject({ status: 403 });
  });
});
