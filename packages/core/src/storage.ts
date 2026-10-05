import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Private object storage. Local disk for development; Supabase private Storage in deployment (same interface). */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

const KEY = /^[a-z0-9-]{8,64}\/[a-f0-9-]{36}$/;

export class LocalPrivateStorage implements ObjectStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    if (!KEY.test(key)) throw new Error('invalid storage key');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + '/')) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, bytes: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, bytes, { mode: 0o600 });
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}
