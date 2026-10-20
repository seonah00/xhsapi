import {z} from 'zod';
import {AppError} from '@xhs/domain';
import type {Ctx} from './context.ts';
import {composerEntries} from './personal-dictionary.ts';
export const WritingInput=z.object({id:z.string().uuid(),revision:z.number().int().min(0),title:z.string().trim().max(200),cover:z.string().trim().max(100),body:z.string().max(10000),meaningKo:z.string().max(10000).default(''),tags:z.array(z.string().trim().min(1).max(80)).max(20),entryIds:z.array(z.string().uuid()).max(11)}).strict();
export type WritingDraft={id:string;revision:number;title:string;cover:string;body:string;meaningKo:string;tags:string[];entries:{id:string;term:string;meaning:string;entryType:string}[];updatedAt:string};
export async function saveWriting(ctx:Ctx,raw:unknown) {
 const input=WritingInput.parse(raw);
 if(!input.title&&!input.body) throw new AppError('VALIDATION_FAILED','제목이나 본문을 입력하세요.');
 await ctx.db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`writing:${ctx.orgId}:${ctx.uid}:${input.id}`]);
 const current=(await ctx.db.query(`select * from writing_drafts where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 for update`,[input.id,ctx.orgId,ctx.uid,ctx.mode])).rows[0];
 if((current?.revision??0)!==input.revision) throw new AppError('CONFLICT','다른 화면에서 수정되었습니다. 이력을 다시 열어 최신 내용을 확인하세요.');
 const resolved=await composerEntries(ctx,input.entryIds);
 if(resolved.length!==new Set(input.entryIds).size) throw new AppError('NOT_FOUND','선택한 항목에 접근할 수 없습니다.');
 const entries=input.entryIds.length?resolved.map(e=>({id:e.id,term:e.term,meaning:e.meaning,entryType:e.entryType})):(current?.entries??[]);
 const revision=input.revision+1;
 const snapshot={title:input.title,cover:input.cover,body:input.body,meaningKo:input.meaningKo,tags:input.tags,entries};
 if(current) await ctx.db.query(`update writing_drafts set title=$2,cover=$3,body=$4,meaning_ko=$5,tags=$6,revision=$7,entries=$8,updated_at=now() where id=$1`,[input.id,input.title,input.cover,input.body,input.meaningKo,JSON.stringify(input.tags),revision,JSON.stringify(entries)]);
 else await ctx.db.query(`insert into writing_drafts(id,org_id,owner_user_id,data_mode,title,cover,body,meaning_ko,tags,entries) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[input.id,ctx.orgId,ctx.uid,ctx.mode,input.title,input.cover,input.body,input.meaningKo,JSON.stringify(input.tags),JSON.stringify(entries)]);
 await ctx.db.query(`insert into writing_versions(draft_id,revision,snapshot) values($1,$2,$3)`,[input.id,revision,snapshot]);
 return {id:input.id,revision};
}
export async function listWriting(ctx:Ctx) {
 return (await ctx.db.query(`select id,title,revision,updated_at from writing_drafts where org_id=$1 and owner_user_id=$2 and data_mode=$3 order by updated_at desc limit 100`,[ctx.orgId,ctx.uid,ctx.mode])).rows as {id:string;title:string;revision:number;updated_at:Date}[];
}
export async function getWriting(ctx:Ctx,id:string) {
 const row=(await ctx.db.query(`select * from writing_drafts where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4`,[z.string().uuid().parse(id),ctx.orgId,ctx.uid,ctx.mode])).rows[0];
 if(!row) throw new AppError('NOT_FOUND','작성물을 찾을 수 없습니다.');
 const draft:WritingDraft={id:row.id,revision:row.revision,title:row.title,cover:row.cover,body:row.body,meaningKo:row.meaning_ko,tags:row.tags,entries:row.entries,updatedAt:new Date(row.updated_at).toISOString()};
 const versions=(await ctx.db.query(`select revision,snapshot,created_at from writing_versions where draft_id=$1 order by revision desc limit 50`,[id])).rows as {revision:number;snapshot:Omit<WritingDraft,'id'|'revision'|'updatedAt'>;created_at:Date}[];
 return {draft,versions};
}
