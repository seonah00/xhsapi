import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  approvePermission, cancelJob, createPermission, createQuote, listAudit, listOrgJobs, LocalPrivateStorage, orgOps, providerOverview, reconcileUsage,
  reserveJob, revokePermission, runJob, setDailyLimits, setFeatureSwitches, setMonthlyBudget, setProviderSwitches, uploadAsset, usageSummary,
  type Ctx, type Runner,
} from '@xhs/core';
import { MockXhsProvider } from '@xhs/providers';
import { ORG2, pool, U } from './db.ts';

// Mutating org settings/budgets: use the isolation org so other files keep their assumptions about ORG1.
const ORG = ORG2;
const ADMIN = U.admin2;
const STUDENT = U.studentC;

const service: Runner = async (fn) => { const c = await pool.connect(); try { await c.query('begin'); const o = await fn(c); await c.query('commit'); return o; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } };
async function as<T>(uid: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const role = (await c.query(`select role from memberships where org_id = $1 and user_id = $2`, [ORG, uid])).rows[0]?.role ?? 'student';
    const out = await fn({ db: c, uid, orgId: ORG, role, mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const rev = async () => (await pool.query(`select revision from organizations where id = $1`, [ORG])).rows[0].revision as number;
afterAll(async () => {
  await pool.query(`update organizations set settings = (settings - 'feature_switches' - 'daily_limits' - 'provider_switches') || '{"provider_switches":{"live":false}}' where id = $1`, [ORG]);
  await pool.end();
});

describe('provider permissions', () => {
  it('lists the registry including the excluded video download', async () => {
    const o = await as(ADMIN, (ctx) => providerOverview(ctx));
    expect(o.capabilities.find((c) => c.endpoint === 'RFX1')).toMatchObject({ phase: 'excluded', paramsStatus: 'not_implemented' });
    expect(o.capabilities.every((c) => c.priceStatus === 'unknown')).toBe(true);
    await expect(as(STUDENT, (ctx) => providerOverview(ctx))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('new permissions are pending; approval needs an evidence file and confirmation; revocation is audited', async () => {
    const id = await as(ADMIN, (ctx) => createPermission(ctx, { provider: 'redfox', allowedEndpoints: ['RF13', 'RF14'], allowFetch: true, allowAiProcessing: true }));
    expect((await as(ADMIN, (ctx) => providerOverview(ctx))).permissions.find((p) => p.id === id)?.status).toBe('pending');
    await expect(as(ADMIN, (ctx) => createPermission(ctx, { provider: 'redfox', allowedEndpoints: ['RFX1'] }))).rejects.toThrow();
    const storage = new LocalPrivateStorage(await mkdtemp(join(tmpdir(), 'xhs-ev-')));
    const ev = await as(ADMIN, (ctx) => uploadAsset(ctx, storage, { bytes: new TextEncoder().encode('%PDF-1.4 agreement'), declaredMime: 'application/pdf', originalName: 'agreement.pdf', purpose: 'permission_evidence' }));
    await expect(as(ADMIN, (ctx) => approvePermission(ctx, id, { evidenceAssetId: ev.id, confirm: false }))).rejects.toThrow();
    await as(ADMIN, (ctx) => approvePermission(ctx, id, { evidenceAssetId: ev.id, confirm: true }));
    const p = (await as(ADMIN, (ctx) => providerOverview(ctx))).permissions.find((x) => x.id === id)!;
    expect(p).toMatchObject({ status: 'approved', evidenceName: 'agreement.pdf' });
    await as(ADMIN, (ctx) => revokePermission(ctx, id));
    const audit = await as(ADMIN, (ctx) => listAudit(ctx));
    expect(audit.items.filter((a) => a.action === 'provider_permissions.update').length).toBeGreaterThanOrEqual(2);
  });
});

describe('switches and limits', () => {
  it('feature switch blocks new quotes and queued jobs; stale revision is rejected', async () => {
    const r = await rev();
    await as(ADMIN, (ctx) => setFeatureSwitches(ctx, { ai: false, transcript: true, provider_search: true }, r));
    await expect(as(ADMIN, (ctx) => setFeatureSwitches(ctx, { ai: true }, r))).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await expect(as(STUDENT, (ctx) => createQuote(ctx, service, 'reference_analysis', { referenceId: 'x' }))).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    await as(ADMIN, async (ctx) => setFeatureSwitches(ctx, { ai: true }, await rev()));
    expect((await as(STUDENT, (ctx) => orgOps(ctx.db, ORG))).features.ai).toBe(true);
  });

  it('kill switch stops queued work at run time', async () => {
    const job = await as(STUDENT, async (ctx) => {
      const q = await createQuote(ctx, service, 'reference_analysis', { referenceId: 'kill-test' });
      return reserveJob(ctx, { quoteId: q.id, route: 'test kill', idempotencyKey: 'idem-kill-0001', operation: 'reference_analysis', scope: { referenceId: 'kill-test' }, jobKind: 'reference_analysis', dedupeKey: `k:${q.id}`, inputRef: { referenceId: '00000000-0000-4000-a000-000000000000' } });
    });
    await as(ADMIN, async (ctx) => setProviderSwitches(ctx, { live: false, kill: true }, await rev()));
    expect(await runJob({ service, provider: new MockXhsProvider() }, job.jobId, 't')).toMatchObject({ state: 'failed', errorCode: 'kill_switch' });
    await expect(as(STUDENT, (ctx) => createQuote(ctx, service, 'transcript_submit', {}))).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    await as(ADMIN, async (ctx) => setProviderSwitches(ctx, { live: false, kill: false }, await rev()));
  });

  it('daily limits are org-adjustable', async () => {
    await as(ADMIN, async (ctx) => setDailyLimits(ctx, { provider_search: 10, ai: 0, transcript: 5 }, await rev()));
    await expect(as(STUDENT, (ctx) => createQuote(ctx, service, 'plan_generation', { planId: 'x' }))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(as(ADMIN, async (ctx) => setDailyLimits(ctx, { ai: 1000 }, await rev()))).rejects.toThrow();
    await as(ADMIN, async (ctx) => setDailyLimits(ctx, { provider_search: 10, ai: 20, transcript: 5 }, await rev()));
  });
});

describe('usage and jobs', () => {
  it('separates demo usage, sets budgets with decimal strings, reconciles unknown outcomes with evidence', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const s = await as(ADMIN, (ctx) => usageSummary(ctx, month));
    expect(s.demo.every((r) => r.status === 'demo')).toBe(true);
    expect(s.real.some((r) => r.status === 'demo')).toBe(false);
    await as(ADMIN, (ctx) => setMonthlyBudget(ctx, { currency: 'CNY', amount: '12.50', month }));
    expect((await as(ADMIN, (ctx) => usageSummary(ctx, month))).budgets.find((b) => b.currency === 'CNY')?.limit).toBe('12.50000000');
    await expect(as(ADMIN, (ctx) => setMonthlyBudget(ctx, { currency: 'CNY', amount: '1e3', month }))).rejects.toThrow();

    // Simulate a reserved live call whose outcome is unknown.
    const ledger = (await pool.query(
      `insert into usage_ledger (org_id, user_id, request_id, provider, endpoint, currency, reserved_amount, status) values ($1, $2, gen_random_uuid(), 'redfox', 'RF13', 'CNY', 2, 'unknown_outcome') returning id`,
      [ORG, STUDENT],
    )).rows[0].id;
    await pool.query(`update usage_budgets set reserved_total = reserved_total + 2 where org_id = $1 and subject_type = 'org' and currency = 'CNY' and period_start <= now() and period_end > now()`, [ORG]);
    await expect(as(ADMIN, (ctx) => reconcileUsage(ctx, { ledgerId: ledger, outcome: 'settled', actualAmount: '1.5', evidence: 'x' }))).rejects.toThrow();
    await expect(as(STUDENT, (ctx) => reconcileUsage(ctx, { ledgerId: ledger, outcome: 'released', evidence: '공급자 콘솔 확인' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await as(ADMIN, (ctx) => reconcileUsage(ctx, { ledgerId: ledger, outcome: 'settled', actualAmount: '1.5', evidence: '공급자 콘솔 과금 내역 2026-10-05 확인' }));
    expect((await pool.query(`select status, actual_amount from usage_ledger where id = $1`, [ledger])).rows[0]).toEqual({ status: 'settled', actual_amount: '1.50000000' });
  });

  it('admins see jobs without payloads; owners or admins can cancel queued jobs', async () => {
    const job = await as(STUDENT, async (ctx) => {
      const q = await createQuote(ctx, service, 'reference_analysis', { referenceId: 'cancel-test' });
      return reserveJob(ctx, { quoteId: q.id, route: 'test cancel', idempotencyKey: 'idem-cancel-0001', operation: 'reference_analysis', scope: { referenceId: 'cancel-test' }, jobKind: 'reference_analysis', dedupeKey: `c:${q.id}`, inputRef: { referenceId: 'secret-ref' } });
    });
    const jobs = await as(ADMIN, (ctx) => listOrgJobs(ctx, { state: 'queued' }));
    expect(jobs.find((j) => j.id === job.jobId)).toBeTruthy();
    expect(JSON.stringify(jobs)).not.toContain('secret-ref');
    const other = '00000000-0000-4000-a000-0000000000dd';
    await pool.query(`insert into auth.users (id, email) values ($1, 'ops-other@demo.invalid') on conflict do nothing`, [other]);
    await pool.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'student') on conflict do nothing`, [ORG, other]);
    await expect(as(other, (ctx) => cancelJob(ctx, job.jobId))).rejects.toMatchObject({ code: 'CONFLICT' });
    await as(STUDENT, (ctx) => cancelJob(ctx, job.jobId));
    await expect(as(ADMIN, (ctx) => cancelJob(ctx, job.jobId))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
