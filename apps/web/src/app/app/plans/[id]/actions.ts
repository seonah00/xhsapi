'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  applyProposal, applySuggestion, archivePlan, createQuote, getPlan, markContextualRequested, reserveJob, restoreVersion, runCheck,
  setPlanStatus, submitPlan, withdrawSubmission,
} from '@xhs/core';
import { service, withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';

const uuid = z.string().uuid();
const path = (id: string, q = '') => `/app/plans/${id}${q}`;

export async function changeStatus(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  await orRedirectWithError(path(id), () => withPageCtx((ctx) => setPlanStatus(ctx, id, String(f.get('status')))));
  redirect(path(id));
}

export async function archive(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  await orRedirectWithError(path(id), () => withPageCtx((ctx) => archivePlan(ctx, id)));
  redirect('/app/plans');
}

export async function quoteGeneration(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  const q = await orRedirectWithError(path(id), () => withPageCtx((ctx) => createQuote(ctx, service, 'plan_generation', { planId: id })));
  redirect(path(id, `?confirm=generation&quote=${q.id}#ai`));
}

export async function confirmGeneration(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  const quoteId = uuid.parse(f.get('quoteId'));
  const scope = { planId: id };
  const { jobId } = await orRedirectWithError(path(id), () => withPageCtx((ctx) => reserveJob(ctx, {
    quoteId, route: 'POST /plans/:id/generations', idempotencyKey: uuid.parse(f.get('idem')), operation: 'plan_generation', scope,
    jobKind: 'plan_generation', dedupeKey: `plan_generation:${quoteId}`, inputRef: scope,
  })));
  redirect(path(id, `?job=${jobId}#ai`));
}

export async function apply(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  await orRedirectWithError(path(id), () => withPageCtx((ctx) => applyProposal(ctx, id, uuid.parse(f.get('versionId')), Number(f.get('revision')))));
  redirect(path(id, '?applied=1'));
}

export async function restore(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  await orRedirectWithError(path(id), () => withPageCtx((ctx) => restoreVersion(ctx, id, uuid.parse(f.get('versionId')), Number(f.get('revision')))));
  redirect(path(id, '?restored=1'));
}

export async function check(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  const versionId = uuid.parse(f.get('versionId'));
  const runId = await orRedirectWithError(path(id), () => withPageCtx((ctx) => runCheck(ctx, service, {}, { planId: id, versionId })));
  redirect(path(id, `?check=${runId}#check`));
}

export async function quoteContextual(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  const checkRunId = uuid.parse(f.get('checkRunId'));
  const q = await orRedirectWithError(path(id), () => withPageCtx((ctx) => createQuote(ctx, service, 'contextual_check', { checkRunId })));
  redirect(path(id, `?check=${checkRunId}&confirm=contextual&quote=${q.id}#check`));
}

export async function confirmContextual(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  const checkRunId = uuid.parse(f.get('checkRunId'));
  const quoteId = uuid.parse(f.get('quoteId'));
  const scope = { checkRunId };
  const { jobId } = await orRedirectWithError(path(id), () => withPageCtx(async (ctx) => {
    const r = await reserveJob(ctx, {
      quoteId, route: 'POST /checks/:id/contextual', idempotencyKey: uuid.parse(f.get('idem')), operation: 'contextual_check', scope,
      jobKind: 'contextual_check', dedupeKey: `contextual_check:${quoteId}`, inputRef: scope,
    });
    if (!r.replayed) await markContextualRequested(service, checkRunId);
    return r;
  }));
  redirect(path(id, `?check=${checkRunId}&job=${jobId}#check`));
}

export async function applyFix(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  const checkId = uuid.parse(f.get('checkRunId'));
  await orRedirectWithError(path(id, `?check=${checkId}`), () => withPageCtx(async (ctx) => {
    const plan = await getPlan(ctx, id);
    return applySuggestion(ctx, id, checkId, Number(f.get('index')), plan.revision);
  }));
  redirect(path(id, `?check=${checkId}&fixed=1#check`));
}

export async function submit(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  await orRedirectWithError(path(id, '#submit'), () => withPageCtx((ctx) => submitPlan(ctx, {
    planVersionId: String(f.get('versionId')), cohortId: String(f.get('cohortId')), checkRunId: String(f.get('checkRunId')),
    acknowledgeIncompleteCheck: f.get('ack') === 'on', assetIds: f.getAll('assetIds').map(String),
  })));
  redirect(path(id, '?submitted=1#submit'));
}

export async function withdraw(f: FormData) {
  const id = uuid.parse(f.get('planId'));
  await orRedirectWithError(path(id, '#submit'), () => withPageCtx((ctx) => withdrawSubmission(ctx, uuid.parse(f.get('submissionId')))));
  redirect(path(id, '?withdrawn=1#submit'));
}
