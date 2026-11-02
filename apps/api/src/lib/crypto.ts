import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/**
 * Encrypts secrets (e.g. Plaid access tokens) for storage.
 * Output format: `v1:<iv>:<authTag>:<ciphertext>`, each part base64.
 */
export function encrypt(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decrypt(payload: string, keyBase64: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognized encrypted payload');
  }
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyBase64, 'base64'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** Marks a file encrypted by encryptBytes, so older unencrypted files can still be told apart. */
const FILE_MAGIC = Buffer.from('MELDENC1', 'latin1');
const TAG_BYTES = 16;

export function isEncryptedBytes(data: Buffer): boolean {
  return data.length >= FILE_MAGIC.length && data.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}

/**
 * Encrypts a file's contents (e.g. an uploaded PDF).
 * Layout: `MELDENC1` | 12-byte IV | 16-byte auth tag | ciphertext.
 */
export function encryptBytes(plaintext: Buffer, keyBase64: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(keyBase64, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

/** Decrypts encryptBytes output; throws if the data was changed or the key is wrong. */
export function decryptBytes(data: Buffer, keyBase64: string): Buffer {
  if (!isEncryptedBytes(data) || data.length < FILE_MAGIC.length + IV_BYTES + TAG_BYTES) {
    throw new Error('Unrecognized encrypted file');
  }
  let at = FILE_MAGIC.length;
  const iv = data.subarray(at, (at += IV_BYTES));
  const tag = data.subarray(at, (at += TAG_BYTES));
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyBase64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(at)), decipher.final()]);
}
