import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../env';

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
    await writeFile(full, data, { mode: 0o600 });
  }

  get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

export function createStorage(env: Env): DocumentStorage {
  return new LocalDiskStorage(env.DOCUMENTS_DIR || DEFAULT_DIR);
}
