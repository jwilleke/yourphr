/**
 * Security response headers (yourphr#813) — what the Go stack sent (#105, #124's staged CSP) and the
 * TypeScript cut-over (#677) silently dropped. Ported from `security_headers.go`, directive for
 * directive, so the policy that ran in production against this same Angular app is the one that
 * runs now.
 *
 *   - Content-Security-Policy (ENFORCING): the safe, high-value directives. `script-src` keeps
 *     'unsafe-inline' because index.html bootstraps `<base href>` inline and third-party widgets
 *     (lforms) inject inline handlers a hash cannot cover. It still blocks cross-origin script,
 *     base-tag injection, form hijacking, plugins and framing.
 *   - Content-Security-Policy-Report-Only: the strict `script-src` target, hashes computed from the
 *     index.html actually served — observe-only, so a wrong hash reports and never blocks.
 *   - nosniff, X-Frame-Options DENY, Referrer-Policy no-referrer on everything.
 *   - Cache-Control: no-store on every /api/ response: records must not sit in a browser or proxy
 *     cache. A route that sets its own Cache-Control later still wins (the event stream).
 *   - HSTS only when the operator says the instance is served over HTTPS.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';

export interface SecurityHeaderOptions {
  /** Origins the browser may call besides this one (`yourphr.web.csp.connect-src`). */
  connectSrc: readonly string[];
  /** Send Strict-Transport-Security (`yourphr.web.hsts.enabled`). */
  hsts: boolean;
  /** The strict script-src target for the report-only header; '' omits it. */
  reportOnlyScriptSrc: string;
}

/** An origin is scheme://host[:port] and nothing else — a policy fragment could otherwise smuggle directives. */
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

export function enforcingPolicy(connectSrc: readonly string[]): string {
  const extra = connectSrc.filter((o) => ORIGIN.test(o));
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...extra].join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * The strict script-src target: each inline `<script>` of the served index.html allow-listed by its
 * sha256 (the bytes between the tags, as the browser hashes them). Computed from the file rather
 * than hardcoded, so the hashes cannot drift from what is served — the fragility that broke #124's
 * second attempt.
 */
export function reportOnlyScriptSrc(indexHtml: string): string {
  let policy = "script-src 'self'";
  // Case-insensitive, as HTML is: an uppercase <SCRIPT> is a script too, and must not go unhashed.
  for (const m of indexHtml.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)) {
    policy += ` 'sha256-${createHash('sha256').update(m[1] ?? '', 'utf8').digest('base64')}'`;
  }
  return policy;
}

/** The report-only policy for a web directory, or '' when it serves no index.html. */
export function reportOnlyForWebDir(webDir: string | undefined): string {
  if (!webDir) return '';
  const file = join(webDir, 'index.html');
  return existsSync(file) ? reportOnlyScriptSrc(readFileSync(file, 'utf8')) : '';
}

export function applySecurityHeaders(res: ServerResponse, pathname: string, options: SecurityHeaderOptions): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', enforcingPolicy(options.connectSrc));
  if (options.reportOnlyScriptSrc !== '') res.setHeader('Content-Security-Policy-Report-Only', options.reportOnlyScriptSrc);
  if (options.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
}
