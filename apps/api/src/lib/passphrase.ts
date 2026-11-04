import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMS: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;

function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(passphrase, salt, KEY_BYTES, PARAMS, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** A salted scrypt hash, `scrypt:<salt>:<hash>` (base64), for storing the login passphrase. */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  return ['scrypt', salt.toString('base64'), (await derive(passphrase, salt)).toString('base64')].join(':');
}

export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(passphrase, Buffer.from(salt, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
