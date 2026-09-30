/**
 * Connected-device grants (yourphr#807 design, #808). The patient's consent carries the term; the
 * device's keys live inside it. Each property below fails SILENTLY if it regresses — the device
 * keeps syncing, and nobody sees that it should have stopped — so each is asserted, not assumed:
 *
 *   - only the patient, freshly re-authenticated, can grant or extend;
 *   - a setup code works once; a refresh token works once, and a spent one revokes the grant;
 *   - a refresh never moves the end; password change / sign-out-everywhere and the term end it;
 *   - the per-patient cap holds, and suspended grants count toward it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../ApiContext.js';

const PASSWORD = 'a-long-enough-password';
const req = { remoteAddr: '127.0.0.1' };
const DAY = 86_400_000;

let dir: string;
let s: Stores;
let jim: ApiContext;
let sourceId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'device-grants-'));
  s = await openStores(dir, { YOURPHR_DEVICES_ENABLED: 'true', YOURPHR_DEVICES_MAX_PER_USER: '2' });
  await s.users.createUser(ApiContext.system('test', 'test', s.engine), 'jim', PASSWORD);
  jim = ApiContext.system('test', 'jim', s.engine);
  sourceId = `source-${(await s.sources.addDeviceSource(jim, "Jim's iPhone — Apple Health")).id}`;
});
afterEach(async () => { await s.close(); rmSync(dir, { recursive: true, force: true }); });

const tokens = () => s.engine.managers.agentTokens;
const grant = (now = Date.now(), password = PASSWORD, days?: number) =>
  tokens().createDeviceGrant(jim, { label: "Jim's iPhone — Apple Health", sourceId, credentials: { password }, request: req, ...(days ? { days } : {}) }, now);

describe('granting a device (yourphr#808)', () => {
  it('needs the patient to confirm it is them — a wrong password grants nothing', async () => {
    await expect(grant(Date.now(), 'not-the-password')).rejects.toMatchObject({ status: 401 });
    expect(await tokens().listDeviceGrants(jim)).toHaveLength(0);
  });

  it('a device key or other agent credential can never grant', async () => {
    const agent = ApiContext.agent('jim', { id: 'tok_x', name: 'agent', scopes: ['Summary'] }, s.engine);
    await expect(tokens().createDeviceGrant(agent, { label: 'x', sourceId, credentials: { password: PASSWORD }, request: req })).rejects.toMatchObject({ status: 403 });
  });

  it('the term is at most grant-max-days, default the maximum', async () => {
    await expect(grant(Date.now(), PASSWORD, 31)).rejects.toMatchObject({ status: 400 });
    const now = Date.now();
    const { grant: g } = await grant(now);
    expect(Date.parse(g.endsAt) - now).toBe(30 * DAY);
  });

  it('holds the per-patient cap, and records the grant in the access log', async () => {
    await grant();
    await grant();
    await expect(grant()).rejects.toMatchObject({ status: 409 });
    // The log buckets by day and category, counting each event.
    const granted = (await s.engine.managers.audit.list(jim)).find((e) => e.category === 'Device permission granted');
    expect(granted?.count).toBe(2);
  });
});

describe('the device\'s keys', () => {
  it('a setup code works once, for a key that verifies as this grant\'s', async () => {
    const { grant: g, setupCode } = await grant();
    const t = await tokens().claimDeviceGrant(setupCode);
    expect(t.token_type).toBe('Bearer');
    expect(t.grant_ends_at).toBe(g.endsAt);
    expect((await tokens().verify(t.access_token))?.grantId).toBe(g.id);
    await expect(tokens().claimDeviceGrant(setupCode)).rejects.toMatchObject({ status: 401 });
  });

  it('a setup code expires after setup-code-minutes', async () => {
    const now = Date.now();
    const { setupCode } = await grant(now);
    await expect(tokens().claimDeviceGrant(setupCode, now + 11 * 60_000)).rejects.toMatchObject({ status: 401 });
  });

  it('a refresh rotates both, revokes the old key, and never moves the end', async () => {
    const { grant: g, setupCode } = await grant();
    const first = await tokens().claimDeviceGrant(setupCode);
    const second = await tokens().refreshDeviceGrant(first.refresh_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.grant_ends_at).toBe(g.endsAt);
    expect(await tokens().verify(first.access_token)).toBeUndefined();
    expect(await tokens().verify(second.access_token)).toBeDefined();
  });

  it('a key never outlives the consent', async () => {
    const now = Date.now();
    const { setupCode } = await grant(now, PASSWORD, 1);
    const first = await tokens().claimDeviceGrant(setupCode, now);
    const late = await tokens().refreshDeviceGrant(first.refresh_token, now + DAY - 3_600_000); // an hour before the end
    expect(late.expires_in).toBe(3600);
  });

  it('a SPENT refresh token presented again revokes the whole grant, and says so in the log', async () => {
    const { setupCode } = await grant();
    const first = await tokens().claimDeviceGrant(setupCode);
    const second = await tokens().refreshDeviceGrant(first.refresh_token);
    await expect(tokens().refreshDeviceGrant(first.refresh_token)).rejects.toMatchObject({ status: 401 }); // the copy
    await expect(tokens().refreshDeviceGrant(second.refresh_token)).rejects.toMatchObject({ status: 401 }); // the real device too
    expect(await tokens().verify(second.access_token)).toBeUndefined();
    expect((await tokens().listDeviceGrants(jim))[0]?.status).toBe('revoked');
    expect((await s.engine.managers.audit.list(jim)).map((e) => e.category)).toContain('Device permission revoked: a copied key was used');
  });
});

describe('what ends a grant', () => {
  it('sign-out-everywhere (a moved token generation) ends it, keys and refresh alike', async () => {
    const { setupCode } = await grant();
    const t = await tokens().claimDeviceGrant(setupCode);
    await s.users.bumpGeneration('jim');
    expect(await tokens().verify(t.access_token)).toBeUndefined();
    await expect(tokens().refreshDeviceGrant(t.refresh_token)).rejects.toMatchObject({ status: 401 });
    expect((await tokens().listDeviceGrants(jim))[0]?.status).toBe('ended');
  });

  it('the end of the term ends it', async () => {
    const now = Date.now();
    const { setupCode } = await grant(now, PASSWORD, 1);
    const t = await tokens().claimDeviceGrant(setupCode, now);
    await expect(tokens().refreshDeviceGrant(t.refresh_token, now + DAY + 1)).rejects.toMatchObject({ status: 401 });
  });

  it('the patient revokes it', async () => {
    const { grant: g, setupCode } = await grant();
    const t = await tokens().claimDeviceGrant(setupCode);
    expect(await tokens().revokeDeviceGrant(jim, g.id)).toBe(true);
    expect(await tokens().verify(t.access_token)).toBeUndefined();
    await expect(tokens().refreshDeviceGrant(t.refresh_token)).rejects.toMatchObject({ status: 401 });
  });
});

describe('extending', () => {
  it('only the patient, re-authenticated, and at most the maximum from now', async () => {
    const now = Date.now();
    const { grant: g } = await grant(now, PASSWORD, 5);
    await expect(tokens().extendDeviceGrant(jim, g.id, { credentials: { password: 'wrong' }, request: req }, now)).rejects.toMatchObject({ status: 401 });
    await expect(tokens().extendDeviceGrant(jim, g.id, { days: 31, credentials: { password: PASSWORD }, request: req }, now)).rejects.toMatchObject({ status: 400 });
    const later = now + 3 * DAY;
    const extended = await tokens().extendDeviceGrant(jim, g.id, { days: 30, credentials: { password: PASSWORD }, request: req }, later);
    expect(Date.parse(extended.endsAt)).toBe(later + 30 * DAY);
  });
});

describe('end-of-term reminders (#807 decision 5)', () => {
  const titles = () => s.engine.managers.notifications.getUserNotifications('jim').map((n) => n.title);

  it('one notice at 7 days and one at 1 day before the end, each once', async () => {
    const t0 = Date.now();
    await grant(t0, PASSWORD, 30);
    expect(await tokens().remindEndingDevices(t0 + 22 * DAY)).toBe(0); // 8 days left
    expect(await tokens().remindEndingDevices(t0 + 23 * DAY + 1)).toBe(1); // inside 7 days
    expect(await tokens().remindEndingDevices(t0 + 24 * DAY)).toBe(0); // not again
    expect(await tokens().remindEndingDevices(t0 + 29 * DAY + 1)).toBe(1); // inside 1 day
    expect(titles().filter((t) => t.startsWith("Jim's iPhone — Apple Health can add to your record until"))).toHaveLength(2);
  });

  it('two thresholds crossed at once send one notice, not two', async () => {
    const t0 = Date.now();
    await grant(t0, PASSWORD, 1); // a 1-day grant starts inside both windows
    expect(await tokens().remindEndingDevices(t0 + 1000)).toBe(1);
    expect(await tokens().remindEndingDevices(t0 + 2000)).toBe(0);
  });

  it('extending starts the reminders over, and the end of the term is announced', async () => {
    const t0 = Date.now();
    const { grant: g } = await grant(t0, PASSWORD, 5);
    expect(await tokens().remindEndingDevices(t0 + DAY)).toBe(1);
    await tokens().extendDeviceGrant(jim, g.id, { days: 10, credentials: { password: PASSWORD }, request: req }, t0 + DAY);
    expect(await tokens().remindEndingDevices(t0 + 5 * DAY)).toBe(1); // 6 days left on the new term
    expect(await tokens().remindEndingDevices(t0 + 12 * DAY)).toBe(0); // term over: ends, no reminder
    expect(titles()).toContain("Jim's iPhone — Apple Health stopped syncing");
  });
});
