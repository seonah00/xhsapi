import { afterAll, describe, expect, it } from 'vitest';
import { liveReadiness, type Ctx } from '@xhs/core';
import { loadEnv } from '@xhs/domain';
import { ORG1, pool, U } from './db.ts';

afterAll(async () => { await pool.end(); });

/** Runs as the org admin inside a transaction that is always rolled back. */
async function asAdminRolledBack<T>(setup: (c: import('pg').PoolClient) => Promise<void>, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await setup(c);
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.admin]);
    await c.query('set local role authenticated');
    return await fn({ db: c, uid: U.admin, orgId: ORG1, role: 'org_admin', mode: 'mock' });
  } finally {
    await c.query('rollback');
    c.release();
  }
}

describe('live readiness checklist (spec 6.3, read-only)', () => {
  it('shows every endpoint blocked with concrete reasons in the shipped state', async () => {
    const r = await asAdminRolledBack(async () => {}, (ctx) => liveReadiness(ctx, loadEnv({})));
    expect(r.rows).toHaveLength(14);
    expect(r.rows.every((x) => !x.ready)).toBe(true);
    const rf01 = r.rows.find((x) => x.endpoint === 'RF01')!;
    expect(rf01.reasons).toEqual(expect.arrayContaining(['mode_not_live', 'live_calls_disabled', 'org_switch_off', 'price_unknown']));
    expect(r.rows.find((x) => x.endpoint === 'RF08')!.reasons).toContain('parameter_unverified');
    expect(r.rows.find((x) => x.endpoint === 'RF14')!.reasons).toContain('feature_disabled');
  });

  it('reaches ready only when env, org switch, verified price and budget hold without permissions', async () => {
    const liveEnv = { ...loadEnv({}), APP_DATA_MODE: 'live' as const, LIVE_PROVIDER_CALLS_ENABLED: true };
    const r = await asAdminRolledBack(async (c) => {
      await c.query(`update organizations set settings = jsonb_set(coalesce(settings, '{}'), '{provider_switches}', '{"live": true, "kill": false}') where id = $1`, [ORG1]);
      await c.query(`update provider_capabilities set price_status = 'verified' where provider = 'redfox' and endpoint = 'RF01'`);
      await c.query(`delete from provider_permissions where org_id=$1`, [ORG1]);
      await c.query(`insert into usage_budgets (org_id, subject_type, subject_id, period_start, period_end, currency, amount_limit)
        values ($1, 'org', $1, current_date - 1, current_date + 30, 'USD', 10)`, [ORG1]);
    }, (ctx) => liveReadiness(ctx, liveEnv));
    expect(r.rows.find((x) => x.endpoint === 'RF01')).toMatchObject({ ready: true, reasons: [] });
    // Without any positive live budget the same endpoint is blocked again.
    const noBudget = await asAdminRolledBack(async (c) => {
      await c.query(`update organizations set settings = jsonb_set(coalesce(settings, '{}'), '{provider_switches}', '{"live": true, "kill": false}') where id = $1`, [ORG1]);
      await c.query(`delete from usage_budgets where org_id = $1 and subject_type = 'org' and not exists (select 1 from usage_ledger l where l.org_id = usage_budgets.org_id)`, [ORG1]);
      await c.query(`update usage_budgets set period_end = current_date where org_id = $1 and period_end > current_date`, [ORG1]);
    }, (ctx) => liveReadiness(ctx, liveEnv));
    expect(noBudget.rows.find((x) => x.endpoint === 'RF01')!.reasons).toContain('budget_zero');
    // Unknown price still blocks:
    expect(r.rows.find((x) => x.endpoint === 'RF02')!.reasons).toEqual(expect.arrayContaining(['price_unknown']));
    expect((await pool.query(`select price_status from provider_capabilities where provider = 'redfox' and endpoint = 'RF01'`)).rows[0].price_status).toBe('unknown');
  });

  it('is admin-only', async () => {
    await expect(asAdminRolledBack(async () => {}, (ctx) => liveReadiness({ ...ctx, role: 'reviewer' }, loadEnv({})))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
