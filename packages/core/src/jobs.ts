import { isTextAiOperation, runTextWorkflow } from './ai-workflows.ts';
import { runReferenceAi } from './ai-reference.ts';
import { advanceCollection, CollectionTarget, collectionPages, enrichmentIds, contentHash, type AppEnv, type DataMode, type JobKind } from '@xhs/domain';
import { redactString } from '@xhs/security';
import { isUnchargedError, LiveCallBlockedError, ProviderContractError, ProviderHttpError, type EndpointCapability, type EndpointId, type GateContextFor, type XhsDataProvider } from '@xhs/providers';
import { enrichmentOptions, storeEnrichment, type EnrichmentProviderFactory } from './note-enrichment.ts';
import { liveGateForJob, MAX_TRANSCRIPT_POLLS } from './live.ts';
import { analyzeReference } from './analysis.ts';
import type { Db } from './context.ts';
import { ingestSearchResult } from './ingest.ts';
import { storeTranscriptResult, transcriptStoragePolicy } from './transcripts.ts';
import { FactSheet, PlanContent, PlanDraft, insertProposalVersion, sectionsOf } from './plans.ts';
import { findInventedNumbers, generatePlan } from './generation.ts';
import { mockContextual } from './checks.ts';
import { reflect, type ResultMetrics } from './results.ts';
import { processDeletion } from './deletion.ts';

export type Runner = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export type JobRow = {
  id: string; org_id: string; owner_user_id: string | null; kind: JobKind; data_mode: DataMode; input_ref: Record<string, unknown>;
  result_ref?: Record<string, unknown> | null; attempts: number; reserved_usage_id: string | null; created_at: Date;
};

export type JobOutcome =
  | { state: 'succeeded'; result?: Record<string, unknown> }
  | { state: 'waiting_external'; retryInMs: number }
  /** sent: false = refused before any provider request, so a live reservation is released. */
  | { state: 'failed'; errorCode: string; sent?: false }
  | { state: 'unknown_outcome'; errorCode: string };

export type JobDeps = {
  service: Runner;
  provider: XhsDataProvider;
  storage?: import('./storage.ts').ObjectStorage;
  now?: () => Date;
  /** Poll interval for async provider results; small in mock mode. */
  pollBaseMs?: number;
  /** Live mode only: builds the provider for one job from its stored gate state. Absent = live jobs are refused. */
  liveProvider?: (gate: { gateFor: GateContextFor; capabilities: Record<EndpointId, EndpointCapability>; searchEndpoint: 'RF01' | 'RF02' }) => XhsDataProvider;
  apifyDetailProvider?: EnrichmentProviderFactory;
  env?: AppEnv;
  aiFetch?: typeof fetch;
};

const MAX_TRANSCRIPT_WAIT_MS = 24 * 3600_000;

/** Lists jobs that are visible and claimable now (oldest first). */
export async function claimableJobIds(service: Runner, limit = 5): Promise<string[]> {
  return service(async (db) => (await db.query<{ id: string }>(
    `select id from app_jobs where (state in ('queued', 'waiting_external') or (state = 'running' and lease_expires_at < now()))
       and (visible_after is null or visible_after <= now()) order by created_at limit $1`, [limit],
  )).rows.map((r) => r.id));
}

/**
 * Claims and runs one job. Every run re-checks the owner's membership (spec 10.1:
 * queued work never grants lasting permission). Errors are stored as redacted codes.
 */
export async function runJob(deps: JobDeps, jobId: string, workerId: string): Promise<JobOutcome | null> {
  const claimed = await deps.service(async (db) => (await db.query<{ ok: boolean }>(`select app.claim_job($1, $2) as ok`, [jobId, workerId])).rows[0]?.ok);
  if (!claimed) return null;
  const job = await deps.service(async (db) => (await db.query<JobRow>(`select * from app_jobs where id = $1`, [jobId])).rows[0]);
  if (!job) return null;

  let outcome: JobOutcome;
  if ((isTextAiOperation(job.kind) || job.kind === 'note_enrichment' || (job.kind === 'provider_search' && job.input_ref.targetCount !== undefined)) && job.data_mode === 'live') {
    const submitted = await deps.service(async db => (await db.query('select provider_task_id from app_jobs where id=$1',[job.id])).rows[0]?.provider_task_id);
    if (submitted) {
      const uncertain: JobOutcome = {state:'unknown_outcome',errorCode:'PREVIOUS_SUBMISSION_UNKNOWN'};
      await finish(deps,job,uncertain);
      return uncertain;
    }
  }
  try {
    const blocked = await deps.service(async (db) => {
      const s = (await db.query(`select settings from organizations where id = $1`, [job.org_id])).rows[0]?.settings ?? {};
      const feature = ({ transcript_submit: 'transcript', transcript_result: 'transcript', provider_search: 'provider_search', note_enrichment: 'provider_search', reference_analysis: 'ai',
        plan_generation: 'ai', contextual_check: 'ai', results_reflection: 'ai' } as Record<string, string>)[job.kind];
      // Housekeeping (deletion, expiry) is never blocked by the kill switch.
      if (!feature) return null;
      if (s.provider_switches?.kill === true) return 'kill_switch';
      if (s.feature_switches?.[feature] === false && job.kind !== 'transcript_result') return 'feature_disabled';
      return null;
    });
    // Deletion must still run for members who left or were suspended after requesting it.
    if (job.owner_user_id && job.kind !== 'user_deletion' && !(await stillMember(deps.service, job.org_id, job.owner_user_id))) {
      outcome = { state: 'failed', errorCode: 'membership_revoked', sent: false };
    } else if (blocked) {
      outcome = { state: 'failed', errorCode: blocked, sent: false };
    } else if (job.kind === 'reference_analysis' && job.data_mode === 'live') {
      outcome = await runReferenceAi(deps, job);
    } else if (isTextAiOperation(job.kind) && job.data_mode === 'live') {
      outcome = await runTextWorkflow(deps,job);
    } else if (job.kind === 'note_enrichment') {
      outcome = await enrichNote(deps, job);
    } else if (job.data_mode === 'live' && job.kind !== 'user_deletion') {
      if (!deps.liveProvider || !deps.env) {
        outcome = { state: 'failed', errorCode: 'live_not_configured', sent: false };
      } else {
        const gate = await deps.service((db) => liveGateForJob(db, job, deps.env!));
        outcome = await dispatch({ ...deps, provider: deps.liveProvider(gate) }, job);
      }
    } else {
      outcome = await dispatch(deps, job);
    }
  } catch (e) {
    const errorCode = redactString(e instanceof Error ? `${e.name}: ${e.message}` : 'error').slice(0, 200);
    const collectionSent = job.kind === 'provider_search' && job.input_ref.targetCount !== undefined && job.data_mode === 'live' && await deps.service(async db => !!(await db.query('select provider_task_id from app_jobs where id=$1',[job.id])).rows[0]?.provider_task_id);
    outcome = collectionSent ? {state:'unknown_outcome',errorCode:'SEARCH_RESULT_NEEDS_REVIEW'} : isUnchargedError(e) ? { state: 'failed', errorCode, sent: false } : { state: 'failed', errorCode };
  }
  await finish(deps, job, outcome);
  return outcome;
}

async function stillMember(service: Runner, orgId: string, uid: string): Promise<boolean> {
  return service(async (db) => (await db.query(`select 1 from memberships where org_id = $1 and user_id = $2 and status = 'active'`, [orgId, uid])).rowCount === 1);
}

async function finish(deps: JobDeps, job: JobRow, o: JobOutcome): Promise<void> {
  await deps.service(async (db) => {
    if (o.state === 'waiting_external') {
      await db.query(`update app_jobs set state = 'waiting_external', visible_after = now() + make_interval(secs => $2::double precision / 1000), lease_expires_at = null where id = $1`, [job.id, o.retryInMs]);
      return;
    }
    await db.query(
      `update app_jobs set state = $2, error_code = $3, result_ref = coalesce($4, result_ref), lease_expires_at = null where id = $1`,
      [job.id, o.state, 'errorCode' in o ? o.errorCode : null, o.state === 'succeeded' ? o.result ?? null : null],
    );
    if (job.reserved_usage_id && job.data_mode === 'live') {
      // Conservative live settlement until provider billing reports exist: success is charged at the
      // maximum for completed units (unused collection pages are released); any uncertain failure keeps the reservation as unknown_outcome for admin reconciliation.
      // Mock ledger rows are `demo` and never settle.
      if (o.state === 'succeeded') {
        const usedUnits = job.kind === 'note_enrichment' ? Number(o.result?.completed ?? 1)
          : job.kind === 'provider_search' && job.input_ref.targetCount !== undefined ? Number(o.result?.pages ?? 1) : null;
        await db.query(`select app.settle_usage($1, 'settled', (select case when $2::integer is null then l.reserved_amount
          else least(l.reserved_amount, l.reserved_amount * $2 / greatest(q.max_billable_units,1)) end
          from usage_ledger l join cost_quotes q on q.id=l.quote_id where l.id=$1))`, [job.reserved_usage_id,usedUnits]);
      } else if (o.state === 'failed' && o.sent === false) {
        // Release only when no earlier step of this batch reached the provider.
        const progress = (await db.query(`select result_ref from app_jobs where id=$1`,[job.id])).rows[0]?.result_ref;
        const previouslySent = Number(progress?.pages ?? progress?.completed ?? 0) > 0;
        await db.query(`select app.settle_usage($1, $2)`, [job.reserved_usage_id, previouslySent ? 'unknown_outcome' : 'released']);
      } else {
        await db.query(`select app.settle_usage($1, 'unknown_outcome')`, [job.reserved_usage_id]);
      }
    }
  });
}

async function dispatch(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  switch (job.kind) {
    case 'provider_search': return providerSearch(deps, job);
    case 'reference_analysis': return referenceAnalysis(deps, job);
    case 'transcript_submit': return transcriptSubmit(deps, job);
    case 'transcript_result': return transcriptResult(deps, job);
    case 'plan_generation': return planGeneration(deps, job);
    case 'contextual_check': return contextualCheck(deps, job);
    case 'results_reflection': return resultsReflection(deps, job);
    case 'user_deletion': {
      const { deletionRequestId } = job.input_ref as { deletionRequestId: string };
      const summary = await deps.service((db) => processDeletion(db, deps.storage ?? null, deletionRequestId));
      return { state: 'succeeded', result: summary };
    }
    default: return { state: 'failed', errorCode: 'job_kind_not_implemented' };
  }
}

async function providerSearch(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const input = job.input_ref as { query?: string; topic?: string; days?: 7 | 14 | 30; targetCount?: number };
  const target = input.targetCount === undefined ? null : CollectionTarget.parse(input.targetCount);
  const progress = (job.result_ref ?? { pages: 0, noteIds: [], fingerprints: [] }) as { pages: number; noteIds: string[]; fingerprints: string[]; stopReason?: string };
  if (target && progress.stopReason) return { state: 'succeeded', result: progress };
  if (target && progress.pages >= collectionPages(target)) throw new Error('COLLECTION_PROGRESS_INVALID');
  if (target && job.data_mode === 'live') await deps.service(db => db.query(`update app_jobs set provider_task_id='search-page-started' where id=$1`,[job.id]));
  const result = await deps.provider.searchNotes({ query: input.query ?? '', ...(input.topic ? { topic: input.topic as never } : {}), ...(input.days ? { days: input.days } : {}), ...(target ? { offset: progress.pages * 20 } : {}) });
  return deps.service(async db => {
    const { runId, noteIds } = await ingestSearchResult(db, { orgId: job.org_id, provider: result.mode === 'mock' ? 'mock' : 'redfox', endpoint: result.endpoint, query: { ...input, jobId: job.id }, permissionId: null }, result);
    if (!target) return { state: 'succeeded', result: { ingestionRunId: runId, notes: noteIds.length } };
    const matchingIds = input.topic ? (await db.query<{ id: string }>(`select n.id from notes n
      where n.org_id=$1 and n.id=any($2::uuid[]) and exists (
        select 1 from note_taxonomy nt join taxonomy_terms t on t.id=nt.taxonomy_id
        where nt.note_id=n.id and t.kind='topic' and t.slug=$3)`, [job.org_id,noteIds,input.topic])).rows.map(n=>n.id) : noteIds;
    const next = { ...advanceCollection(progress, matchingIds, result.mode === 'mock' ? { rawCount: result.notes.length, hasMore: false } : result.coverage, target),
      fetchedNoteIds: [...new Set([...(Array.isArray(job.result_ref?.fetchedNoteIds) ? job.result_ref.fetchedNoteIds as string[] : progress.noteIds), ...noteIds])] };
    await db.query(`update app_jobs set provider_task_id=null,result_ref=$2 where id=$1`,[job.id,next]);
    return next.stopReason ? { state: 'succeeded', result: next } : { state: 'waiting_external', retryInMs: 100 };
  });
}

async function enrichNote(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const ids = enrichmentIds(job.input_ref);
  const completed = Number(job.result_ref?.completed ?? 0);
  if (completed === ids.length) return {state:'succeeded',result:job.result_ref ?? {completed}};
  if (job.data_mode === 'mock') return {state:'succeeded',result:{demo:true,completed:ids.length,total:ids.length}};
  if (!deps.env || !deps.apifyDetailProvider) return {state:'failed',errorCode:'APIFY_NOT_CONFIGURED',sent:false};
  const options = await deps.service(db=>enrichmentOptions(db,job,deps.env!,completed));
  const provider = deps.apifyDetailProvider(options);
  provider.assertReady(options.platformNoteId);
  // One note per lease; persist before POST and commit the result + checkpoint together.
  await deps.service(db=>db.query(`update app_jobs set provider_task_id='apify-submission-started' where id=$1`,[job.id]));
  try {
    const note = await provider.noteDetail({platformNoteId:options.platformNoteId});
    const result = {completed:completed+1,total:ids.length,provider:'apify',covers:Number(job.result_ref?.covers ?? 0)+(note.coverUrl?1:0)};
    await deps.service(async db => {
      await storeEnrichment(db,job.org_id,options.noteId,note,{permissionId:options.permissionId,ttl:options.ttl,build:options.build,jobId:job.id});
      await db.query(`update app_jobs set provider_task_id=null,result_ref=$2 where id=$1`,[job.id,result]);
    });
    return result.completed === ids.length ? {state:'succeeded',result} : {state:'waiting_external',retryInMs:100};
  } catch {
    return {state:'unknown_outcome',errorCode:'APIFY_RESULT_NEEDS_REVIEW'};
  }
}

async function referenceAnalysis(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const { referenceId } = job.input_ref as { referenceId: string };
  return deps.service(async (db) => {
    const ref = (await db.query(
      `select r.*, n.title as note_title, n.body_excerpt, n.provider_tags, n.note_type from reference_items r left join notes n on n.id = r.note_id
       where r.id = $1 and r.org_id = $2 and r.owner_user_id = $3 and r.deleted_at is null`, [referenceId, job.org_id, job.owner_user_id],
    )).rows[0];
    if (!ref) return { state: 'failed', errorCode: 'reference_unavailable' } as const;
    const run = (await db.query(`select id from transcript_runs where reference_id = $1 and status = 'succeeded' limit 1`, [referenceId])).rows[0];
    const segments = run
      ? (await db.query(`select seq, start_ms, end_ms, coalesce(text_seg, excerpt) as text from transcript_segments where run_id = $1 order by seq`, [run.id])).rows
          .map((s) => ({ seq: s.seq, startMs: s.start_ms, endMs: s.end_ms, text: s.text ?? '' }))
      : null;
    const input = {
      title: ref.note_title ?? ref.title, body: ref.body_excerpt, tags: ref.provider_tags ?? ref.tags ?? [], userText: ref.user_text,
      userMemo: ref.user_memo, noteType: ref.note_type, transcript: segments,
    };
    const output = analyzeReference(input);
    const id = (await db.query<{ id: string }>(
      `insert into analyses (org_id, owner_user_id, target_type, target_id, input_hash, analysis_scope, schema_version, prompt_version, model, data_mode, output_json, status)
       values ($1, $2, 'reference', $3, $4, $5, 'reference-analysis-v1', 'mock-rules-v1', null, $6, $7, 'succeeded') returning id`,
      [job.org_id, job.owner_user_id, referenceId, contentHash(input), output.analysisScope, job.data_mode, output],
    )).rows[0]!.id;
    await db.query(`update reference_items set analysis_scope = $2 where id = $1`, [referenceId, output.analysisScope]);
    return { state: 'succeeded', result: { analysisId: id } } as const;
  });
}

async function transcriptSubmit(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const { referenceId, noteId } = job.input_ref as { referenceId: string; noteId: string };
  const prep = await deps.service(async (db) => {
    const note = (await db.query(
      `select n.id, n.platform_note_id, n.canonical_url, n.note_type from reference_items r join notes n on n.id = r.note_id
       where r.id = $1 and r.org_id = $2 and r.owner_user_id = $3 and r.deleted_at is null and n.id = $4`, [referenceId, job.org_id, job.owner_user_id, noteId],
    )).rows[0];
    if (!note) return null;
    const runId = (await db.query<{ id: string }>(
      `insert into transcript_runs (org_id, owner_user_id, reference_id, note_id, data_mode, provider, job_id, status, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'queued', now() + interval '30 days') returning id`,
      [job.org_id, job.owner_user_id, referenceId, noteId, job.data_mode, job.data_mode === 'mock' ? 'mock' : 'redfox', job.id],
    )).rows[0]!.id;
    return { runId, note };
  });
  if (!prep) return { state: 'failed', errorCode: 'reference_unavailable', sent: false };
  if (prep.note.note_type !== 'video') {
    await deps.service((db) => db.query(`update transcript_runs set status = 'failed', fail_code = 'not_video' where id = $1`, [prep.runId]));
    return { state: 'failed', errorCode: 'not_video', sent: false };
  }
  let taskId: string;
  try {
    // Mock: the canonical URL stands in for the access URL. Live access URLs are supplied per request and never stored.
    taskId = (await deps.provider.submitTranscript({ platformNoteId: prep.note.platform_note_id, accessUrl: prep.note.canonical_url })).taskId;
  } catch (e) {
    if (isUnchargedError(e)) {
      await deps.service((db) => db.query(`update transcript_runs set status = 'failed', fail_code = $2 where id = $1`,
        [prep.runId, e instanceof LiveCallBlockedError ? 'permission_revoked' : e instanceof ProviderHttpError ? 'provider_failed' : 'unknown']));
      return { state: 'failed', errorCode: redactString(e instanceof Error ? e.message : 'blocked').slice(0, 200), sent: false };
    }
    // RF13 submit is not idempotent: if we cannot tell whether it ran, never resend (spec 9.4).
    await deps.service((db) => db.query(`update transcript_runs set status = 'unknown_outcome' where id = $1`, [prep.runId]));
    return { state: 'unknown_outcome', errorCode: redactString(e instanceof Error ? e.name : 'submit_error') };
  }
  await deps.service(async (db) => {
    await db.query(`update transcript_runs set status = 'submitted', provider_task_id = $2 where id = $1`, [prep.runId, taskId]);
    await db.query(
      `insert into app_jobs (org_id, owner_user_id, kind, data_mode, input_ref, dedupe_key, visible_after, provider_task_id)
       values ($1, $2, 'transcript_result', $3, $4, $5, now() + make_interval(secs => $6::double precision / 1000), $7)`,
      [job.org_id, job.owner_user_id, job.data_mode, { runId: prep.runId, taskId }, `transcript_result:${prep.runId}`, deps.pollBaseMs ?? 30_000, taskId],
    );
  });
  return { state: 'succeeded', result: { transcriptRunId: prep.runId } };
}

async function transcriptResult(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const { runId, taskId } = job.input_ref as { runId: string; taskId: string };
  const run = await deps.service(async (db) => (await db.query(`select id, created_at, status from transcript_runs where id = $1 and org_id = $2`, [runId, job.org_id])).rows[0]);
  if (!run) return { state: 'failed', errorCode: 'transcript_run_deleted' };
  const failRun = (code: string) => deps.service((db) => db.query(`update transcript_runs set status = 'failed', fail_code = $2 where id = $1`, [runId, code]));
  // Live polls were reserved up front (MAX_TRANSCRIPT_POLLS); never poll beyond what was paid for.
  if (job.data_mode === 'live' && job.attempts > MAX_TRANSCRIPT_POLLS) {
    await failRun('unknown');
    return { state: 'failed', errorCode: 'transcript_poll_limit_needs_review' };
  }
  let result: Awaited<ReturnType<XhsDataProvider['transcriptResult']>>;
  try {
    result = await deps.provider.transcriptResult({ taskId });
  } catch (e) {
    if (e instanceof LiveCallBlockedError) { await failRun('permission_revoked'); return { state: 'failed', errorCode: 'live_blocked', sent: false }; }
    if (e instanceof ProviderContractError) { await failRun('unknown'); return { state: 'failed', errorCode: 'contract_violation' }; }
    // Result polling is a read: transient provider/network errors retry with backoff.
    const base = deps.pollBaseMs ?? 30_000;
    return { state: 'waiting_external', retryInMs: Math.min(base * 2 ** Math.max(0, job.attempts - 1), 600_000) };
  }
  if (result.status === 'processing') {
    const age = (deps.now?.() ?? new Date()).getTime() - new Date(run.created_at).getTime();
    if (age > MAX_TRANSCRIPT_WAIT_MS) {
      await deps.service((db) => db.query(`update transcript_runs set status = 'failed', fail_code = 'unknown' where id = $1`, [runId]));
      return { state: 'failed', errorCode: 'transcript_timeout_needs_review' };
    }
    await deps.service((db) => storeTranscriptResult(db, runId, result, { storeFullText: false }));
    const base = deps.pollBaseMs ?? 30_000;
    return { state: 'waiting_external', retryInMs: Math.min(base * 2 ** Math.max(0, job.attempts - 1), 600_000) };
  }
  const permission = job.data_mode === 'live'
    ? await deps.service(async (db) => (await db.query(`select allow_cache, allow_excerpt_display from provider_permissions where org_id = $1 and provider = 'redfox' and status = 'approved' and (expires_at is null or expires_at > now()) limit 1`, [job.org_id])).rows[0] ?? null)
    : null;
  await deps.service((db) => storeTranscriptResult(db, runId, result, transcriptStoragePolicy(job.data_mode, permission)));
  return result.status === 'succeeded' ? { state: 'succeeded', result: { segments: result.segments.length } } : { state: 'failed', errorCode: result.failCode };
}

async function planGeneration(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const { planId } = job.input_ref as { planId: string };
  return deps.service(async (db) => {
    const plan = (await db.query(
      `select p.*, a.current_profile_version_id, v.profile_json from plans p join creator_accounts a on a.id = p.account_id
       join account_profile_versions v on v.id = a.current_profile_version_id
       where p.id = $1 and p.org_id = $2 and p.owner_user_id = $3 and p.deleted_at is null`, [planId, job.org_id, job.owner_user_id],
    )).rows[0];
    if (!plan) return { state: 'failed', errorCode: 'plan_unavailable' } as const;
    const draft = PlanDraft.parse(plan.draft_json);
    const refIds: string[] = Array.isArray(plan.draft_json?.sourceRefs) ? plan.draft_json.sourceRefs : [];
    const refs = refIds.length
      ? (await db.query(`select r.id, coalesce(r.title, n.title) as title, coalesce(n.provider_tags, r.tags) as tags from reference_items r left join notes n on n.id = r.note_id
           where r.id = any($1::uuid[]) and r.owner_user_id = $2 and r.deleted_at is null`, [refIds, job.owner_user_id])).rows
      : [];
    const output = generatePlan({ facts: draft.facts, profile: plan.profile_json, references: refs.map((r) => ({ id: r.id, title: r.title, tags: r.tags ?? [] })) });
    let proposalId: string | null = null;
    if (output.kind === 'proposal') {
      const content = PlanContent.parse(output.content);
      if (findInventedNumbers(content, FactSheet.parse(draft.facts)).length) return { state: 'failed', errorCode: 'output_validation_failed' } as const;
      // Evidence ids must come from the inputs (spec 5.4).
      if (output.evidenceRefs.some((id) => !refIds.includes(id))) return { state: 'failed', errorCode: 'output_validation_failed' } as const;
      proposalId = await insertProposalVersion(db, { orgId: job.org_id, planId, ownerId: job.owner_user_id!, content, facts: draft.facts, sourceRefs: refIds, profileVersionId: plan.current_profile_version_id, jobId: job.id });
    }
    await db.query(
      `insert into analyses (org_id, owner_user_id, target_type, target_id, input_hash, analysis_scope, schema_version, prompt_version, model, data_mode, output_json, status)
       values ($1, $2, 'plan_version', $3, $4, '{user_notes_only}', 'plan-generation-v1', 'mock-template-v1', null, $5, $6, 'succeeded')`,
      [job.org_id, job.owner_user_id, proposalId ?? plan.current_version_id, contentHash(draft), job.data_mode, { planId, output }],
    );
    return { state: 'succeeded', result: { kind: output.kind, proposalVersionId: proposalId } } as const;
  });
}

async function contextualCheck(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const { checkRunId } = job.input_ref as { checkRunId: string };
  return deps.service(async (db) => {
    const run = (await db.query(
      `select r.id, v.content_json from check_runs r join plan_versions v on v.id = r.plan_version_id
       where r.id = $1 and r.org_id = $2 and r.owner_user_id = $3`, [checkRunId, job.org_id, job.owner_user_id],
    )).rows[0];
    if (!run) return { state: 'failed', errorCode: 'check_unavailable' } as const;
    const res = mockContextual(sectionsOf(PlanContent.parse(run.content_json)));
    if (!res.ok) {
      // Rule results stay valid; the run remains partial with the AI layer marked failed (spec F09).
      await db.query(`update check_runs set status = 'partial', completeness_json = completeness_json || '{"contextual":"failed"}' where id = $1`, [checkRunId]);
      return { state: 'failed', errorCode: 'contextual_failed' } as const;
    }
    for (const f of res.findings) {
      await db.query(
        `insert into check_findings (check_run_id, field_key, start_utf16, end_utf16, finding_type, severity, confidence, rule_id, anchored, finding_json)
         values ($1, 'document', null, null, $2, $3, $4, null, false, $5)`, [checkRunId, f.type, f.severity, f.confidence, f],
      );
    }
    await db.query(`update check_runs set status = 'completed', completeness_json = completeness_json || '{"contextual":"completed"}' where id = $1`, [checkRunId]);
    return { state: 'succeeded', result: { findings: res.findings.length } } as const;
  });
}

async function resultsReflection(deps: JobDeps, job: JobRow): Promise<JobOutcome> {
  const { accountId, snapshotIds } = job.input_ref as { accountId: string; snapshotIds: string[] };
  return deps.service(async (db) => {
    // Only the owner's snapshots for that account (re-checked at run time).
    const rows = (await db.query(
      `select s.id, s.values_json, p.title, p.topic, p.format, p.paid_promotion from result_snapshots s join publication_records p on p.id = s.publication_id
       where s.id = any($1::uuid[]) and p.owner_user_id = $2 and p.account_id = $3 and p.org_id = $4`, [snapshotIds, job.owner_user_id, accountId, job.org_id],
    )).rows;
    if (rows.length !== snapshotIds.length) return { state: 'failed', errorCode: 'snapshots_unavailable' } as const;
    const output = reflect(rows.map((r) => ({ title: r.title, topic: r.topic, format: r.format, metrics: r.values_json as ResultMetrics, paid: r.paid_promotion })), snapshotIds);
    await db.query(
      `insert into analyses (org_id, owner_user_id, target_type, target_id, input_hash, analysis_scope, schema_version, prompt_version, model, data_mode, output_json, status)
       values ($1, $2, 'result_set', $3, $4, '{user_notes_only}', 'results-reflection-v1', 'mock-rules-v1', null, $5, $6, 'succeeded')`,
      [job.org_id, job.owner_user_id, accountId, contentHash(snapshotIds.slice().sort()), job.data_mode, output],
    );
    return { state: 'succeeded', result: { posts: rows.length } } as const;
  });
}
