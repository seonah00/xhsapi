import 'server-only';
import { resolve } from 'node:path';
import { LocalPrivateStorage, type ObjectStorage } from '@xhs/core';

let storage: ObjectStorage | null = null;

/** Private storage outside the web root. Deployment swaps in Supabase private Storage behind the same interface. */
export function assetStorage(): ObjectStorage {
  storage ??= new LocalPrivateStorage(process.env.ASSET_STORAGE_DIR ?? resolve(process.cwd(), '../../.data/assets'));
  return storage;
}
