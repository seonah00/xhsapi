import { AppError, canonicalJson, enrichmentIds, type AppEnv } from '@xhs/domain';
import { APIFY_ACTOR, APIFY_DETAIL_CAPABILITY, ApifyBuild, evaluateLiveGate, ProviderNotReadyError,
  type ApifyDetailOptions, type ApifyNoteDetailProvider, type ProviderNote } from '@xhs/providers';
import type { Ctx, Db, ServiceRunner } from './context.ts';
import { requireAdmin } from './admin.ts';
import { orgOps } from './ops.ts';

export async function enrichmentTarget(ctx: Ctx, scope: unknown) {
  requireAdmin(ctx);
  const ids = enrichmentIds(scope);
  const rows = (await ctx.db.query(`select id, platform_note_id, data_mode from notes where id=any($1::uuid[]) and org_id=$2 and data_mode=$3`, [ids, ctx.orgId, ctx.mode])).rows;
  if (rows.length !== ids.length) throw new AppError('NOT_FOUND', '노트를 찾을 수 없습니다.');
  if (ctx.mode === 'live' && rows.some(n => !/^[a-f0-9]{24}$/.test(n.platform_note_id))) throw new AppError('VALIDATION_FAILED', '샤오홍슈 노트 ID를 확인할 수 없습니다.');
  return rows;
}

async function state(db: Db, orgId: string) {
  const ops = await orgOps(db, orgId);
  const c = (await db.query(`select params_status,price_status from provider_capabilities where provider='apify' and endpoint='AP01'`)).rows[0];
  return { ops, permission: null, ttl: 86400,
    capability: { ...APIFY_DETAIL_CAPABILITY, ...(c ? {paramsStatus:c.params_status,priceStatus:c.price_status} : {}) } };
}

export async function priceEnrichment(ctx: Ctx, service: ServiceRunner, env: AppEnv, count = 1) {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new AppError('VALIDATION_FAILED', '보완 대상은 1~50건이어야 합니다.');
  if (!env.APIFY_ENABLED || !ApifyBuild.safeParse(env.APIFY_ACTOR_BUILD).success) throw new AppError('LIVE_BLOCKED','Apify 활성화와 고정 빌드 설정이 필요합니다.');
  const st = await service(db=>state(db,ctx.orgId));
  const gate = evaluateLiveGate({env,endpoint:st.capability,orgLiveEnabled:st.ops.provider.live && !st.ops.provider.kill,permission:st.permission,
    purposes:['fetch','metadata_display','excerpt_display','media_display','cache'],consentRecorded:true,budgetReserved:true,userApproved:true});
  if (!gate.allowed) throw new AppError('LIVE_BLOCKED', '이미지 업데이트가 아직 준비되지 않았습니다. 관리자가 요금과 실행 설정을 확인해야 합니다.');
  const p = (await ctx.db.query(`select id,unit,unit_cost::text,currency from provider_price_versions where provider='apify' and endpoint='AP01' and effective_at<=now() order by effective_at desc limit 1`)).rows[0];
  // A verified total-run cap includes all charge types; dataset items and SocialDataX points are not interchangeable.
  if (!p || p.unit !== 'run' || p.currency !== 'USD' || Number(p.unit_cost)<=0) throw new AppError('LIVE_BLOCKED','Apify의 검증된 USD/run 최대 비용이 필요합니다.');
  const budget = await service(db=>db.query(`select 1 from usage_budgets where org_id=$1 and subject_type='org' and subject_id=$1 and currency='USD' and amount_limit>0 and period_start<=current_date and period_end>current_date`,[ctx.orgId]));
  if (!budget.rowCount) throw new AppError('LIVE_BLOCKED','Apify용 USD 조직 예산이 필요합니다.');
  const total = (await ctx.db.query(`select ($1::numeric * $2::integer)::numeric(20,8)::text as amount`,[p.unit_cost,count])).rows[0].amount as string;
  return { prices:[{endpoint:'AP01',units:count,priceVersionId:p.id,unitCost:p.unit_cost,currency:'USD',unit:'run'}],maxAmount:total,currency:'USD',maxUnits:count };
}

export async function enrichmentOptions(db: Db, job: { id: string; org_id: string; owner_user_id: string | null; reserved_usage_id: string | null; input_ref: Record<string, unknown> }, env: AppEnv, index = 0): Promise<ApifyDetailOptions & { total: number; permissionId: string | null; ttl: number; noteId: string; platformNoteId: string }> {
  const row = (await db.query(`select q.id as quote_id,q.scope_json,q.max_amount::text,q.currency,q.operation,q.consumed_at,l.status,l.reserved_amount::text
    from usage_ledger l join cost_quotes q on q.id=l.quote_id
    where l.id=$1 and l.job_id=$2 and l.org_id=$3 and l.user_id=$4 and l.provider='apify' and l.endpoint='AP01'
      and q.org_id=$3 and q.owner_user_id=$4 and q.data_mode='live'`,[job.reserved_usage_id,job.id,job.org_id,job.owner_user_id])).rows[0];
  if (!row || row.operation!=='note_enrichment' || row.currency!=='USD'
    || row.scope_json.actor!==APIFY_ACTOR || row.status!=='reserved' || row.reserved_amount!==row.max_amount || !row.consumed_at) throw new ProviderNotReadyError('APIFY_QUOTE_INVALID');
  const { actor: _actor, actorBuild: _build, runCapUsd, provider: _provider, endpoint: _endpoint, prices: _prices, ...quoted } = row.scope_json;
  if (canonicalJson(quoted) !== canonicalJson(job.input_ref)) throw new ProviderNotReadyError('APIFY_SCOPE_INVALID');
  const ids = enrichmentIds(quoted);
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) throw new ProviderNotReadyError('APIFY_PROGRESS_INVALID');
  const target = (await db.query(`select id,platform_note_id from notes where id=$1 and org_id=$2 and data_mode='live'`,[ids[index],job.org_id])).rows[0];
  if (!target) throw new ProviderNotReadyError('APIFY_TARGET_MISSING');
  const st=await state(db,job.org_id);
  const consent=(await db.query(`select 1 from consent_records where org_id=$1 and user_id=$2 and purpose='external_provider_query' and policy_version='apify-zen-detail-v1' and scope->>'quoteId'=$3 and withdrawn_at is null limit 1`,[job.org_id,job.owner_user_id,row.quote_id])).rowCount===1;
  return { token:env.APIFY_TOKEN ?? '', build:row.scope_json.actorBuild,maxChargeUsd:runCapUsd ?? (ids.length === 1 ? row.max_amount : ''),
    gate:{env,endpoint:st.capability,orgLiveEnabled:st.ops.provider.live && !st.ops.provider.kill && st.ops.features.provider_search,permission:st.permission,
      purposes:['fetch','metadata_display','excerpt_display','media_display','cache'],consentRecorded:consent,budgetReserved:true,userApproved:true},
    total:ids.length,permissionId:null,ttl:st.ttl,noteId:target.id,platformNoteId:target.platform_note_id };
}

export async function storeEnrichment(db: Db, orgId: string, noteId: string, n: ProviderNote, meta: { permissionId: string | null; ttl: number; build: string; jobId: string }) {
  // Re-check the operational stop switch after a request completes.
  const ops = await orgOps(db, orgId);
  if (!ops.provider.live || ops.provider.kill || !ops.features.provider_search) throw new Error('APIFY_STOPPED');
  await db.query(`insert into note_enrichments(note_id,org_id,permission_id,title,body_excerpt,cover_url,note_type,provider_tags,metrics_json,actor_build,job_id,expires_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+make_interval(secs=>$12))
    on conflict(note_id) do update set permission_id=excluded.permission_id,title=excluded.title,body_excerpt=excluded.body_excerpt,cover_url=excluded.cover_url,
      note_type=excluded.note_type,provider_tags=excluded.provider_tags,metrics_json=excluded.metrics_json,actor_build=excluded.actor_build,job_id=excluded.job_id,fetched_at=now(),expires_at=excluded.expires_at`,
    [noteId,orgId,meta.permissionId,n.title,n.bodyExcerpt,n.coverUrl??null,n.noteType,n.providerTags,Object.fromEntries(Object.entries(n.metrics).filter(([, v]) => v.precision !== 'unknown')),meta.build,meta.jobId,Math.min(meta.ttl,86400)]);
}

export type EnrichmentProviderFactory = (options: ApifyDetailOptions) => ApifyNoteDetailProvider;
