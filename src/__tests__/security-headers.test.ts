import { describe, expect, it } from 'vitest';
import { enforcingPolicy, reportOnlyScriptSrc } from '../security-headers.js';
import { createHash } from 'node:crypto';

describe('security headers (yourphr#813)', () => {
  it('the enforcing CSP carries the Go stack\'s directives and the configured connect origins', () => {
    const csp = enforcingPolicy(['https://clinicaltables.nlm.nih.gov']);
    for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    expect(csp).toContain("connect-src 'self' https://clinicaltables.nlm.nih.gov");
  });

  it('a connect-src entry that is not a bare https origin is dropped, so config cannot smuggle a directive', () => {
    const csp = enforcingPolicy(["https://ok.example", "https://x.example; script-src *", "http://plain.example", "*"]);
    expect(csp).toContain("connect-src 'self' https://ok.example;");
    expect(csp).not.toMatch(/script-src \*|plain\.example|connect-src[^;]*\*/);
  });

  it('the report-only script-src hashes each inline script exactly as served', () => {
    const body = "\n  var x = 1;\n";
    const expected = createHash('sha256').update(body).digest('base64');
    expect(reportOnlyScriptSrc(`<head><script src="a.js"></script><script>${body}</script></head>`)).toBe(`script-src 'self' 'sha256-${expected}'`);
    expect(reportOnlyScriptSrc('<p>no scripts</p>')).toBe("script-src 'self'");
    expect(reportOnlyScriptSrc(`<SCRIPT>${body}</Script >`)).toBe(`script-src 'self' 'sha256-${expected}'`);
  });
});
