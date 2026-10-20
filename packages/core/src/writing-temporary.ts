import {z} from 'zod';
import {AppError} from '@xhs/domain';
import type {Ctx} from './context.ts';
import {WritingInput} from './writing.ts';
import {composerEntries} from './personal-dictionary.ts';
const Scope=z.union([z.literal('new'),z.string().regex(/^draft:[0-9a-f-]{36}$/)]);
export const TemporaryWritingInput=z.object({scope:Scope,version:z.number().int().min(0),content:WritingInput.nullable()}).strict();
export type TemporaryWriting={version:number;content:z.infer<typeof WritingInput>|null;updatedAt:string|null;terms:string[]};
export async function getTemporaryWriting(ctx:Ctx,scope:string):Promise<TemporaryWriting>{
 const row=(await ctx.db.query(`select revision,content,updated_at from writing_temporary where org_id=$1 and owner_user_id=$2 and data_mode=$3 and scope=$4`,[ctx.orgId,ctx.uid,ctx.mode,Scope.parse(scope)])).rows[0];
 if(!row)return {version:0,content:null,updatedAt:null,terms:[]};
 const content=new Date(row.updated_at).getTime()>Date.now()-30*86400000?row.content:null;
 const entries=content?await composerEntries(ctx,WritingInput.parse(content).entryIds):[];
 return {version:row.revision,content,updatedAt:new Date(row.updated_at).toISOString(),terms:entries.map(e=>e.term)};
}
export async function saveTemporaryWriting(ctx:Ctx,raw:unknown){
 const input=TemporaryWritingInput.parse(raw);
 await ctx.db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`temporary:${ctx.orgId}:${ctx.uid}:${ctx.mode}:${input.scope}`]);
 const current=await getTemporaryWriting(ctx,input.scope);
 if(current.version!==input.version)throw new AppError('CONFLICT','다른 창에서 임시 저장이 변경됐습니다. 현재 내용을 복사한 뒤 다시 열어 주세요.');
 if(input.content){
  if(input.scope!=='new'&&input.scope!==`draft:${input.content.id}`)throw new AppError('VALIDATION_FAILED','작성물과 임시 저장 위치가 다릅니다.');
  const draft=(await ctx.db.query('select revision from writing_drafts where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4',[input.content.id,ctx.orgId,ctx.uid,ctx.mode])).rows[0];
  if((draft?.revision??0)!==input.content.revision)throw new AppError('CONFLICT','저장본이 변경됐습니다. 현재 내용을 복사한 뒤 최신 저장본을 열어 주세요.');
  const entries=await composerEntries(ctx,input.content.entryIds);
  if(entries.length!==new Set(input.content.entryIds).size)throw new AppError('VALIDATION_FAILED','사용한 사전 항목이 숨겨졌거나 접근할 수 없습니다. 선택을 다시 확인하세요.');
 }
 const version=current.version+1;
 await ctx.db.query(`insert into writing_temporary(org_id,owner_user_id,data_mode,scope,revision,content) values($1,$2,$3,$4,$5,$6)
 on conflict(org_id,owner_user_id,data_mode,scope) do update set revision=$5,content=$6,updated_at=now()`,[ctx.orgId,ctx.uid,ctx.mode,input.scope,version,input.content]);
 return {version};
}
