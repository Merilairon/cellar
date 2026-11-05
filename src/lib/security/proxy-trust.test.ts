import { describe, expect, it } from 'vitest';
import { createTrustMatcher, isValidProxyEntry, normalizeIp, resolveClient } from './proxy-trust';

const T = ['172.18.0.0/16', '::1'];

describe('normalizeIp', () => {
  it('unwraps mapped v4, brackets, rejects junk', () => {
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp('[2001:DB8::1]')).toBe('2001:db8::1');
    expect(normalizeIp('not-an-ip')).toBeNull();
    expect(normalizeIp('')).toBeNull();
  });
});

describe('createTrustMatcher', () => {
  it('matches CIDRs and single IPs, v4 and v6', () => {
    const m = createTrustMatcher(['10.0.0.0/8', '192.168.1.5', '::1']);
    expect(m('10.9.9.9')).toBe(true);
    expect(m('::ffff:10.1.1.1')).toBe(true);
    expect(m('192.168.1.5')).toBe(true);
    expect(m('192.168.1.6')).toBe(false);
    expect(m('::1')).toBe(true);
    expect(m('garbage')).toBe(false);
  });
  it('empty list trusts nothing; invalid entry throws', () => {
    expect(createTrustMatcher([])('127.0.0.1')).toBe(false);
    expect(() => createTrustMatcher(['10.0.0.0/33'])).toThrow();
    expect(isValidProxyEntry('10.0.0.0/8')).toBe(true);
    expect(isValidProxyEntry('example.com')).toBe(false);
    expect(isValidProxyEntry('1.2.3.4/x')).toBe(false);
  });
});

describe('resolveClient', () => {
  it('ignores forwarded headers when nothing is trusted (default)', () => {
    const r = resolveClient({ forwardedFor: '6.6.6.6', forwardedProto: 'https' }, []);
    expect(r).toEqual({ ip: null, proto: null, trusted: false });
  });
  it('honors headers when a proxy list is configured', () => {
    const r = resolveClient({ forwardedFor: '203.0.113.7', forwardedProto: 'https' }, T);
    expect(r).toEqual({ ip: '203.0.113.7', proto: 'https', trusted: true });
  });
  it('walks right to left past trusted hops, never trusts left-side spoofed entries', () => {
    const r = resolveClient({ forwardedFor: '6.6.6.6, 203.0.113.7, 172.18.0.3' }, T);
    expect(r.ip).toBe('203.0.113.7');
  });
  it('stops at a garbage hop instead of skipping to a spoofable one', () => {
    const r = resolveClient({ forwardedFor: '6.6.6.6, junk' }, T);
    expect(r.ip).toBeNull();
  });
  it('all hops trusted or header missing gives null client', () => {
    expect(resolveClient({ forwardedFor: '172.18.0.2' }, T).ip).toBeNull();
    expect(resolveClient({}, T).ip).toBeNull();
  });
  it('with a real peer: untrusted peer wins and headers are ignored', () => {
    const r = resolveClient(
      { peer: '198.51.100.9', forwardedFor: '6.6.6.6', forwardedProto: 'https' },
      T,
    );
    expect(r).toEqual({ ip: '198.51.100.9', proto: null, trusted: false });
  });
  it('with a real trusted peer: headers honored', () => {
    const r = resolveClient(
      { peer: '172.18.0.2', forwardedFor: '203.0.113.7', forwardedProto: 'http, https' },
      T,
    );
    expect(r).toEqual({ ip: '203.0.113.7', proto: 'https', trusted: true });
  });
  it('rejects an unknown proto value', () => {
    expect(
      resolveClient({ forwardedFor: '203.0.113.7', forwardedProto: 'javascript' }, T).proto,
    ).toBeNull();
  });
});
