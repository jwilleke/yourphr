import { describe, expect, it } from 'vitest';
import { requestAdvertisedOrigins, serverBaseUrls, serverDiscovery } from '../discovery.js';
import type { NetworkInterfaceInfo } from 'node:os';

const cfg = { listenPort: 8080, hostPort: '', hostIp: '', https: false };

const dockerOnly: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: null }],
  eth0: [{ address: '172.17.0.2', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false, cidr: null }],
};

describe('serverBaseUrls', () => {
  it('includes hostname, an operator override, and non-loopback interface addresses', () => {
    const ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: null }],
      eth0: [
        { address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: null },
        { address: 'fe80::1', netmask: '', family: 'IPv6', mac: '', internal: false, cidr: null, scopeid: 1 },
      ],
    };
    const urls = serverBaseUrls({ ...cfg, hostIp: '10.0.0.5', hostPort: '9099' }, ifaces);
    expect(urls[0]).toBe('http://10.0.0.5:9099');
    expect(urls).toContain('http://192.168.1.20:9099');
    expect(urls.some((u) => u.endsWith(':9099'))).toBe(true);
    expect(urls.some((u) => u.includes('127.0.0.1'))).toBe(false);
    expect(urls.some((u) => u.includes('fe80'))).toBe(false);
  });

  it('uses https when asked, and discovery still points at the FHIR sync path the QR historically carried', () => {
    const found = serverDiscovery({ ...cfg, https: true }, {
      eth0: [{ address: '10.1.2.3', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: null }],
    });
    expect(found.sync_endpoint).toBe('api/secure/resource/fhir');
    expect(found.server_base_urls.every((u) => u.startsWith('https://'))).toBe(true);
  });

  it('puts the Settings page LAN origin ahead of a Docker bridge, on the API port a phone must dial', () => {
    const urls = serverBaseUrls({
      ...cfg,
      advertisedOrigins: ['http://192.168.1.20:4200'],
    }, dockerOnly);
    expect(urls[0]).toBe('http://192.168.1.20:8080');
    expect(urls).toContain('http://192.168.1.20:4200');
    expect(urls.some((u) => u.includes('172.17.0.2'))).toBe(false);
  });

  it('ignores localhost and docker0 advertised hosts so the phone is not sent a 30s timeout', () => {
    const urls = serverBaseUrls({
      ...cfg,
      advertisedOrigins: ['http://localhost:4200', 'http://127.0.0.1:8080', 'http://172.17.0.2:8080'],
    }, dockerOnly);
    expect(urls.every((u) => !u.includes('localhost'))).toBe(true);
    expect(urls.every((u) => !u.includes('127.0.0.1'))).toBe(true);
    expect(urls).toEqual(['http://172.17.0.2:8080']);
  });

  it('keeps a public origin as the browser used it, without appending the container listen port', () => {
    const urls = serverBaseUrls({
      ...cfg,
      https: true,
      advertisedOrigins: ['https://yourphr.example.com/settings'],
    }, dockerOnly);
    expect(urls).toContain('https://yourphr.example.com');
    expect(urls.some((u) => u.includes(':8080') && u.includes('yourphr.example.com'))).toBe(false);
  });
});

describe('requestAdvertisedOrigins', () => {
  it('prefers X-Client-Origin over the rewritten Host the Angular proxy sends', () => {
    expect(requestAdvertisedOrigins({
      'x-client-origin': 'http://192.168.1.20:4200',
      origin: 'http://192.168.1.20:4200',
      host: 'localhost:8080',
    })).toEqual([
      'http://192.168.1.20:4200',
      'localhost:8080',
    ]);
  });
});
