import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Engine } from '../../../framework/Engine.js';
import { ConfigurationManager } from '../../../framework/ConfigurationManager.js';
import { PolicyManager } from '../../../framework/managers/PolicyManager.js';
import { FakeConfigProvider } from '../../../framework/providers/__tests__/FakeConfigProvider.js';
import { OutboundHttp } from '../../../http/index.js';
import { DEFAULT_PUBLIC_RELAY, RelayProvider } from '../RelayProvider.js';

/** A scripted relay: /pending answers whatever the spec queued, in order. */
let answers: { status: number; body?: string }[];
let seen: { path: string; token: string | undefined }[];
let server: Server;
let base: string;

async function boot(custom: Record<string, string> = {}, env: Record<string, string> = {}, http = new OutboundHttp()): Promise<RelayProvider> {
  // The secret is env-owned (yourphr.config.env-keys), so it arrives as YOURPHR_RELAY_SECRET —
  // custom config cannot set it, by design.
  if (custom['yourphr.relay.secret'] !== undefined) {
    env['YOURPHR_RELAY_SECRET'] = custom['yourphr.relay.secret'];
    delete custom['yourphr.relay.secret'];
  }
  const engine = new Engine();
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(custom), { env })).register('policy', new PolicyManager(engine));
  await engine.initialize();
  // The SSRF guard is ON (no allowInternal). The fake relay is a loopback server, so every spec that
  // reaches it proves an operator-set relay on a private address is polled (yourphr#749).
  return new RelayProvider(engine, http, { sleep: async () => undefined });
}

beforeEach(async () => {
  answers = [];
  seen = [];
  server = createServer((req, res) => {
    seen.push({ path: req.url ?? '', token: req.headers['x-yourphr-token'] as string | undefined });
    const next = answers.shift() ?? { status: 404 };
    res.writeHead(next.status, { 'Content-Type': 'application/json' });
    res.end(next.body ?? '{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterEach(() => server.close());

describe('RelayProvider — resolution', () => {
  it('nothing set: the project relay, honestly labeled default; not ready without a secret', async () => {
    const relay = await boot();
    expect(relay.resolved()).toMatchObject({
      callback_url: `${DEFAULT_PUBLIC_RELAY}/callback`,
      configured: false,
      ready: false,
      public_url: { value: DEFAULT_PUBLIC_RELAY, source: 'default' },
      poll_url: { value: DEFAULT_PUBLIC_RELAY, source: 'default' },
      secret: { value: '', source: 'unset' },
    });
  });

  it('a poll URL alone is inherited as the public one; the secret makes it ready and is never echoed', async () => {
    const relay = await boot({ 'yourphr.relay.url': 'https://relay.example.org/', 'yourphr.relay.secret': 's3cret' });
    const resolved = relay.resolved();
    expect(resolved).toMatchObject({
      callback_url: 'https://relay.example.org/callback',
      configured: true,
      ready: true,
      public_url: { value: 'https://relay.example.org/', source: 'inherited' },
      poll_url: { value: 'https://relay.example.org/', source: 'configured', config_key: 'yourphr.relay.url' },
    });
    expect(JSON.stringify(resolved)).not.toContain('s3cret');
  });

  it('both set: each labeled configured, callback from the public one', async () => {
    const relay = await boot({ 'yourphr.relay.public-url': 'https://relay.example.org', 'yourphr.relay.url': 'https://poll.example.org' });
    expect(relay.resolved()).toMatchObject({
      callback_url: 'https://relay.example.org/callback',
      public_url: { source: 'configured' },
      poll_url: { value: 'https://poll.example.org', source: 'configured' },
    });
  });
});

describe('RelayProvider — fetchCode (the product\'s #406 contract)', () => {
  it('refuses without a secret, before any network: relay_not_configured', async () => {
    const relay = await boot({ 'yourphr.relay.url': base });
    await expect(relay.fetchCode('st')).rejects.toMatchObject({ status: 501, extra: { error_code: 'relay_not_configured' } });
    expect(seen).toHaveLength(0);
  });

  it('polls with the shared secret until the code arrives, and brings it home', async () => {
    answers = [{ status: 404 }, { status: 404 }, { status: 200, body: '{"code":"auth-code-1"}' }];
    const relay = await boot({ 'yourphr.relay.url': base, 'yourphr.relay.secret': 's3cret' });
    expect(await relay.fetchCode('st-1')).toBe('auth-code-1');
    expect(seen).toHaveLength(3);
    expect(seen[0]).toEqual({ path: '/pending?state=st-1', token: 's3cret' });
  });

  it('a rejected secret is terminal, not retried: relay_unauthorized', async () => {
    answers = [{ status: 401 }];
    const relay = await boot({ 'yourphr.relay.url': base, 'yourphr.relay.secret': 'wrong' });
    await expect(relay.fetchCode('st')).rejects.toMatchObject({ status: 502, extra: { error_code: 'relay_unauthorized' } });
    expect(seen).toHaveLength(1);
  });

  it('an unexpected answer is terminal: relay_poll_failed', async () => {
    answers = [{ status: 500 }];
    const relay = await boot({ 'yourphr.relay.url': base, 'yourphr.relay.secret': 's' });
    await expect(relay.fetchCode('st')).rejects.toMatchObject({ status: 502, extra: { error_code: 'relay_poll_failed' } });
  });

  it('a code that never arrives times out retryably: relay_poll_timeout', async () => {
    const relay = await boot({ 'yourphr.relay.url': base, 'yourphr.relay.secret': 's' });
    // pollSeconds 0: the deadline is already past after the first 404.
    await expect(relay.fetchCode('st', 0)).rejects.toMatchObject({ status: 504, extra: { error_code: 'relay_poll_timeout' } });
  });
});

describe('RelayProvider — which door the poll uses (yourphr#749)', () => {
  it('an operator-set relay on a private address is reached with the SSRF guard on', async () => {
    answers = [{ status: 200, body: '{"code":"lan-code"}' }];
    const relay = await boot({ 'yourphr.relay.url': base, 'yourphr.relay.secret': 's' });
    expect(await relay.fetchCode('st')).toBe('lan-code');
  });

  it('a public-url alone counts as operator-set: the poll inherits it and is trusted too', async () => {
    answers = [{ status: 200, body: '{"code":"inherited"}' }];
    const relay = await boot({ 'yourphr.relay.public-url': base, 'yourphr.relay.secret': 's' });
    expect(await relay.fetchCode('st')).toBe('inherited');
  });

  it('does not follow a redirect from the configured relay — the secret never goes anywhere else', async () => {
    answers = [{ status: 302 }];
    const relay = await boot({ 'yourphr.relay.url': base, 'yourphr.relay.secret': 's' });
    await expect(relay.fetchCode('st')).rejects.toMatchObject({ status: 502, extra: { error_code: 'relay_poll_failed' } });
    expect(seen).toHaveLength(1);
  });

  it('an unusable configured address is relay_poll_failed, not a crash', async () => {
    const relay = await boot({ 'yourphr.relay.url': 'relay:8080', 'yourphr.relay.secret': 's' });
    await expect(relay.fetchCode('st')).rejects.toMatchObject({ status: 502, extra: { error_code: 'relay_poll_failed' } });
  });

  it('the project default relay still goes through the guarded client', async () => {
    const calls: string[] = [];
    const guarded = new OutboundHttp();
    guarded.get = async (url: string) => {
      calls.push(url);
      return { status: 200, body: Buffer.from('{"code":"default-code"}'), headers: {}, url } as never;
    };
    const relay = await boot({ 'yourphr.relay.secret': 's' }, {}, guarded);
    expect(await relay.fetchCode('st')).toBe('default-code');
    expect(calls).toEqual([`${DEFAULT_PUBLIC_RELAY}/pending?state=st`]);
  });
});

describe('RelayProvider — checkHealth, the dashboard\'s reachability probe (yourphr#870)', () => {
  it('a configured relay answering /healthz 200 is healthy, and the probe carries no secret', async () => {
    answers = [{ status: 200, body: 'ok' }];
    const relay = await boot({ 'yourphr.relay.url': base, 'yourphr.relay.secret': 's3cret' });
    expect(await relay.checkHealth()).toEqual({ ok: true, url: base, status: 200 });
    expect(seen).toEqual([{ path: '/healthz', token: undefined }]);
  });

  it('a non-200 answer is unhealthy, with the status said', async () => {
    answers = [{ status: 503 }];
    const relay = await boot({ 'yourphr.relay.url': `${base}/`, 'yourphr.relay.secret': 's' });
    expect(await relay.checkHealth()).toEqual({ ok: false, url: base, status: 503, error: 'the relay answered 503 to /healthz' });
  });

  it('a relay that never answers is unhealthy within the timeout — it does not hang the caller', async () => {
    const silent = createServer(() => { /* never answers */ });
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const address = silent.address();
    const silentBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      const relay = await boot({ 'yourphr.relay.url': silentBase, 'yourphr.relay.secret': 's' });
      const started = Date.now();
      const health = await relay.checkHealth(100);
      expect(health).toMatchObject({ ok: false, url: silentBase });
      expect(health.error).toBeTruthy();
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      silent.closeAllConnections();
      silent.close();
    }
  });

  it('an unusable configured address is unhealthy, not a throw', async () => {
    const relay = await boot({ 'yourphr.relay.url': 'relay:8080', 'yourphr.relay.secret': 's' });
    expect(await relay.checkHealth()).toMatchObject({ ok: false, error: expect.stringContaining('not usable') });
  });

  it('the project default relay is probed through the guarded client, with a short timeout', async () => {
    const calls: { url: string; timeoutMs?: number }[] = [];
    const guarded = new OutboundHttp();
    guarded.get = async (url: string, options?: { timeoutMs?: number }) => {
      calls.push({ url, timeoutMs: options?.timeoutMs });
      return { status: 200, body: Buffer.from('ok'), headers: {}, url } as never;
    };
    const relay = await boot({ 'yourphr.relay.secret': 's' }, {}, guarded);
    expect(await relay.checkHealth()).toMatchObject({ ok: true, url: DEFAULT_PUBLIC_RELAY });
    expect(calls).toEqual([{ url: `${DEFAULT_PUBLIC_RELAY}/healthz`, timeoutMs: 3_000 }]);
  });
});
