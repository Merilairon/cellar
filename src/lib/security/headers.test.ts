import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce, securityHeaders } from './headers';

describe('security headers', () => {
  it('CSP is strict: nonce scripts, no unsafe-eval in prod, frame-ancestors none', () => {
    const csp = buildCsp({ nonce: 'abc', https: false });
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(eval|inline)/);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
  it('dev adds unsafe-eval only to scripts', () => {
    expect(buildCsp({ nonce: 'a', https: false, dev: true })).toMatch(/script-src[^;]*unsafe-eval/);
  });
  it('https adds upgrade-insecure-requests but never HSTS or unspecified extra headers', () => {
    const h = securityHeaders({ nonce: 'a', https: true });
    expect(h['Content-Security-Policy']).toContain('upgrade-insecure-requests');
    expect(Object.keys(h).sort()).toEqual([
      'Content-Security-Policy',
      'Referrer-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]);
  });
  it('sets nosniff and referrer policy', () => {
    const h = securityHeaders({ nonce: 'a', https: false });
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('same-origin');
  });
  it('nonces are unique base64', () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a).not.toBe(generateNonce());
  });
});
