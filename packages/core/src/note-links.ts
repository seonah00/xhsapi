import { safeXhsAccessUrl } from '@xhs/security';
import type { Ctx, Db, ServiceRunner } from './context.ts';

export async function storeNoteAccessLink(db: Db, orgId: string, noteId: string, platformId: string, supplied: unknown) {
  const url = safeXhsAccessUrl(supplied, platformId);
  if (!url) return; // A tokenless search must not erase a still-valid sharing link.
  await db.query(`insert into note_access_links(note_id,org_id,access_url,expires_at)
    values($1,$2,$3,now()+interval '24 hours') on conflict(note_id) do update
    set access_url=excluded.access_url,expires_at=excluded.expires_at`, [noteId,orgId,url]);
}

/** Resolve after RLS/mode checks; never return stored credentials in note JSON or AI inputs. */
export async function originalNoteLink(ctx: Ctx, service: ServiceRunner, id: string): Promise<string | null> {
  const note = (await ctx.db.query(`select platform_note_id from notes where id=$1 and org_id=$2 and data_mode=$3`,[id,ctx.orgId,ctx.mode])).rows[0];
  if (!note) return null;
  return service(async db => {
    const row=(await db.query(`select access_url from note_access_links where note_id=$1 and org_id=$2 and expires_at>now()`,[id,ctx.orgId])).rows[0];
    return safeXhsAccessUrl(row?.access_url,note.platform_note_id);
  });
}
