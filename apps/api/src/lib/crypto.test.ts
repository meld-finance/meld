import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

const key = randomBytes(32).toString('base64');

describe('crypto', () => {
  it('round-trips plaintext', () => {
    const secret = 'access-sandbox-1234-abcd';
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same', key)).not.toBe(encrypt('same', key));
  });

  it('rejects tampered ciphertext', () => {
    const parts = encrypt('secret', key).split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decrypt(parts.join(':'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    const other = randomBytes(32).toString('base64');
    expect(() => decrypt(encrypt('secret', key), other)).toThrow();
  });
});
