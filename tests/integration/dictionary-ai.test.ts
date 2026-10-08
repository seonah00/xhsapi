import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../../packages/core/src/context.ts';
import {
  DICTIONARY_AI_MODEL,
  generateDictionaryAi,
  getDictionaryAiStatus,
  previewDictionaryAi,
  type DictionaryAiConfig,
  type DictionaryAiCtxRunner,
  type DictionaryAiInput,
} from '../../packages/core/src/dictionary-ai.ts';
import { admin, asUser, pool } from './db.ts';

const orgId = randomUUID();
const adminId = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const userC = randomUUID();
const userD = randomUUID();
const tagId = randomUUID();
const expressionId = randomUUID();
const config: DictionaryAiConfig = {
  enabled: true,
  apiKey: 'synthetic-key',
  sessionSecret: 'integration-only-session-secret-32-bytes',
  model: DICTIONARY_AI_MODEL,
  userDailyLimit: 3,
  globalMonthlyUsdLimit: 5,
};
const input: DictionaryAiInput = {
  entryIds: [tagId, expressionId],
  category: '뷰티',
  notes: '퇴근 후 10분 저녁 루틴',
  mode: 'record',
  tone: 'friendly',
  disclosure: 'none',
  experienceConfirmed: true,
};

function user<T>(uid: string, fn: (ctx: Ctx) => Promise<T>) {
  return asUser(uid, (db) => fn({ db, uid, orgId, role: 'student', mode: 'live' }));
}

function runner(uid: string): DictionaryAiCtxRunner {
  return (fn) => user(uid, fn);
}

function output() {
  return {
    titles: [
      { kind: '검색형', zh: '下班后10分钟晚间护肤记录', ko: '퇴근 후 10분 저녁 스킨케어 기록' },
      { kind: '친근형', zh: '忙完一天后的简单护理', ko: '바쁜 하루 뒤 간단한 관리' },
      { kind: '궁금증형', zh: '10分钟晚间护理怎么安排', ko: '10분 저녁 관리는 어떻게 할까' },
    ],
    bodyZh: '这是我下班后花10分钟完成的晚间护理记录。',
    bodyKo: '퇴근 후 10분 동안 한 저녁 스킨케어 기록입니다.',
    tags: ['敏感肌护理'],
    usedTerms: [],
    heldTerms: [{ term: '氛围感', reason: '구체적인 피부 관리 기록에는 억지스러워 보류했습니다.' }],
    blockers: [],
    warnings: [],
  };
}

function okFetch() {
  return vi.fn(async () => Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output()) }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
  }));
}

beforeAll(async () => {
  await admin(async (db) => {
    await db.query(`insert into auth.users(id,email) values
      ($1,$2),($3,$4),($5,$6),($7,$8),($9,$10)`, [
      adminId, `${adminId}@demo.invalid`, userA, `${userA}@demo.invalid`, userB, `${userB}@demo.invalid`,
      userC, `${userC}@demo.invalid`, userD, `${userD}@demo.invalid`,
    ]);
    await db.query(`insert into organizations(id,name,settings) values
      ($1,'dictionary ai integration','{"provider_switches":{"live":true,"kill":false},"feature_switches":{"ai":true}}')`, [orgId]);
    await db.query(`insert into memberships(org_id,user_id,role) values
      ($1,$2,'org_admin'),($1,$3,'student'),($1,$4,'student'),($1,$5,'student'),($1,$6,'student')`, [orgId, adminId, userA, userB, userC, userD]);
    await db.query(`insert into keywords
      (id,org_id,canonical_text,raw_text,kind,provenance,meaning_ko,topics,review_status,data_mode,shared_dictionary_key,shared_dictionary_meta)
      values ($1,$2,'敏感肌护理','敏感肌护理','hashtag','editorial_seed','민감성 피부 관리',array['뷰티'],'published','live','tag:fixture',
        '{"term":"#敏感肌护理","meaning":"민감성 피부 관리","type":"topic","categories":["뷰티"],"cautions":[],"groups":["피부"],"observedCount":10,"unknownTrendNote":null}')`, [tagId, orgId]);
    await db.query(`insert into expressions
      (id,org_id,owner_user_id,expression,explanations_json,tone,topics,expression_type,provenance,review_status,data_mode,shared_dictionary_key,shared_dictionary_meta)
      values ($1,$2,null,'氛围感','{}','friendly',array['뷰티'],'basic','editorial','published','live','expression:fixture',
        '{"term":"氛围感","meaning":"분위기 있는 느낌","type":"slang","categories":["뷰티"],"cautions":["억지로 쓰지 않기"],"groups":["톤"],"observedCount":null,"unknownTrendNote":null}')`, [expressionId, orgId]);
  });
});

afterAll(async () => {
  await pool.end();
});

describe('authenticated dictionary AI database flow', () => {
  it('generates through mock fetch, stores metadata only, and blocks replay before a second outbound call', async () => {
    const preview = await user(userA, (ctx) => previewDictionaryAi(ctx, input, config));
    const fetch = okFetch();
    const generated = await generateDictionaryAi(runner(userA), { token: preview.token, confirmed: true }, config, { fetch: fetch as typeof globalThis.fetch });
    expect(generated.result).toMatchObject({ source: 'ai', reviewRequired: true, tags: ['敏感肌护理'] });
    expect(generated.usage).toMatchObject({ totalTokenCount: 150, reservedMaxCostUsd: 0.06, estimatedNotActualInvoice: true });
    expect(fetch).toHaveBeenCalledTimes(1);

    const replay = await generateDictionaryAi(runner(userA), { token: preview.token, confirmed: true }, config, { fetch: fetch as typeof globalThis.fetch }).then(() => null, (error: unknown) => error);
    expect(replay).toMatchObject({ code: 'CONFLICT' });
    expect(fetch).toHaveBeenCalledTimes(1);

    const rows = await asUser(userA, (db) => db.query(`select outcome,model,reserved_max_cost_usd::text,prompt_token_count,total_token_count,
      to_jsonb(dictionary_ai_usage) ? 'prompt' as has_prompt, to_jsonb(dictionary_ai_usage) ? 'result' as has_result
      from dictionary_ai_usage where user_id=$1`, [userA]));
    expect(rows.rows).toEqual([{ outcome: 'succeeded', model: DICTIONARY_AI_MODEL, reserved_max_cost_usd: '0.060000', prompt_token_count: 100, total_token_count: 150, has_prompt: false, has_result: false }]);
  });

  it('retains the separately committed reservation after a provider failure', async () => {
    const preview = await user(userB, (ctx) => previewDictionaryAi(ctx, input, config));
    const fetch = vi.fn(async () => {
      // A separate connection can see the reservation before outbound work.
      const committed = await asUser(userB, (db) => db.query('select outcome from dictionary_ai_usage where user_id=$1', [userB]));
      expect(committed.rows).toEqual([{ outcome: 'reserved' }]);
      return new Response('do not expose this', { status: 503 });
    });
    const error = await generateDictionaryAi(runner(userB), { token: preview.token, confirmed: true }, config, { fetch: fetch as typeof globalThis.fetch }).then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const own = await asUser(userB, (db) => db.query(`select outcome,reserved_max_cost_usd::text from dictionary_ai_usage where user_id=$1`, [userB]));
    expect(own.rows).toEqual([{ outcome: 'failed', reserved_max_cost_usd: '0.060000' }]);
    const other = await asUser(userD, (db) => db.query(`select id from dictionary_ai_usage where user_id=$1`, [userB]));
    expect(other.rows).toEqual([]);
    const adminRows = await asUser(adminId, (db) => db.query(`select id from dictionary_ai_usage where org_id=$1`, [orgId]));
    expect(adminRows.rows).toEqual([]);
  });

  it('atomically permits one concurrent nonce reservation, then enforces three calls per KST day', async () => {
    const preview = await user(userC, (ctx) => previewDictionaryAi(ctx, input, config));
    const fetch = okFetch();
    const attempts = await Promise.allSettled([
      generateDictionaryAi(runner(userC), { token: preview.token, confirmed: true }, config, { fetch: fetch as typeof globalThis.fetch }),
      generateDictionaryAi(runner(userC), { token: preview.token, confirmed: true }, config, { fetch: fetch as typeof globalThis.fetch }),
    ]);
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    for (const nonce of ['a'.repeat(64), 'b'.repeat(64)]) {
      await asUser(userC, (db) => db.query('select * from app.reserve_dictionary_ai_usage($1,$2)', [orgId, nonce]));
    }
    const limited = await asUser(userC, async (db) => {
      try { await db.query('select * from app.reserve_dictionary_ai_usage($1,$2)', [orgId, 'c'.repeat(64)]); return null; }
      catch (error) { return error; }
    });
    expect(String(limited)).toContain('DICTIONARY_AI_DAILY_LIMIT');
    const status = await user(userC, (ctx) => getDictionaryAiStatus(ctx, config));
    expect(status).toMatchObject({ enabled: false, disabledReason: 'daily_limit', userDailyUsed: 3, userDailyRemaining: 0 });
  });

  it('keeps committed costs after a member leaves, without exposing their metadata', async () => {
    await admin((db) => db.query('delete from memberships where org_id=$1 and user_id=$2', [orgId, userB]));
    const retained = await admin((db) => db.query('select count(*)::int as n from dictionary_ai_usage where user_id=$1', [userB]));
    expect(retained.rows[0].n).toBe(1);
    const departed = await asUser(userB, (db) => db.query('select id from dictionary_ai_usage where user_id=$1', [userB]));
    expect(departed.rows).toEqual([]);
  });

  it('enforces the deployment-wide monthly USD cap without trusting caller limits or exposing rows', async () => {
    await admin((db) => db.query(`insert into dictionary_ai_usage(org_id,user_id,nonce_hash)
      select $1,$2,encode(sha256(convert_to('global-cap-fixture-' || n::text,'UTF8')),'hex')
      from generate_series(1,78) n`, [orgId, userA]));
    const blocked = await asUser(userD, async (db) => {
      try { await db.query('select * from app.reserve_dictionary_ai_usage($1,$2)', [orgId, 'd'.repeat(64)]); return null; }
      catch (error) { return error; }
    });
    expect(String(blocked)).toContain('DICTIONARY_AI_GLOBAL_CAP');
    const status = await user(userD, (ctx) => getDictionaryAiStatus(ctx, config));
    expect(status).toMatchObject({ enabled: false, disabledReason: 'global_cap', userDailyUsed: 0 });
  });
});
