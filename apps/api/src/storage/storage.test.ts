import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EncryptedStorage, LocalDiskStorage } from '.';

describe('EncryptedStorage', () => {
  const key = randomBytes(32).toString('base64');
  const pdf = Buffer.from('%PDF-1.7 policy number 123456789');
  let dir: string;
  let disk: LocalDiskStorage;
  let storage: EncryptedStorage;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'meld-storage-'));
    disk = new LocalDiskStorage(dir);
    storage = new EncryptedStorage(disk, key);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('stores files encrypted and reads them back', async () => {
    await storage.put('insurance/a.pdf', pdf);
    const onDisk = await readFile(path.join(dir, 'insurance/a.pdf'));
    expect(onDisk.includes(Buffer.from('%PDF'))).toBe(false);
    expect((await storage.get('insurance/a.pdf')).equals(pdf)).toBe(true);
    // No temp files left behind.
    expect(await readdir(path.join(dir, 'insurance'))).toEqual(['a.pdf']);
  });

  it('reads older plain files and encrypts them in place', async () => {
    await disk.put('insurance/old.pdf', pdf);
    await storage.put('insurance/new.pdf', pdf);
    expect((await storage.get('insurance/old.pdf')).equals(pdf)).toBe(true);

    expect(await storage.encryptExisting(['insurance/old.pdf', 'insurance/new.pdf', 'insurance/missing.pdf'])).toBe(1);
    expect((await disk.get('insurance/old.pdf')).includes(Buffer.from('%PDF'))).toBe(false);
    expect((await storage.get('insurance/old.pdf')).equals(pdf)).toBe(true);
    // Running again finds nothing left to do.
    expect(await storage.encryptExisting(['insurance/old.pdf'])).toBe(0);
  });
});
