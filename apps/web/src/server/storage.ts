import 'server-only';
import { resolve } from 'node:path';
import { LocalPrivateStorage, SupabaseStorage, type ObjectStorage } from '@xhs/core';
import { env } from './env';

let storage: ObjectStorage | null = null;

/** Private storage: local directory in development, private Supabase Storage bucket in deployment. */
export function assetStorage(): ObjectStorage {
  if (storage) return storage;
  const e = env();
  storage = e.STORAGE_BACKEND === 'supabase'
    ? new SupabaseStorage(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, e.SUPABASE_STORAGE_BUCKET)
    : new LocalPrivateStorage(process.env.ASSET_STORAGE_DIR ?? resolve(process.cwd(), '../../.data/assets'));
  return storage;
}
