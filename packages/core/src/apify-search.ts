import { AppError, canonicalJson, type AppEnv } from '@xhs/domain';
import { APIFY_SEARCH_ACTOR, APIFY_SEARCH_CAPABILITY, ApifyBuild, ApifySearchScope, evaluateLiveGate, LiveCallBlockedError, ProviderNotReadyError, type ApifyDetailOptions } from '@xhs/providers';
import type { Ctx, Db, ServiceRunner } from './context.ts';
import { orgOps } from './ops.ts';

async function gate(db:Db,orgId:string,env:AppEnv,approved:boolean) {
  const ops=await orgOps(db,orgId);
  const c=(await db.query(`select params_status,price_status from provider_capabilities where provider='apify' and endpoint='AP02'`)).rows[0];
  return {env,endpoint:{...APIFY_SEARCH_CAPABILITY,...(c?{paramsStatus:c.params_status,priceStatus:c.price_status}:{})},orgLiveEnabled:ops.provider.live&&!ops.provider.kill&&ops.features.provider_search,consentRecorded:approved,budgetReserved:approved,userApproved:approved,purposes:['fetch','metadata_display','cache'] as const};
}
export async function priceApifySearch(ctx:Ctx,service:ServiceRunner,env:AppEnv,scope:Record<string,unknown>) {
  const input=ApifySearchScope.parse(scope);
  if(!ApifyBuild.safeParse(env.APIFY_SEARCH_BUILD).success) throw new AppError('LIVE_BLOCKED','검색 공급자의 고정 빌드 설정이 필요합니다.');
  const g=evaluateLiveGate(await service(db=>gate(db,ctx.orgId,env,true)));
  if(!g.allowed) throw new AppError('LIVE_BLOCKED','원문 링크 검색의 요금과 실행 설정을 확인하세요.');
  const p=(await ctx.db.query(`select id,unit,unit_cost::text,currency from provider_price_versions where provider='apify' and endpoint='AP02' and effective_at<=now() order by effective_at desc limit 1`)).rows[0];
  if(!p || p.unit!=='run' || p.currency!=='USD' || Number(p.unit_cost)<=0) throw new AppError('LIVE_BLOCKED','50건 검색의 검증된 USD 상한 단가가 필요합니다.');
  const amount=(await ctx.db.query(`select ($1::numeric*$2::int)::numeric(20,8)::text as amount`,[p.unit_cost,input.targetCount/50])).rows[0].amount;
  return {prices:[{endpoint:'AP02',units:input.targetCount/50,priceVersionId:p.id,unitCost:p.unit_cost,currency:'USD',unit:'run'}],maxAmount:amount as string,currency:'USD',maxUnits:input.targetCount/50};
}
export async function apifySearchOptions(db:Db,job:{id:string;org_id:string;owner_user_id:string|null;reserved_usage_id:string|null;input_ref:Record<string,unknown>},env:AppEnv):Promise<ApifyDetailOptions> {
  ApifySearchScope.parse(job.input_ref);
  const q=(await db.query(`select q.scope_json,q.max_amount::text,q.currency,q.operation,q.consumed_at,l.status,l.reserved_amount::text,q.id
    from cost_quotes q join usage_ledger l on l.quote_id=q.id where l.id=$1 and l.job_id=$2 and l.org_id=$3 and l.user_id=$4
    and q.org_id=$3 and q.owner_user_id=$4 and q.data_mode='live' and l.provider='apify' and l.endpoint='AP02'`,[job.reserved_usage_id,job.id,job.org_id,job.owner_user_id])).rows[0];
  if(!q || q.operation!=='provider_search' || q.scope_json.actor!==APIFY_SEARCH_ACTOR || q.currency!=='USD' || q.status!=='reserved' || q.reserved_amount!==q.max_amount || !q.consumed_at) throw new ProviderNotReadyError('APIFY_SEARCH_QUOTE');
  const {actor:_actor,actorBuild:_build,provider:_provider,endpoint:_endpoint,prices:_prices,...scope}=q.scope_json;
  if(canonicalJson(scope)!==canonicalJson(job.input_ref)) throw new ProviderNotReadyError('APIFY_SEARCH_SCOPE');
  const automatic=(await db.query(`select 1 from search_requests where job_id=$1 limit 1`,[job.id])).rowCount;
  if(automatic) {
    const p=(await db.query(`select settings->'auto_search' as p from organizations where id=$1`,[job.org_id])).rows[0]?.p;
    const sponsor=(await db.query(`select 1 from memberships where org_id=$1 and user_id=$2 and role='org_admin' and status='active'`,[job.org_id,job.owner_user_id])).rowCount;
    if(!env.AUTO_REFRESH_ENABLED || !p?.enabled || p.provider!=='apify' || p.approvedBy!==job.owner_user_id || !sponsor || !p.expiresAt || Date.parse(p.expiresAt)<=Date.now() || Number(p.maxUsd)<Number(q.max_amount)) throw new LiveCallBlockedError(['not_user_approved']);
  }
  const consent=(await db.query(`select 1 from consent_records where org_id=$1 and user_id=$2 and policy_version='apify-search-v1' and scope->>'quoteId'=$3 and withdrawn_at is null`,[job.org_id,job.owner_user_id,q.id])).rowCount===1;
  return {token:env.APIFY_TOKEN??'',build:q.scope_json.actorBuild,maxChargeUsd:q.max_amount,gate:await gate(db,job.org_id,env,consent)};
}
