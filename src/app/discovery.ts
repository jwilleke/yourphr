/**
 * LAN discovery for the companion QR (Go's GetServerBaseURLs).
 *
 * The iPhone tries every URL in order until one answers /account/me. Operator override
 * (host.ip / HOST_IP) is first, then the URL the Settings page was actually loaded from —
 * inside Docker `os.networkInterfaces()` is the bridge (172.17.0.0/16), which a phone on
 * Wi-Fi cannot reach. Interface addresses and hostname come after, with docker0 last.
 */
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { IncomingHttpHeaders } from 'node:http';

export interface DiscoveryConfig {
  listenPort: number;
  /** Docker published port, when the listen port is not the one a phone on the LAN must use. */
  hostPort: string;
  hostIp: string;
  https: boolean;
  /**
   * Origins/hosts from the request that asked for discovery (the browser's page URL).
   * Needed when this process only sees a container bridge address.
   */
  advertisedOrigins?: string[];
}

export interface ServerDiscovery {
  server_base_urls: string[];
  sync_endpoint: string;
}

function joinHostPort(host: string, port: string): string {
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]:${port}`;
  return `${host}:${port}`;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function isUnusableCompanionHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '127.0.0.1' || h === '::1') return true;
  if (h.startsWith('127.')) return true;
  if (h.startsWith('169.254.') || h.startsWith('fe80:')) return true;
  return false;
}

/** Default docker0 bridge. A phone on Wi-Fi cannot route here. */
function isDockerBridgeIPv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  return Number(m[1]) === 172 && Number(m[2]) === 17;
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isDockerStyleHostname(name: string): boolean {
  return /^[0-9a-f]{12}$/.test(name);
}

function isUsable(info: NetworkInterfaceInfo): boolean {
  if (info.internal) return false;
  if (info.family !== 'IPv4' && info.family !== 'IPv6') return false;
  return !isUnusableCompanionHost(info.address);
}

/**
 * Hosts/origins the Settings browser already used to reach us. The Angular proxy rewrites
 * `Host` to localhost, so X-Client-Origin / Origin / Referer carry the LAN URL the phone needs.
 */
export function requestAdvertisedOrigins(headers: IncomingHttpHeaders): string[] {
  const out: string[] = [];
  const add = (raw: string): void => {
    for (const part of raw.split(',')) {
      const s = part.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  };
  add(headerValue(headers, 'x-client-origin'));
  add(headerValue(headers, 'origin'));
  add(headerValue(headers, 'referer'));
  add(headerValue(headers, 'x-forwarded-host'));
  add(headerValue(headers, 'host'));
  return out;
}

function parseAdvertised(raw: string): { hostname: string; origin: string; port: string; hadScheme: boolean } | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const hadScheme = /:\/\//.test(trimmed);
  try {
    const url = hadScheme ? new URL(trimmed) : new URL(`http://${trimmed}`);
    if (!url.hostname || isUnusableCompanionHost(url.hostname)) return undefined;
    return { hostname: url.hostname, origin: url.origin, port: url.port, hadScheme };
  } catch {
    return undefined;
  }
}

export function serverBaseUrls(cfg: DiscoveryConfig, ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const port = (cfg.hostPort.trim() || String(cfg.listenPort)).trim();
  const protocol = cfg.https ? 'https' : 'http';
  const preferred: string[] = [];
  const fallback: string[] = [];

  const push = (url: string, into: string[] = preferred): void => {
    if (!url || into.includes(url) || preferred.includes(url) || fallback.includes(url)) return;
    into.push(url);
  };
  const addHost = (host: string, into: string[] = preferred): void => {
    if (!host.trim() || isUnusableCompanionHost(host.trim())) return;
    push(`${protocol}://${joinHostPort(host.trim(), port)}`, into);
  };

  // Operator / LAN override first: the iOS companion probes this list in order.
  addHost(cfg.hostIp);

  // The URL the patient opened Settings with — the one address a Docker bridge is not.
  for (const raw of cfg.advertisedOrigins ?? []) {
    const parsed = parseAdvertised(raw);
    if (!parsed) continue;
    if (isPrivateIPv4(parsed.hostname)) {
      if (isDockerBridgeIPv4(parsed.hostname)) {
        addHost(parsed.hostname, fallback);
        continue;
      }
      addHost(parsed.hostname);
      if (parsed.hadScheme) push(parsed.origin);
      else if (parsed.port && parsed.port !== port) {
        push(`${protocol}://${joinHostPort(parsed.hostname, parsed.port)}`);
      }
    } else if (parsed.hadScheme) {
      // Public URL as the browser used it — never append the listen port (that is
      // the container port behind a TLS proxy, not what a phone should dial).
      push(parsed.origin);
    } else if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
      push(`${protocol}://${joinHostPort(parsed.hostname, parsed.port)}`);
    } else {
      push(`${protocol}://${parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname}`);
    }
  }

  for (const infos of Object.values(ifaces)) {
    for (const info of infos ?? []) {
      if (!isUsable(info)) continue;
      addHost(info.address, isDockerBridgeIPv4(info.address) ? fallback : preferred);
    }
  }
  try {
    const name = hostname();
    if (!isDockerStyleHostname(name)) addHost(name);
  } catch { /* hostname is best-effort */ }

  // docker0 is unreachable from a phone on Wi-Fi; keep it only when it is the sole candidate.
  return preferred.length ? preferred : fallback;
}

export function serverDiscovery(cfg: DiscoveryConfig, ifaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): ServerDiscovery {
  return {
    server_base_urls: serverBaseUrls(cfg, ifaces),
    sync_endpoint: 'api/secure/resource/fhir',
  };
}
