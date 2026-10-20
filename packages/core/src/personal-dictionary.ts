import {pageWindow} from './library-page.ts';
import { z } from 'zod';
import { AppError,canonicalTerm } from '@xhs/domain';
import type { Ctx } from './context.ts';
import { getPublishedDictionaryEntries,type SharedDictionaryEntry } from './shared-dictionary.ts';
import { keywordPlanCandidates,KeywordPlanSource } from './keyword-plan.ts';
import {expressionGuide} from './expression-guides.ts';
import { languageJobResult } from './search-language-ai.ts';
export type PersonalDictionaryEntry=SharedDictionaryEntry & {note:string;folder:string;favorite:boolean;usage:string;examples:{zh:string;ko:string}[];revision:number};
const Source=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('shared'),id:z.string().uuid()}).strict(),
 z.object({kind:z.literal('observed'),source:KeywordPlanSource,term:z.string().min(1).max(120)}).strict(),
 z.object({kind:z.literal('interpret'),jobId:z.string().uuid(),term:z.string().min(1).max(120)}).strict(),
 z.object({kind:z.literal('manual'),entryType:z.enum(['tag','expression']),term:z.string().trim().min(1).max(120),meaning:z.string().trim().max(1000)}).strict(),
]);
export async function savePersonalDictionary(ctx:Ctx,raw:unknown) {
 const source=Source.parse(raw);
 let usage='';let examples:{zh:string;ko:string}[]=[];
 let entryType:'tag'|'expression'='tag',term='',meaning='',cautions:string[]=[];
 if(source.kind==='shared') {
  const entry=(await getPublishedDictionaryEntries(ctx,[source.id]))[0];
  if(!entry) throw new AppError('NOT_FOUND','공개 사전 항목을 찾을 수 없습니다.');
  ({entryType,term,meaning,cautions}=entry);
  const guide=expressionGuide(term);if(guide){usage=guide.situation+' · '+guide.nuance;examples=[{zh:guide.zh,ko:guide.ko}];}
 } else if(source.kind==='observed') {
  const research=await keywordPlanCandidates(ctx,source.source);
  const item=research.result.items.find(i=>i.term===source.term && i.noteCount>0);
  if(!item) throw new AppError('VALIDATION_FAILED','현재 게시물에서 확인된 태그만 저장할 수 있습니다.');
  term=item.term;meaning=item.meaning??'뜻 미확인';cautions=item.cautions;
 } else if(source.kind==='interpret') {
  const job=await languageJobResult(ctx,source.jobId);
  const item=job?.state==='succeeded' && job.input_ref.task==='interpret'?job.result_ref?.output.expressions.find(e=>e.term===source.term):null;
  if(!item) throw new AppError('NOT_FOUND','확인된 표현 해석을 찾을 수 없습니다.');
  usage=item.usageKo;entryType='expression';term=item.term;meaning=item.meaningKo;cautions=[item.cautionKo,'AI 해석: 실제 사용 문맥을 다시 확인하세요.'];
 } else ({entryType,term,meaning}=source);
 term=term.normalize('NFKC').replace(/^#+/,'').trim();
 if(!term || term.length>120 || /https?:|[\r\n]/i.test(term)) throw new AppError('VALIDATION_FAILED','태그 또는 표현만 입력하세요.');
 if(entryType==='tag' && (term.length>80 || /\s/u.test(term))) throw new AppError('VALIDATION_FAILED','해시태그는 공백 없이 80자 이내로 입력하세요.');
 // A repeat save does not overwrite the user's existing notes; archived items can be restored.
 return (await ctx.db.query(`insert into personal_dictionary(org_id,owner_user_id,data_mode,entry_type,term,canonical_term,meaning,cautions,source_kind,usage,examples)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(org_id,owner_user_id,data_mode,entry_type,canonical_term)
 do update set deleted_at=null returning id`,[ctx.orgId,ctx.uid,ctx.mode,entryType,term,canonicalTerm(term),meaning,JSON.stringify(cautions),source.kind,usage,JSON.stringify(examples)])).rows[0].id as string;
}
export async function personalDictionaryEntries(ctx:Ctx,ids?:string[],query='') :Promise<PersonalDictionaryEntry[]> {
 if(ids) z.array(z.string().uuid()).max(20).parse(ids);
 const rows=(await ctx.db.query(`select * from personal_dictionary where org_id=$1 and owner_user_id=$2 and data_mode=$3 and deleted_at is null
 and ($4::uuid[] is null or id=any($4)) and (strpos(lower(term||' '||meaning||' '||note||' '||folder||' '||usage),lower($5))>0) order by favorite desc,saved_at desc,id limit 200`,[ctx.orgId,ctx.uid,ctx.mode,ids??null,query.slice(0,100)])).rows;
 return rows.map(r=>({id:r.id,entryType:r.entry_type,term:r.term,meaning:r.meaning||'뜻 미입력',note:r.note,folder:r.folder,favorite:r.favorite,usage:r.usage,examples:r.examples,revision:r.revision,type:'내 사전',categories:[],cautions:r.cautions,groups:[],observedCount:null,unknownTrendNote:({manual:'직접 등록한 항목 · 실사용 미검증',shared:'공용사전에서 저장한 항목',observed:'저장 당시 검색 표본에서 확인 · 현재 인기 지표 아님',interpret:'AI 문맥 해석에서 저장 · 해석 검토 필요'} as Record<string,string>)[r.source_kind]??null}));
}
export async function composerEntries(ctx:Ctx,ids:string[]) {
 z.array(z.string().uuid()).max(11).parse(ids);
 const [shared,personal]=await Promise.all([getPublishedDictionaryEntries(ctx,ids),personalDictionaryEntries(ctx,ids)]);
 return [...shared,...personal];
}
export async function archivePersonalDictionary(ctx:Ctx,id:string) {
 await ctx.db.query(`update personal_dictionary set deleted_at=now() where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4`,[z.string().uuid().parse(id),ctx.orgId,ctx.uid,ctx.mode]);
}

export const PersonalEditInput=z.object({
 id:z.string().uuid(),revision:z.number().int().positive(),meaning:z.string().trim().max(1000),
 note:z.string().trim().max(2000),folder:z.string().trim().max(60),favorite:z.boolean(),usage:z.string().trim().max(2000),
 examples:z.array(z.object({zh:z.string().trim().min(1).max(1000),ko:z.string().trim().max(1000)}).strict()).max(10),
}).strict();
export async function editPersonalDictionary(ctx:Ctx,raw:unknown){
 const input=PersonalEditInput.parse(raw);
 const result=await ctx.db.query(`update personal_dictionary set meaning=$5,note=$6,folder=$7,favorite=$8,usage=$9,examples=$10,revision=revision+1
 where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 and revision=$11 and deleted_at is null returning revision`,[input.id,ctx.orgId,ctx.uid,ctx.mode,input.meaning,input.note,input.folder,input.favorite,input.usage,JSON.stringify(input.examples),input.revision]);
 if(!result.rowCount)throw new AppError('CONFLICT','항목이 변경되었거나 접근할 수 없습니다. 다시 열어 확인해 주세요.');
 return result.rows[0].revision as number;
}

/** Filter before pagination; selection resolution remains independent of the current page. */
export async function personalDictionaryPage(ctx:Ctx,raw:{q?:string;folder?:string;favorite?:boolean;page?:number}={}){
 const filter=z.object({q:z.string().trim().max(100).default(''),folder:z.string().max(60).default(''),favorite:z.boolean().default(false),page:z.number().catch(1).optional()}).parse(raw);
 const params=[ctx.orgId,ctx.uid,ctx.mode,filter.q,filter.folder,filter.favorite];
 const where=`org_id=$1 and owner_user_id=$2 and data_mode=$3 and deleted_at is null
 and strpos(lower(term||' '||meaning||' '||note||' '||folder||' '||usage||' '||examples::text),lower($4))>0
 and ($5='' or folder=$5) and (not $6::boolean or favorite)`;
 const total=Number((await ctx.db.query(`select count(*) as total from personal_dictionary where ${where}`,params)).rows[0].total);
 const paging=pageWindow(total,filter.page,12);
 const ids=(await ctx.db.query(`select id from personal_dictionary where ${where} order by favorite desc,saved_at desc,id limit $7 offset $8`,[...params,paging.limit,paging.offset])).rows.map(r=>r.id as string);
 const items=ids.length?await personalDictionaryEntries(ctx,ids):[];
 const folders=(await ctx.db.query(`select distinct folder from personal_dictionary where org_id=$1 and owner_user_id=$2 and data_mode=$3 and deleted_at is null and folder<>'' order by folder`,[ctx.orgId,ctx.uid,ctx.mode])).rows.map(r=>r.folder as string);
 return {...paging,items,folders};
}
