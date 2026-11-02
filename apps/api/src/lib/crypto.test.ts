import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, decryptBytes, encrypt, encryptBytes, isEncryptedBytes } from './crypto';

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

describe('file encryption', () => {
  const pdf = Buffer.from('%PDF-1.7\n' + 'x'.repeat(1000));

  it('round-trips bytes and marks the output as encrypted', () => {
    const sealed = encryptBytes(pdf, key);
    expect(isEncryptedBytes(sealed)).toBe(true);
    expect(isEncryptedBytes(pdf)).toBe(false);
    expect(sealed.includes(Buffer.from('%PDF'))).toBe(false);
    expect(decryptBytes(sealed, key).equals(pdf)).toBe(true);
  });

  it('rejects tampered bytes and the wrong key', () => {
    const sealed = encryptBytes(pdf, key);
    sealed[sealed.length - 1]! ^= 1;
    expect(() => decryptBytes(sealed, key)).toThrow();
    expect(() => decryptBytes(encryptBytes(pdf, key), randomBytes(32).toString('base64'))).toThrow();
  });

  it('refuses data that was never encrypted', () => {
    expect(() => decryptBytes(pdf, key)).toThrow('Unrecognized encrypted file');
  });
});
