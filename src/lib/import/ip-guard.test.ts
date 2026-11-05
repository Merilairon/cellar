import { describe, expect, it } from 'vitest';
import { isBlockedHostname, isBlockedIp } from './ip-guard';

describe('isBlockedIp', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1',
    '64:ff9b::10.0.0.1',
    '2001:db8::1',
    '::127.0.0.1',
    '2002:7f00:1::1',
    '2002:0a00:0001::1',
    '0:0:0:0:0:0:0:1',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001:81b::200e',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it.each([
    '',
    'example.com',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '1::2::3',
    ':::',
    'fe80::1%eth0',
    '0x7f.1',
    '2130706433',
    '12345::1',
  ])('fails closed on non-literal or malformed %j', (s) => {
    expect(isBlockedIp(s)).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'foo.localhost',
    'metadata.google.internal',
    'x.internal',
    'printer.local',
    'localhost.',
  ])('blocks %s', (h) => expect(isBlockedHostname(h)).toBe(true));
  it.each(['example.com', 'localhost.example.com', 'notlocalhost.org'])('allows %s', (h) =>
    expect(isBlockedHostname(h)).toBe(false),
  );
});
