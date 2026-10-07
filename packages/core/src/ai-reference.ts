import { AppError, canonicalJson, contentHash, type AppEnv } from '@xhs/domain';
import { redactString } from '@xhs/security';
import type { Ctx, ServiceRunner } from './context.ts';
import type { AnalysisInput, AnalysisOutput } from './analysis.ts';
import { analyzeReference } from './analysis.ts';
import { detailedReferenceJsonSchema, REFERENCE_CONTRACT, REFERENCE_OUTPUT_TOKENS, REFERENCE_SYSTEM, validateDetailedReference } from './reference-detail.ts';
import { aiJobScope } from './ai-workflows.ts';
import type { JobDeps, JobRow, JobOutcome } from './jobs.ts';


export function aiReferenceInput(input: AnalysisInput): AnalysisInput {
  const clean=JSON.parse(redactString(JSON.stringify(input))) as AnalysisInput;
  if(![clean.title,clean.body,clean.userText,clean.userMemo,...clean.tags].some(text=>text?.trim())) throw new AppError('VALIDATION_FAILED','분석할 제목·본문 또는 메모를 먼저 입력하세요.');
  if(Buffer.byteLength(JSON.stringify(clean),'utf8')>12000) throw new AppError('VALIDATION_FAILED','분석 텍스트가 너무 깁니다. 12KB 이하로 줄여 주세요.');
  return clean;
}
export async function callReferenceAi(input: AnalysisInput, config:{key:string;model:string}, fetchImpl:typeof fetch=fetch):Promise<AnalysisOutput> {
  const clean=aiReferenceInput(input);
  const response=await fetchImpl('https://api.openai.com/v1/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(90_000),
    body:JSON.stringify({model:config.model,store:false,max_completion_tokens:REFERENCE_OUTPUT_TOKENS,messages:[{role:'system',content:REFERENCE_SYSTEM},{role:'user',content:JSON.stringify(clean)}],response_format:{type:'json_schema',json_schema:{name:'reference_analysis',strict:true,schema:detailedReferenceJsonSchema}}}),
  });
  if(!response.ok) throw new Error('AI_RESPONSE_UNAVAILABLE');
  const raw=await response.json();
  const choice=raw?.choices?.[0];
  if(choice?.finish_reason!=='stop' || choice.message?.refusal || typeof choice.message?.content!=='string') throw new Error('AI_INCOMPLETE');
  const parsed=validateDetailedReference(JSON.parse(choice.message.content),clean);
  const claims=parsed.sections.flatMap(section=>section.claims);
  const baseline=analyzeReference(clean);
  return {...parsed,observations:claims.filter(c=>c.kind==='observation'),inferences:claims.filter(c=>c.kind==='inference'),suggestions:claims.filter(c=>c.kind==='suggestion'),analysisScope:baseline.analysisScope,limitations:[...baseline.limitations,'제공된 텍스트만 분석했습니다. 촬영 구도·장면·편집·음악·영상 자막·대사는 확인할 수 없습니다. 원본 영상·표지·전체 게시물은 열람하지 않았습니다.','AI 해석에는 오류가 있을 수 있으며 성과의 원인을 입증하지 않습니다.'],generator:REFERENCE_CONTRACT};
}
export async function priceReferenceAi(ctx:Ctx,service:ServiceRunner,env:AppEnv) {
  if(!env.LIVE_LLM_CALLS_ENABLED || !env.LLM_MODEL) throw new AppError('LIVE_BLOCKED','AI 실행 스위치와 모델 설정이 필요합니다.');
  return service(async db=>{
    const r=(await db.query(`select p.id,p.unit_cost::text,p.model from provider_capabilities c join lateral
      (select * from provider_price_versions where provider=c.provider and endpoint=c.endpoint and effective_at<=now() order by effective_at desc limit 1) p on true
      where c.provider='openai' and c.endpoint='AI01' and c.price_status='verified' and c.verification_status not in ('suspended','unavailable')
        and p.unit='run' and p.currency='USD' and p.unit_cost>0 and p.output_token_limit >= ${REFERENCE_OUTPUT_TOKENS}`)).rows[0];
    const settings=(await db.query(`select settings from organizations where id=$1`,[ctx.orgId])).rows[0]?.settings;
    if(!settings?.provider_switches?.live || settings.provider_switches.kill || settings.feature_switches?.ai===false
      || !r || r.model!==env.LLM_MODEL) throw new AppError('LIVE_BLOCKED','이 모델의 검증된 분석 단가와 조직 실행 설정이 필요합니다.');
    return {prices:[{endpoint:'AI01',units:1,priceVersionId:r.id,unitCost:r.unit_cost,unit:'run'}],maxAmount:r.unit_cost as string,currency:'USD',maxUnits:1};
  });
}
export async function runReferenceAi(deps:JobDeps,job:JobRow):Promise<JobOutcome> {
  if(!deps.env?.OPENAI_API_KEY || !deps.env.LIVE_LLM_CALLS_ENABLED || !deps.env.LLM_MODEL) return {state:'failed',errorCode:'AI_NOT_CONFIGURED',sent:false};
  let prep:AnalysisInput | null;
  try { prep=await deps.service(async db=>{
    if(!await verifyAiJob(db,deps,job)) return null;
    const ref=(await db.query(`select r.*,n.title as note_title,n.body_excerpt,n.provider_tags,n.note_type from reference_items r left join notes n on n.id=r.note_id
      where r.id=$1 and r.org_id=$2 and r.owner_user_id=$3 and r.deleted_at is null and (r.note_id is null or (n.data_mode='live' and (n.expires_at is null or n.expires_at>now())))`,[job.input_ref.referenceId,job.org_id,job.owner_user_id])).rows[0];
    if(!ref) return null;
    // Only metadata/user text; transcript export requires a separately reviewed retention policy.
    return aiReferenceInput({title:ref.note_title??ref.title??null,body:ref.body_excerpt??null,tags:ref.provider_tags??ref.tags??[],userText:ref.user_text??null,userMemo:ref.user_memo??null,noteType:ref.note_type??null,transcript:null});
  });
  } catch { return {state:'failed',errorCode:'AI_PRECHECK_BLOCKED',sent:false}; }
  if(!prep) return {state:'failed',errorCode:'AI_REQUEST_INVALID',sent:false};
  await deps.service(db=>db.query(`update app_jobs set provider_task_id='ai-submission-started' where id=$1`,[job.id]));
  try {
    const output=await callReferenceAi(prep,{key:deps.env.OPENAI_API_KEY,model:deps.env.LLM_MODEL},deps.aiFetch);
    return await deps.service(async db=>{
      const exists=await db.query(`select 1 from reference_items where id=$1 and org_id=$2 and owner_user_id=$3 and deleted_at is null`,[job.input_ref.referenceId,job.org_id,job.owner_user_id]);
      if(!exists.rowCount) throw new Error('REFERENCE_REMOVED');
      const r=(await db.query(`insert into analyses(org_id,owner_user_id,target_type,target_id,input_hash,analysis_scope,schema_version,prompt_version,model,data_mode,output_json,status)
        values($1,$2,'reference',$3,$4,$5,'reference-analysis-v2','openai-reference-v2',$6,'live',$7,'succeeded') returning id`,[job.org_id,job.owner_user_id,job.input_ref.referenceId,contentHash(prep),output.analysisScope,deps.env!.LLM_MODEL,output])).rows[0];
      await db.query(`update reference_items set analysis_scope=$2 where id=$1`,[job.input_ref.referenceId,output.analysisScope]);
      return {state:'succeeded',result:{analysisId:r.id}};
    });
  } catch { return {state:'unknown_outcome',errorCode:'AI_RESULT_NEEDS_REVIEW'}; }
}

export async function verifyAiJob(db:import('./context.ts').Db,deps:JobDeps,job:JobRow):Promise<boolean> {
    const ledger=(await db.query(`select q.scope_json,q.max_amount,l.reserved_amount,q.consumed_at,l.status,q.operation
      from usage_ledger l join cost_quotes q on q.id=l.quote_id join provider_price_versions pv on pv.id=l.price_version where l.id=$1 and l.job_id=$2 and l.org_id=$3 and l.user_id=$4
      and l.provider='openai' and l.endpoint='AI01' and q.data_mode='live' and pv.output_token_limit >= ${REFERENCE_OUTPUT_TOKENS}`,[job.reserved_usage_id,job.id,job.org_id,job.owner_user_id])).rows[0];
    const {provider:_p,endpoint:_e,prices:_ps,model,...scope}=ledger?.scope_json ?? {};
    if(!ledger || ledger.operation!==job.kind || ledger.status!=='reserved' || !ledger.consumed_at || ledger.max_amount!==ledger.reserved_amount || model!==deps.env!.LLM_MODEL || canonicalJson(scope)!==canonicalJson(aiJobScope(job.kind,job.input_ref))) return false;
    const ctx:Ctx={db,orgId:job.org_id,uid:job.owner_user_id!,role:'student',mode:'live'};
    await priceReferenceAi(ctx,fn=>fn(db),deps.env!);
    const consent=await db.query(`select 1 from consent_records where org_id=$1 and user_id=$2 and purpose='external_ai_processing' and scope->>'quoteId'=$3 and withdrawn_at is null`,[job.org_id,job.owner_user_id,(await db.query(`select quote_id from usage_ledger where id=$1`,[job.reserved_usage_id])).rows[0].quote_id]);
    if(!consent.rowCount) return false;
    return true;
}
