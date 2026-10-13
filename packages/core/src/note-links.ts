import { requestAutoSearch } from './auto-search.ts';
import type { AppEnv } from '@xhs/domain';
import { AppError } from '@xhs/domain';
import { z } from 'zod';
import { requireAdmin } from './admin.ts';
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
  const note = (await ctx.db.query(`select platform_note_id from notes where id=$1 and org_id=$2 and data_mode=$3 and (expires_at is null or expires_at>now())`,[id,ctx.orgId,ctx.mode])).rows[0];
  if (!note) return null;
  return service(async db => {
    const rows=(await db.query(`select l.access_url from note_access_links l
      join notes n on n.id=l.note_id and n.org_id=l.org_id
      where l.org_id=$1 and n.platform_note_id=$2 and n.data_mode=$3
      and l.expires_at>now() and (n.expires_at is null or n.expires_at>now())
      order by l.expires_at desc`,[ctx.orgId,note.platform_note_id,ctx.mode])).rows;
    for(const row of rows) {
      const url=safeXhsAccessUrl(row.access_url,note.platform_note_id);
      if(url) return url;
    }
    return null;
  });
}

/** An administrator can connect a verified public sharing URL, never a title-search URL. */
export async function connectOriginalNoteLink(ctx: Ctx, service: ServiceRunner, id: string, supplied: unknown) {
  requireAdmin(ctx);
  z.string().uuid().parse(id);
  const note=(await ctx.db.query(`select platform_note_id from notes where id=$1 and org_id=$2 and data_mode=$3`,[id,ctx.orgId,ctx.mode])).rows[0];
  if(!note) throw new AppError('NOT_FOUND','게시물을 찾을 수 없습니다.');
  const url=safeXhsAccessUrl(z.string().max(4000).parse(supplied).trim(),note.platform_note_id);
  if(!url) throw new AppError('VALIDATION_FAILED','이 게시물의 전체 공유 주소(xsec_token 포함)를 입력하세요. 검색·계정·단축 주소는 연결할 수 없습니다.');
  await service(db=>storeNoteAccessLink(db,ctx.orgId,id,note.platform_note_id,url));
}

/** Resolve the title from the authorized note, never trust a submitted title or URL. */
export async function requestOriginalRefresh(ctx: Ctx, service: ServiceRunner, id: string, env: AppEnv) {
  z.string().uuid().parse(id);
  const note=(await ctx.db.query(`select title from notes where id=$1 and org_id=$2 and data_mode=$3 and (expires_at is null or expires_at>now())`,[id,ctx.orgId,ctx.mode])).rows[0];
  if(!note) throw new AppError('NOT_FOUND','게시물을 찾을 수 없습니다.');
  if(await originalNoteLink(ctx,service,id)) return null;
  const title=String(note.title ?? '').trim().slice(0,50);
  if(!title) throw new AppError('VALIDATION_FAILED','검색할 게시물 제목이 없습니다.');
  const request=await requestAutoSearch(ctx,service,title,env,{},'apify');
  if(!request) throw new AppError('FEATURE_DISABLED','현재 원문 링크를 다시 찾을 수 없습니다. 관리자에게 검색 설정을 요청하세요.');
  return request;
}
