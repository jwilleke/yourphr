import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { guardedFetch, headersForRedirect } from '../guarded-fetch.js';

// Two loopback servers on different ports are two ORIGINS — the provider and "somewhere else".
let provider: Server;
let elsewhere: Server;
let providerUrl = '';
let elsewhereUrl = '';
const seen: { where: string; headers: IncomingHttpHeaders }[] = [];

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

beforeAll(async () => {
  elsewhere = createServer((req, res) => {
    seen.push({ where: 'elsewhere', headers: req.headers });
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  elsewhereUrl = await listen(elsewhere);
  provider = createServer((req, res) => {
    seen.push({ where: `provider${req.url}`, headers: req.headers });
    if (req.url === '/cross') {
      res.writeHead(302, { location: `${elsewhereUrl}/data` });
      res.end();
    } else if (req.url === '/same') {
      res.writeHead(302, { location: '/final' });
      res.end();
    } else {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    }
  });
  providerUrl = await listen(provider);
});

afterAll(() => {
  provider.close();
  elsewhere.close();
});

const credentials = { authorization: 'Bearer patient-token', cookie: 'sid=1', 'x-trace': 'kept' };

describe('guardedFetch redirects never carry the caller\'s credentials to another origin (yourphr#811)', () => {
  it('a cross-origin redirect arrives WITHOUT Authorization or Cookie, other headers intact', async () => {
    seen.length = 0;
    const res = await guardedFetch(`${providerUrl}/cross`, { allowInternal: true, headers: credentials });
    expect(res.status).toBe(200);
    expect(res.chain).toEqual([`${providerUrl}/cross`, `${elsewhereUrl}/data`]);
    const atElsewhere = seen.find((s) => s.where === 'elsewhere')!.headers;
    expect(atElsewhere.authorization).toBeUndefined();
    expect(atElsewhere.cookie).toBeUndefined();
    expect(atElsewhere['x-trace']).toBe('kept');
    // The provider itself did receive them — stripping is per hop, not a blanket removal.
    expect(seen.find((s) => s.where === 'provider/cross')!.headers.authorization).toBe('Bearer patient-token');
  });

  it('a same-origin redirect keeps the credentials', async () => {
    seen.length = 0;
    await guardedFetch(`${providerUrl}/same`, { allowInternal: true, headers: credentials });
    expect(seen.find((s) => s.where === 'provider/final')!.headers.authorization).toBe('Bearer patient-token');
  });
});

describe('headersForRedirect', () => {
  const h = { Authorization: 'Bearer t', 'Proxy-Authorization': 'Basic p', Cookie: 'c', Accept: 'application/fhir+json' };

  it('refuses https → http, same host or not', () => {
    expect(() => headersForRedirect(new URL('https://ehr.example/fhir'), new URL('http://ehr.example/fhir'), h)).toThrow(/leave HTTPS/);
    expect(() => headersForRedirect(new URL('https://ehr.example/fhir'), new URL('http://cdn.example/x'), {})).toThrow(/leave HTTPS/);
  });

  it('strips credential headers case-insensitively across origins — a port or scheme change is another origin', () => {
    const expected = { Accept: 'application/fhir+json' };
    expect(headersForRedirect(new URL('https://ehr.example/a'), new URL('https://cdn.example/b'), h)).toEqual(expected);
    expect(headersForRedirect(new URL('https://ehr.example/a'), new URL('https://ehr.example:8443/b'), h)).toEqual(expected);
    expect(headersForRedirect(new URL('http://ehr.example/a'), new URL('https://ehr.example/b'), h)).toEqual(expected);
  });

  it('keeps everything on the same origin', () => {
    expect(headersForRedirect(new URL('https://ehr.example/a'), new URL('https://ehr.example/b?page=2'), h)).toEqual(h);
  });
});
