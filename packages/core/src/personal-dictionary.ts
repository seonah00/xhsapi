import { z } from 'zod';
import { AppError,canonicalTerm } from '@xhs/domain';
import type { Ctx } from './context.ts';
import { getPublishedDictionaryEntries,type SharedDictionaryEntry } from './shared-dictionary.ts';
import { keywordPlanCandidates,KeywordPlanSource } from './keyword-plan.ts';
import { languageJobResult } from './search-language-ai.ts';
const Source=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('shared'),id:z.string().uuid()}).strict(),
 z.object({kind:z.literal('observed'),source:KeywordPlanSource,term:z.string().min(1).max(120)}).strict(),
 z.object({kind:z.literal('interpret'),jobId:z.string().uuid(),term:z.string().min(1).max(120)}).strict(),
 z.object({kind:z.literal('manual'),entryType:z.enum(['tag','expression']),term:z.string().trim().min(1).max(120),meaning:z.string().trim().max(1000)}).strict(),
]);
export async function savePersonalDictionary(ctx:Ctx,raw:unknown) {
 const source=Source.parse(raw);
 let entryType:'tag'|'expression'='tag',term='',meaning='',cautions:string[]=[];
 if(source.kind==='shared') {
  const entry=(await getPublishedDictionaryEntries(ctx,[source.id]))[0];
  if(!entry) throw new AppError('NOT_FOUND','공개 사전 항목을 찾을 수 없습니다.');
  ({entryType,term,meaning,cautions}=entry);
 } else if(source.kind==='observed') {
  const research=await keywordPlanCandidates(ctx,source.source);
  const item=research.result.items.find(i=>i.term===source.term && i.noteCount>0);
  if(!item) throw new AppError('VALIDATION_FAILED','현재 게시물에서 확인된 태그만 저장할 수 있습니다.');
  term=item.term;meaning=item.meaning??'뜻 미확인';cautions=item.cautions;
 } else if(source.kind==='interpret') {
  const job=await languageJobResult(ctx,source.jobId);
  const item=job?.state==='succeeded' && job.input_ref.task==='interpret'?job.result_ref?.output.expressions.find(e=>e.term===source.term):null;
  if(!item) throw new AppError('NOT_FOUND','확인된 표현 해석을 찾을 수 없습니다.');
  entryType='expression';term=item.term;meaning=item.meaningKo;cautions=[item.cautionKo,'AI 해석: 실제 사용 문맥을 다시 확인하세요.'];
 } else ({entryType,term,meaning}=source);
 term=term.normalize('NFKC').replace(/^#+/,'').trim();
 if(!term || term.length>120 || /https?:|[\r\n]/i.test(term)) throw new AppError('VALIDATION_FAILED','태그 또는 표현만 입력하세요.');
 if(entryType==='tag' && (term.length>80 || /\s/u.test(term))) throw new AppError('VALIDATION_FAILED','해시태그는 공백 없이 80자 이내로 입력하세요.');
 // A repeat save does not overwrite the user's existing notes; archived items can be restored.
 return (await ctx.db.query(`insert into personal_dictionary(org_id,owner_user_id,data_mode,entry_type,term,canonical_term,meaning,cautions,source_kind)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(org_id,owner_user_id,data_mode,entry_type,canonical_term)
 do update set deleted_at=null returning id`,[ctx.orgId,ctx.uid,ctx.mode,entryType,term,canonicalTerm(term),meaning,JSON.stringify(cautions),source.kind])).rows[0].id as string;
}
export async function personalDictionaryEntries(ctx:Ctx,ids?:string[],query='') :Promise<SharedDictionaryEntry[]> {
 if(ids) z.array(z.string().uuid()).max(11).parse(ids);
 const rows=(await ctx.db.query(`select * from personal_dictionary where org_id=$1 and owner_user_id=$2 and data_mode=$3 and deleted_at is null
 and ($4::uuid[] is null or id=any($4)) and (strpos(lower(term||' '||meaning),lower($5))>0) order by saved_at desc limit 200`,[ctx.orgId,ctx.uid,ctx.mode,ids??null,query.slice(0,100)])).rows;
 return rows.map(r=>({id:r.id,entryType:r.entry_type,term:r.term,meaning:r.meaning||'뜻 미입력',type:'내 사전',categories:[],cautions:r.cautions,groups:[],observedCount:null,unknownTrendNote:({manual:'직접 등록한 항목 · 실사용 미검증',shared:'공용사전에서 저장한 항목',observed:'저장 당시 검색 표본에서 확인 · 현재 인기 지표 아님',interpret:'AI 문맥 해석에서 저장 · 해석 검토 필요'} as Record<string,string>)[r.source_kind]??null}));
}
export async function composerEntries(ctx:Ctx,ids:string[]) {
 z.array(z.string().uuid()).max(11).parse(ids);
 const [shared,personal]=await Promise.all([getPublishedDictionaryEntries(ctx,ids),personalDictionaryEntries(ctx,ids)]);
 return [...shared,...personal];
}
export async function archivePersonalDictionary(ctx:Ctx,id:string) {
 await ctx.db.query(`update personal_dictionary set deleted_at=now() where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4`,[z.string().uuid().parse(id),ctx.orgId,ctx.uid,ctx.mode]);
}
