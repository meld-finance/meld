import { describe, expect, it } from 'vitest';
import { isAllowedHost } from './hosts';

describe('isAllowedHost', () => {
  it.each([
    'localhost:47800',
    '127.0.0.1:8080',
    '[::1]:4000',
    '100.101.102.103',
    'meld',
    'my-mac.local',
    'my-mac.tail1234.ts.net',
    'app.localhost:8081',
  ])('allows %s', (host) => expect(isAllowedHost(host)).toBe(true));

  it.each(['evil.example.com', 'rebind.127.0.0.1.nip.io:47800', 'localhost.evil.com', 'ts.net.evil.com'])(
    'refuses %s',
    (host) => expect(isAllowedHost(host)).toBe(false),
  );

  it('allows names listed in ALLOWED_HOSTS', () => {
    expect(isAllowedHost('meld.example.com', ['meld.example.com'])).toBe(true);
    expect(isAllowedHost('MELD.example.com:443', ['meld.example.com'])).toBe(true);
  });

  it('allows a request with no Host header', () => expect(isAllowedHost(undefined)).toBe(true));
});
