import { afterAll, describe, expect, it } from 'vitest';
import { admin, asUser, hex64, ORG1, pool, U } from './db.ts';

afterAll(async () => {
  await pool.end();
});

async function quote(opts: { mode: 'mock' | 'live'; amount?: string; requestHash?: string; currency?: string; user?: string }) {
  return admin(async (c) => {
    let priceIds: string[] = [];
    if (opts.mode === 'live') {
      priceIds = [(await c.query(
        `insert into provider_price_versions (provider, endpoint, currency, unit, unit_cost, effective_at, verified_by, evidence)
         values ('redfox', 'RF13', $1, 'call', 1, now(), $2, 'test fixture') returning id`, [opts.currency ?? 'CNY', U.admin],
      )).rows[0].id];
    }
    return (await c.query(
      `insert into cost_quotes (org_id, owner_user_id, operation, request_hash, data_mode, max_billable_units, max_amount, currency, price_version_ids, scope_json)
       values ($1, $2, 'transcript_submit', $3, $4, 1, $5, $6, $7, '{"provider":"redfox","endpoint":"RF13"}') returning id`,
      [ORG1, opts.user ?? U.studentA, opts.requestHash ?? hex64('e'), opts.mode, opts.amount ?? '0', opts.currency ?? 'CNY', priceIds],
    )).rows[0].id as string;
  });
}

const reserve = (uid: string, q: string, key: string, reqHash = hex64('e'), dedupe = key) =>
  asUser(uid, async (c) => (await c.query(
    `select * from app.reserve_and_enqueue($1, $2, 'POST /test/reserve', $3, $4, 'rank_refresh', $5, '{"referenceId":"r1"}')`,
    [ORG1, q, key, reqHash, dedupe],
  )).rows[0] as { job_id: string; replayed: boolean });

describe('mock reservations are demo-only', () => {
  it('creates job + demo ledger, replays the same key without consuming again', async () => {
    const q = await quote({ mode: 'mock' });
    const first = await reserve(U.studentA, q, 'idem-key-mock-0001');
    expect(first.replayed).toBe(false);
    const again = await reserve(U.studentA, q, 'idem-key-mock-0001');
    expect(again).toEqual({ job_id: first.job_id, replayed: true });

    const ledger = await admin((c) => c.query('select status, reserved_amount from usage_ledger where job_id = $1', [first.job_id]));
    expect(ledger.rows).toEqual([{ status: 'demo', reserved_amount: '0.00000000' }]);
    const jobs = await admin((c) => c.query('select count(*)::int as n from app_jobs where id = $1', [first.job_id]));
    expect(jobs.rows[0].n).toBe(1);
  });

  it('same key with a different body is a conflict', async () => {
    const q = await quote({ mode: 'mock' });
    await reserve(U.studentA, q, 'idem-key-mock-0002');
    await expect(reserve(U.studentA, q, 'idem-key-mock-0002', hex64('f'))).rejects.toThrow(/IDEMPOTENCY_MISMATCH/);
  });

  it('a consumed quote cannot be reused by another request', async () => {
    const q = await quote({ mode: 'mock' });
    await reserve(U.studentA, q, 'idem-key-mock-0003');
    await expect(reserve(U.studentA, q, 'idem-key-mock-0004')).rejects.toThrow(/QUOTE_CONSUMED/);
  });

  it('another user cannot consume my quote', async () => {
    const q = await quote({ mode: 'mock' });
    await expect(reserve(U.studentB, q, 'idem-key-mock-0005')).rejects.toThrow(/QUOTE_INVALID/);
  });
});

describe('live budget gate', () => {
  it('blocks with the default zero budget', async () => {
    const q = await quote({ mode: 'live', amount: '1' });
    await expect(reserve(U.studentA, q, 'idem-key-live-0001')).rejects.toThrow(/BUDGET_EXCEEDED/);
    expect((await admin((c) => c.query('select consumed_at from cost_quotes where id = $1', [q]))).rows[0].consumed_at).toBeNull();
  });

  it('blocks when no org budget exists for the currency', async () => {
    const q = await quote({ mode: 'live', amount: '1', currency: 'USD' });
    await expect(reserve(U.studentA, q, 'idem-key-live-0002')).rejects.toThrow(/BUDGET_EXCEEDED/);
  });

  it('concurrent reservations cannot exceed the remaining budget', async () => {
    await admin((c) => c.query(`update usage_budgets set amount_limit = 10 where org_id = $1 and subject_type = 'org' and currency = 'CNY'`, [ORG1]));
    const [q1, q2] = await Promise.all([quote({ mode: 'live', amount: '6' }), quote({ mode: 'live', amount: '6', user: U.studentB })]);
    const results = await Promise.allSettled([
      reserve(U.studentA, q1, 'idem-key-conc-0001'),
      reserve(U.studentB, q2, 'idem-key-conc-0002'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/BUDGET_EXCEEDED/);
    const b = await admin((c) => c.query(`select reserved_total, settled_total from usage_budgets where org_id = $1 and subject_type = 'org' and currency = 'CNY'`, [ORG1]));
    expect(b.rows[0]).toEqual({ reserved_total: '6.00000000', settled_total: '0.00000000' });
  });

  it('settles actual cost, keeps reservation on unknown outcome', async () => {
    const ledger = (await admin((c) => c.query(`select id from usage_ledger where status = 'reserved' and org_id = $1 limit 1`, [ORG1]))).rows[0].id;
    await admin((c) => c.query(`select app.settle_usage($1, 'unknown_outcome')`, [ledger]));
    let b = (await admin((c) => c.query(`select reserved_total, settled_total from usage_budgets where org_id = $1 and subject_type = 'org' and currency = 'CNY'`, [ORG1]))).rows[0];
    expect(b).toEqual({ reserved_total: '6.00000000', settled_total: '0.00000000' });

    await expect(admin((c) => c.query(`select app.settle_usage($1, 'settled', 7)`, [ledger]))).rejects.toThrow(/within reservation/);
    await admin((c) => c.query(`select app.settle_usage($1, 'settled', 4.5)`, [ledger]));
    b = (await admin((c) => c.query(`select reserved_total, settled_total from usage_budgets where org_id = $1 and subject_type = 'org' and currency = 'CNY'`, [ORG1]))).rows[0];
    expect(b).toEqual({ reserved_total: '0.00000000', settled_total: '4.50000000' });
    await expect(admin((c) => c.query(`select app.settle_usage($1, 'released')`, [ledger]))).rejects.toThrow(/ALREADY_SETTLED/);
  });

  it('students cannot call settlement or read other users\' ledgers', async () => {
    await expect(asUser(U.studentA, (c) => c.query(`select app.settle_usage(gen_random_uuid(), 'released')`))).rejects.toThrow(/permission denied/);
    const theirs = await asUser(U.studentB, (c) => c.query(`select id from usage_ledger where user_id = $1`, [U.studentA]));
    expect(theirs.rows).toEqual([]);
  });
});

describe('worker claim', () => {
  it('only one of two concurrent claims wins', async () => {
    const q = await quote({ mode: 'mock' });
    const { job_id } = await reserve(U.studentA, q, 'idem-key-claim-0001');
    const claims = await Promise.all([
      admin((c) => c.query(`select app.claim_job($1, 'w1') as ok`, [job_id])),
      admin((c) => c.query(`select app.claim_job($1, 'w2') as ok`, [job_id])),
    ]);
    expect(claims.map((r) => r.rows[0].ok).filter(Boolean)).toHaveLength(1);
  });

  it('reclaims only after the lease expires', async () => {
    const q = await quote({ mode: 'mock' });
    const { job_id } = await reserve(U.studentA, q, 'idem-key-claim-0002');
    expect((await admin((c) => c.query(`select app.claim_job($1, 'w1', interval '1 hour') as ok`, [job_id]))).rows[0].ok).toBe(true);
    expect((await admin((c) => c.query(`select app.claim_job($1, 'w2') as ok`, [job_id]))).rows[0].ok).toBe(false);
    await admin((c) => c.query(`update app_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [job_id]));
    expect((await admin((c) => c.query(`select app.claim_job($1, 'w2') as ok`, [job_id]))).rows[0].ok).toBe(true);
  });
});
