import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../env';
import { decryptBytes, encryptBytes, isEncryptedBytes } from '../lib/crypto';

/** Where uploaded documents live. Local disk now; an S3 implementation can replace it when hosting. */
export interface DocumentStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const DEFAULT_DIR = fileURLToPath(new URL('../../../../data/documents', import.meta.url));

export class LocalDiskStorage implements DocumentStorage {
  constructor(private root: string) {}

  private resolve(key: string) {
    // Keys are generated server-side, but never let one escape the root.
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    // Write then rename, so a crash never leaves a half-written file in place of a good one.
    const tmp = `${full}.${randomUUID()}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, full);
  }

  get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/**
 * Encrypts documents before they reach the underlying storage (AES-256-GCM with ENCRYPTION_KEY)
 * and decrypts them on read. Files saved before encryption existed are still read as-is until
 * encryptExisting rewrites them.
 */
export class EncryptedStorage implements DocumentStorage {
  constructor(
    private inner: DocumentStorage,
    private keyBase64: string,
  ) {}

  put(key: string, data: Buffer) {
    return this.inner.put(key, encryptBytes(data, this.keyBase64));
  }

  async get(key: string) {
    const data = await this.inner.get(key);
    return isEncryptedBytes(data) ? decryptBytes(data, this.keyBase64) : data;
  }

  delete(key: string) {
    return this.inner.delete(key);
  }

  /** Encrypts any of these documents still stored in plain form. Returns how many it rewrote. */
  async encryptExisting(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      const data = await this.inner.get(key).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null; // already gone; the orphan cleanup handles the row
        throw err;
      });
      if (!data || isEncryptedBytes(data)) continue;
      await this.put(key, data);
      count++;
    }
    return count;
  }
}

export function createStorage(env: Env): EncryptedStorage {
  return new EncryptedStorage(new LocalDiskStorage(env.DOCUMENTS_DIR || DEFAULT_DIR), env.ENCRYPTION_KEY);
}
