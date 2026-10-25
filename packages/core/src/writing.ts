import {randomUUID} from 'node:crypto';
import {pageWindow} from './library-page.ts';
import {z} from 'zod';
import {AppError} from '@xhs/domain';
import type {Ctx} from './context.ts';
import {composerEntries} from './personal-dictionary.ts';
export const WritingInput=z.object({id:z.string().uuid(),revision:z.number().int().min(0),title:z.string().trim().max(200),cover:z.string().trim().max(100),body:z.string().max(10000),meaningKo:z.string().max(10000).default(''),meaningReviewedFor:z.string().max(40000).default(''),learningNotes:z.string().max(12000).default(''),tags:z.array(z.string().trim().min(1).max(80)).max(20),entryIds:z.array(z.string().uuid()).max(11)}).strict();
export type WritingDraft={id:string;revision:number;title:string;cover:string;body:string;meaningKo:string;meaningReviewedFor?:string;learningNotes?:string;tags:string[];entries:{id:string;term:string;meaning:string;entryType:string}[];updatedAt:string;archivedAt?:string|null};
export async function saveWriting(ctx:Ctx,raw:unknown) {
 const input=WritingInput.parse(raw);
 if(!input.title&&!input.body) throw new AppError('VALIDATION_FAILED','제목이나 본문을 입력하세요.');
 await ctx.db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`writing:${ctx.orgId}:${ctx.uid}:${input.id}`]);
 const current=(await ctx.db.query(`select * from writing_drafts where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 for update`,[input.id,ctx.orgId,ctx.uid,ctx.mode])).rows[0];
 if(current?.archived_at)throw new AppError('CONFLICT','보관함에서 꺼낸 뒤 수정하세요.');
 if((current?.revision??0)!==input.revision) throw new AppError('CONFLICT','다른 화면에서 수정되었습니다. 이력을 다시 열어 최신 내용을 확인하세요.');
 const resolved=await composerEntries(ctx,input.entryIds);
 if(resolved.length!==new Set(input.entryIds).size) throw new AppError('NOT_FOUND','선택한 항목에 접근할 수 없습니다.');
 const entries=input.entryIds.length?resolved.map(e=>({id:e.id,term:e.term,meaning:e.meaning,entryType:e.entryType})):(current?.entries??[]);
 const revision=input.revision+1;
 const snapshot={title:input.title,cover:input.cover,body:input.body,meaningKo:input.meaningKo,meaningReviewedFor:input.meaningReviewedFor,learningNotes:input.learningNotes,tags:input.tags,entries};
 if(current) await ctx.db.query(`update writing_drafts set title=$2,cover=$3,body=$4,meaning_ko=$5,tags=$6,revision=$7,entries=$8,meaning_reviewed_for=$9,learning_notes=$10,updated_at=now() where id=$1`,[input.id,input.title,input.cover,input.body,input.meaningKo,JSON.stringify(input.tags),revision,JSON.stringify(entries),input.meaningReviewedFor,input.learningNotes]);
 else await ctx.db.query(`insert into writing_drafts(id,org_id,owner_user_id,data_mode,title,cover,body,meaning_ko,tags,entries,meaning_reviewed_for,learning_notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[input.id,ctx.orgId,ctx.uid,ctx.mode,input.title,input.cover,input.body,input.meaningKo,JSON.stringify(input.tags),JSON.stringify(entries),input.meaningReviewedFor,input.learningNotes]);
 await ctx.db.query(`insert into writing_versions(draft_id,revision,snapshot) values($1,$2,$3)`,[input.id,revision,snapshot]);
 return {id:input.id,revision};
}
export async function listWriting(ctx:Ctx) {
 return (await ctx.db.query(`select id,title,revision,updated_at from writing_drafts where org_id=$1 and owner_user_id=$2 and data_mode=$3 order by updated_at desc limit 100`,[ctx.orgId,ctx.uid,ctx.mode])).rows as {id:string;title:string;revision:number;updated_at:Date}[];
}
export async function getWriting(ctx:Ctx,id:string,versionPage=1) {
 const row=(await ctx.db.query(`select * from writing_drafts where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4`,[z.string().uuid().parse(id),ctx.orgId,ctx.uid,ctx.mode])).rows[0];
 if(!row) throw new AppError('NOT_FOUND','작성물을 찾을 수 없습니다.');
 const draft:WritingDraft={id:row.id,revision:row.revision,title:row.title,cover:row.cover,body:row.body,meaningKo:row.meaning_ko,meaningReviewedFor:row.meaning_reviewed_for,learningNotes:row.learning_notes,tags:row.tags,entries:row.entries,updatedAt:new Date(row.updated_at).toISOString(),archivedAt:row.archived_at?new Date(row.archived_at).toISOString():null};
 const total=Number((await ctx.db.query('select count(*) as total from writing_versions where draft_id=$1',[id])).rows[0].total);
 const versionPaging=pageWindow(total,versionPage,10);
 const versions=(await ctx.db.query(`select revision,snapshot,created_at,restored_from from writing_versions where draft_id=$1 order by revision desc limit $2 offset $3`,[id,versionPaging.limit,versionPaging.offset])).rows as {revision:number;snapshot:Omit<WritingDraft,'id'|'revision'|'updatedAt'>;created_at:Date;restored_from:number|null}[];
 return {draft,versions,versionPaging};
}

export async function writingPage(ctx:Ctx,raw:{q?:string;state?:'active'|'archived';page?:number}={}){
 const filter=z.object({q:z.string().trim().max(100).default(''),state:z.enum(['active','archived']).default('active'),page:z.number().catch(1).optional()}).parse(raw);
 const params=[ctx.orgId,ctx.uid,ctx.mode,filter.q,filter.state==='archived'];
 const where=`org_id=$1 and owner_user_id=$2 and data_mode=$3 and (archived_at is not null)=$5::boolean
 and strpos(lower(title||' '||cover||' '||body||' '||meaning_ko||' '||tags::text),lower($4))>0`;
 const total=Number((await ctx.db.query(`select count(*) as total from writing_drafts where ${where}`,params)).rows[0].total);
 const paging=pageWindow(total,filter.page,10);
 const items=(await ctx.db.query(`select id,title,body,revision,updated_at,archived_at from writing_drafts where ${where} order by updated_at desc,id limit $6 offset $7`,[...params,paging.limit,paging.offset])).rows as {id:string;title:string;body:string;revision:number;updated_at:Date;archived_at:Date|null}[];
 return {...paging,items};
}
async function lockedWriting(ctx:Ctx,id:string,revision:number){
 z.string().uuid().parse(id);z.number().int().positive().parse(revision);
 await ctx.db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`writing:${ctx.orgId}:${ctx.uid}:${id}`]);
 const row=(await ctx.db.query('select * from writing_drafts where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 for update',[id,ctx.orgId,ctx.uid,ctx.mode])).rows[0];
 if(!row)throw new AppError('NOT_FOUND','작성물을 찾을 수 없습니다.');
 if(row.revision!==revision)throw new AppError('CONFLICT','다른 화면에서 수정됐습니다. 최신 저장본을 다시 열어 주세요.');
 return row;
}
export async function setWritingArchived(ctx:Ctx,id:string,revision:number,archived:boolean){
 const row=await lockedWriting(ctx,id,revision);
 if(Boolean(row.archived_at)!==archived)await ctx.db.query('update writing_drafts set archived_at=case when $2 then now() else null end where id=$1',[id,archived]);
 return {id};
}
export async function duplicateWriting(ctx:Ctx,id:string,revision:number){
 const row=await lockedWriting(ctx,id,revision),copyId=randomUUID();
 const snapshot={title:`${row.title||'제목 없는 글'} (복제)`.slice(0,200),cover:row.cover,body:row.body,meaningKo:row.meaning_ko,meaningReviewedFor:row.meaning_reviewed_for,learningNotes:row.learning_notes,tags:row.tags,entries:row.entries};
 await ctx.db.query(`insert into writing_drafts(id,org_id,owner_user_id,data_mode,title,cover,body,meaning_ko,tags,entries,meaning_reviewed_for,learning_notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[copyId,ctx.orgId,ctx.uid,ctx.mode,snapshot.title,snapshot.cover,snapshot.body,snapshot.meaningKo,JSON.stringify(snapshot.tags),JSON.stringify(snapshot.entries),snapshot.meaningReviewedFor??'',snapshot.learningNotes??'']);
 await ctx.db.query('insert into writing_versions(draft_id,revision,snapshot) values($1,1,$2)',[copyId,snapshot]);
 return {id:copyId,revision:1};
}
export async function restoreWritingVersion(ctx:Ctx,id:string,revision:number,sourceRevision:number){
 z.number().int().positive().parse(sourceRevision);
 const row=await lockedWriting(ctx,id,revision);
 if(row.archived_at)throw new AppError('CONFLICT','보관함에서 꺼낸 뒤 복원하세요.');
 // Preserve unsaved working copies; require explicit saving first instead of discarding them.
 await ctx.db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`temporary:${ctx.orgId}:${ctx.uid}:${ctx.mode}:draft:${id}`]);
 const temporary=(await ctx.db.query(`select content from writing_temporary where org_id=$1 and owner_user_id=$2 and data_mode=$3 and scope=$4 and updated_at>now()-interval '30 days'`,[ctx.orgId,ctx.uid,ctx.mode,`draft:${id}`])).rows[0];
 if(temporary?.content)throw new AppError('CONFLICT','임시 저장된 글이 있습니다. 먼저 작성 이력에 저장한 뒤 이전 버전을 복원하세요.');
 const version=(await ctx.db.query('select snapshot from writing_versions where draft_id=$1 and revision=$2',[id,sourceRevision])).rows[0];
 if(!version)throw new AppError('NOT_FOUND','이전 버전을 찾을 수 없습니다.');
 const snapshot=version.snapshot;
 const next=revision+1;
 await ctx.db.query(`update writing_drafts set title=$2,cover=$3,body=$4,meaning_ko=$5,tags=$6,entries=$7,revision=$8,meaning_reviewed_for=$9,learning_notes=$10,updated_at=now() where id=$1`,[id,snapshot.title,snapshot.cover,snapshot.body,snapshot.meaningKo,JSON.stringify(snapshot.tags),JSON.stringify(snapshot.entries),next,snapshot.meaningReviewedFor??'',snapshot.learningNotes??'']);
 await ctx.db.query('insert into writing_versions(draft_id,revision,snapshot,restored_from) values($1,$2,$3,$4)',[id,next,snapshot,sourceRevision]);
 return {id,revision:next};
}

export async function learningHome(ctx:Ctx){
 const recent=(await writingPage(ctx)).items.slice(0,5);
 const working=(await ctx.db.query(`select scope,content,updated_at from writing_temporary t where org_id=$1 and owner_user_id=$2 and data_mode=$3 and content is not null and updated_at>now()-interval '30 days' and (scope='new' or exists(select 1 from writing_drafts d where 'draft:'||d.id::text=t.scope and d.org_id=t.org_id and d.owner_user_id=t.owner_user_id and d.data_mode=t.data_mode and d.archived_at is null)) order by updated_at desc limit 1`,[ctx.orgId,ctx.uid,ctx.mode])).rows[0];
 const drafts=(await ctx.db.query(`select entries from writing_drafts where org_id=$1 and owner_user_id=$2 and data_mode=$3 and archived_at is null order by updated_at desc limit 10`,[ctx.orgId,ctx.uid,ctx.mode])).rows;
 const terms=[...new Set(drafts.flatMap(r=>(r.entries as {term:string}[]).map(e=>e.term)))].slice(0,8);
 return {recent,working:working?{href:working.scope==='new'?'/app/write':`/app/write/history/${WritingInput.parse(working.content).id}`,title:WritingInput.parse(working.content).title,updatedAt:new Date(working.updated_at).toISOString()}:null,terms};
}

export async function getWritingVersion(ctx:Ctx,id:string,revision:number){
 await getWriting(ctx,id);
 const row=(await ctx.db.query('select revision,snapshot from writing_versions where draft_id=$1 and revision=$2',[id,z.number().int().positive().parse(revision)])).rows[0];
 if(!row)throw new AppError('NOT_FOUND','저장한 버전을 찾을 수 없습니다.');
 return row as {revision:number;snapshot:Omit<WritingDraft,'id'|'revision'|'updatedAt'>};
}
