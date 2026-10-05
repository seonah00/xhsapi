import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAccount, createQuote, createReference, discover, explainSentence, getReference, getTranscript, ingestSearchResult,
  listExpressions, listKeywords, recommend, reserveJob, runJob, savePersonalExpression, trashReference, updateReference,
  assertTranscriptAllowed, listReferences, getAccount, updateAccountProfile, type Ctx, type Runner,
} from '@xhs/core';
import { AppError } from '@xhs/domain';
import { MockXhsProvider, mockFixtures } from '@xhs/providers';
import { ORG1, ORG2, pool, U } from './db.ts';

const service: Runner = async (fn) => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
};

async function as<T>(uid: string, orgId: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await c.query('set local role authenticated');
    const role = (await c.query(`select role from memberships where org_id = $1 and user_id = $2`, [orgId, uid])).rows[0]?.role ?? 'student';
    const out = await fn({ db: c, uid, orgId, role, mode: 'mock' });
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const now = new Date();
const provider = new MockXhsProvider({ now: () => now, transcriptPollsUntilDone: 1, transcriptProcessingMs: 0 });
const deps = { service, provider, pollBaseMs: 0 };
const noteIdByPlatform = new Map<string, string>();

async function drainJobs() {
  for (let i = 0; i < 10; i++) {
    const ids = (await pool.query(`select id from app_jobs where state in ('queued', 'waiting_external') and (visible_after is null or visible_after <= now()) order by created_at`)).rows.map((r) => r.id);
    if (!ids.length) return;
    for (const id of ids) await runJob(deps, id, 'test-worker');
  }
}

beforeAll(async () => {
  for (const orgId of [ORG1, ORG2]) {
    const result = await provider.searchNotes({ query: '' });
    // Make fixture dates recent so window filters include them.
    const shift = now.getTime() - 86_400_000 - Math.max(...result.notes.filter((n) => n.publishedAt).map((n) => Date.parse(n.publishedAt!)));
    for (const n of result.notes) if (n.publishedAt) n.publishedAt = new Date(Date.parse(n.publishedAt) + shift).toISOString();
    await service((db) => ingestSearchResult(db, { orgId, provider: 'mock', endpoint: result.endpoint, query: { seed: true } }, result));
  }
  for (const r of (await pool.query(`select id, platform_note_id from notes where org_id = $1 and provider = 'mock'`, [ORG1])).rows) noteIdByPlatform.set(r.platform_note_id, r.id);
  await pool.query(
    `insert into expressions (org_id, expression, explanations_json, provenance, review_status) values ($1, '亲测', '{"meaning":"직접 써 봄","avoid":"써 보지 않은 제품"}', 'editorial', 'published')`, [ORG1],
  );
});

afterAll(async () => {
  await pool.end();
});

describe('discover (stored data only)', () => {
  it('expands a Korean query via the seed dictionary and shows the candidates', async () => {
    const r = await as(U.studentA, ORG1, (ctx) => discover(ctx, { q: '민감성 스킨케어' }));
    expect(r.expansion?.candidates.map((c) => c.text)).toEqual(expect.arrayContaining(['敏感肌', '护肤']));
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes.every((n) => n.topics.includes('beauty'))).toBe(true);
    expect(r.notes.every((n) => n.dataMode === 'mock')).toBe(true);
  });

  it('returns nothing (not popular fallbacks) when no candidate exists', async () => {
    const r = await as(U.studentA, ORG1, (ctx) => discover(ctx, { q: '양자역학' }));
    expect(r.notes).toEqual([]);
    expect(r.expansion?.unmatched).toEqual(['양자역학']);
    expect(r.latestHot.length).toBeGreaterThan(0); // shown separately only
  });

  it('never mixes fallback items into results and filters unknown dates out of date windows', async () => {
    const r = await as(U.studentA, ORG1, (ctx) => discover(ctx, { q: '', days: 30 }));
    const hot = new Set(r.latestHot.map((n) => n.id));
    expect(r.notes.some((n) => hot.has(n.id))).toBe(false);
    expect(r.notes.every((n) => n.publishedAt !== null)).toBe(true);
    expect(r.postFilters).toContain('published_within_days');
  });

  it('isolates organizations', async () => {
    const mine = await as(U.studentA, ORG1, (ctx) => discover(ctx, { q: '' }));
    const theirs = await as(U.studentC, ORG2, (ctx) => discover(ctx, { q: '' }));
    const ids = new Set(mine.notes.map((n) => n.id));
    expect(theirs.notes.some((n) => ids.has(n.id))).toBe(false);
  });
});

describe('recommendations', () => {
  it('returns up to 6 picks that match the profile, with reasons from codes', async () => {
    const r = await as(U.studentA, ORG1, (ctx) => recommend(ctx, {
      displayName: 'x', topics: ['beauty'], mainTopic: 'beauty', subTopics: [], audience: 'x', goals: ['grow_followers'], tone: 'friendly',
      formats: ['routine'], chineseLevel: 'beginner', showFace: true, useVoice: true, avoidTopics: ['唇釉'],
    }));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.length).toBeLessThanOrEqual(6);
    for (const it of r.items) {
      expect(it.note.topics).toContain('beauty');
      expect(it.note.title ?? '').not.toContain('唇釉');
      expect(it.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe('accounts', () => {
  it('validates the onboarding profile and versions edits', async () => {
    // reviewerOther owns no accounts in any other test file (file order is not guaranteed).
    await expect(as(U.reviewerOther, ORG1, (ctx) => createAccount(ctx, { displayName: '' }))).rejects.toThrow();
    await expect(as(U.reviewerOther, ORG1, (ctx) => createAccount(ctx, {
      displayName: 'x', topics: ['beauty'], mainTopic: 'fashion', audience: 'x', goals: ['record_life'], tone: 'plain', formats: ['vlog'], chineseLevel: 'beginner', showFace: false, useVoice: false,
    }))).rejects.toThrow(/주력 주제/);
    const id = await as(U.reviewerOther, ORG1, (ctx) => createAccount(ctx, {
      displayName: '맛집 계정', topics: ['food-places'], mainTopic: 'food-places', audience: '서울 여행 오는 중국인', goals: ['record_life'],
      tone: 'plain', formats: ['vlog'], chineseLevel: 'beginner', showFace: false, useVoice: true,
    }));
    const acc = await as(U.reviewerOther, ORG1, (ctx) => getAccount(ctx, id));
    expect(acc.profile_version).toBe(1);
    const v2 = await as(U.reviewerOther, ORG1, (ctx) => updateAccountProfile(ctx, id, { ...acc.profile, audience: '바뀐 독자' }, acc.revision));
    expect(v2).toBe(2);
    await expect(as(U.reviewerOther, ORG1, (ctx) => updateAccountProfile(ctx, id, acc.profile, acc.revision))).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await expect(as(U.studentA, ORG1, (ctx) => getAccount(ctx, id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('references', () => {
  it('stores Xiaohongshu URLs without access tokens and rejects unsafe schemes', async () => {
    const id = await as(U.studentA, ORG1, (ctx) => createReference(ctx, {
      sourceType: 'manual_url', url: 'https://www.xiaohongshu.com/explore/6a3c7aa6000000001003e071?xsec_token=SECRET&xsec_source=pc_feed', memo: '도입부 참고',
    }));
    const ref = await as(U.studentA, ORG1, (ctx) => getReference(ctx, id));
    expect(ref.manualUrl).toBe('https://www.xiaohongshu.com/explore/6a3c7aa6000000001003e071');
    await expect(as(U.studentA, ORG1, (ctx) => createReference(ctx, { sourceType: 'manual_url', url: 'javascript:alert(1)' }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED', messageKo: expect.stringContaining('http(s)') });
  });

  it('is private: other students get NOT_FOUND', async () => {
    const id = await as(U.studentA, ORG1, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: '내 비공개 메모 텍스트' }));
    await expect(as(U.studentB, ORG1, (ctx) => getReference(ctx, id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await as(U.studentB, ORG1, (ctx) => listReferences(ctx))).some((r) => r.id === id)).toBe(false);
  });

  it('uses revisions and supports trash/restore', async () => {
    const id = await as(U.studentA, ORG1, (ctx) => createReference(ctx, { sourceType: 'pasted_text', text: '텍스트' }));
    const rev = await as(U.studentA, ORG1, (ctx) => updateReference(ctx, id, { favorite: true, revision: 1 }));
    expect(rev).toBe(2);
    await expect(as(U.studentA, ORG1, (ctx) => updateReference(ctx, id, { favorite: false, revision: 1 }))).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await as(U.studentA, ORG1, (ctx) => trashReference(ctx, id, true));
    expect((await as(U.studentA, ORG1, (ctx) => listReferences(ctx, { trash: true }))).some((r) => r.id === id)).toBe(true);
    await as(U.studentA, ORG1, (ctx) => trashReference(ctx, id, false));
    expect((await as(U.studentA, ORG1, (ctx) => getReference(ctx, id))).deletedAt).toBeNull();
  });
});

describe('F15 transcript (mock end to end)', () => {
  const video = mockFixtures.MOCK_NOTES.find((n) => n.platformNoteId.startsWith('de0100'))!; // contains a phone number + injection text
  const image = mockFixtures.MOCK_NOTES.find((n) => n.noteType === 'image')!;
  const route = 'POST /references/:id/transcript-jobs';

  async function request(uid: string, refId: string, key: string) {
    return as(uid, ORG1, async (ctx) => {
      const { noteId } = await assertTranscriptAllowed(ctx, refId);
      const scope = { referenceId: refId, noteId };
      const quote = await createQuote(ctx, service, 'transcript_submit', scope);
      return reserveJob(ctx, { quoteId: quote.id, route, idempotencyKey: key, operation: 'transcript_submit', scope, jobKind: 'transcript_submit', dedupeKey: `transcript_submit:${quote.id}`, inputRef: scope });
    });
  }

  it('submits, polls and stores masked segments for the owner only', async () => {
    const refId = await as(U.studentA, ORG1, (ctx) => createReference(ctx, { sourceType: 'saved_note', noteId: noteIdByPlatform.get(video.platformNoteId)! }));
    const { jobId, replayed } = await request(U.studentA, refId, 'idem-transcript-0001');
    expect(replayed).toBe(false);
    await drainJobs();

    const t = await as(U.studentA, ORG1, (ctx) => getTranscript(ctx, refId));
    expect(t?.status).toBe('succeeded');
    expect(t?.dataMode).toBe('mock');
    expect(t!.segments.length).toBe(5);
    const all = t!.segments.map((s) => s.text).join('');
    expect(all).not.toContain('13812345678');
    expect(t!.segments.some((s) => s.masked)).toBe(true);
    for (const s of t!.segments) expect([...(s.excerpt ?? '')].length).toBeLessThanOrEqual(40);

    // The provider task id never contains xsec tokens, and job input has no raw URL.
    const job = (await pool.query(`select input_ref from app_jobs where id = $1`, [jobId])).rows[0];
    expect(JSON.stringify(job.input_ref)).not.toMatch(/xsec|http/);

    await expect(as(U.studentB, ORG1, (ctx) => getTranscript(ctx, refId))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const ledger = (await pool.query(`select status, reserved_amount from usage_ledger where job_id = $1`, [jobId])).rows[0];
    expect(ledger).toEqual({ status: 'demo', reserved_amount: '0.00000000' });
  });

  it('rejects image notes before issuing a quote', async () => {
    const refId = await as(U.studentA, ORG1, (ctx) => createReference(ctx, { sourceType: 'saved_note', noteId: noteIdByPlatform.get(image.platformNoteId)! }));
    await expect(request(U.studentA, refId, 'idem-transcript-0002')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', messageKo: expect.stringContaining('영상 노트가 아닙니다') });
  });

  it('reports no speech honestly', async () => {
    const noSpeech = mockFixtures.MOCK_NOTES.find((n) => n.platformNoteId.startsWith('de0200'))!;
    const refId = await as(U.studentA, ORG1, (ctx) => createReference(ctx, { sourceType: 'saved_note', noteId: noteIdByPlatform.get(noSpeech.platformNoteId)! }));
    await request(U.studentA, refId, 'idem-transcript-0003');
    await drainJobs();
    const t = await as(U.studentA, ORG1, (ctx) => getTranscript(ctx, refId));
    expect(t).toMatchObject({ status: 'no_speech', failCode: 'no_speech_detected', segments: [] });
  });

  it('enforces the daily limit of 5', async () => {
    await pool.query(
      `insert into app_jobs (org_id, owner_user_id, kind, data_mode, dedupe_key) select $1, $2, 'transcript_submit', 'mock', 'filler-' || g from generate_series(1, 5) g`,
      [ORG1, U.studentB],
    );
    const refId = await as(U.studentB, ORG1, (ctx) => createReference(ctx, { sourceType: 'saved_note', noteId: noteIdByPlatform.get(video.platformNoteId)! }));
    await expect(as(U.studentB, ORG1, (ctx) => createQuote(ctx, service, 'transcript_submit', { referenceId: refId }))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await pool.query(`update app_jobs set state = 'cancelled' where dedupe_key like 'filler-%'`);
  });

  it('feeds the analysis job: scope includes audio_transcript and limitations are stated', async () => {
    const refId = (await pool.query(`select reference_id from transcript_runs where status = 'succeeded' and owner_user_id = $1 limit 1`, [U.studentA])).rows[0].reference_id;
    await as(U.studentA, ORG1, async (ctx) => {
      const scope = { referenceId: refId };
      const q = await createQuote(ctx, service, 'reference_analysis', scope);
      return reserveJob(ctx, { quoteId: q.id, route: 'POST /references/:id/analyses', idempotencyKey: 'idem-analysis-0001', operation: 'reference_analysis', scope, jobKind: 'reference_analysis', dedupeKey: `analysis:${q.id}`, inputRef: scope });
    });
    await drainJobs();
    const a = (await pool.query(`select analysis_scope, output_json, data_mode from analyses where target_id = $1`, [refId])).rows[0];
    expect(a.analysis_scope).toContain('audio_transcript');
    expect(a.output_json.limitations).toContain('영상의 화면 구도·편집·장면 전환은 분석하지 않았습니다.');
    expect(a.data_mode).toBe('mock');
    expect(JSON.stringify(a.output_json)).not.toContain('13812345678');
  });
});

describe('keywords and expressions', () => {
  it('counts unique notes and authors within the stored sample, hashtags only', async () => {
    const k = await as(U.studentA, ORG1, (ctx) => listKeywords(ctx, { provenance: 'observed_tag' }));
    expect(k.sampleSize).toBeGreaterThan(0);
    for (const item of k.items) {
      expect(item.kind).toBe('hashtag');
      expect(item.uniqueNotes).toBeLessThanOrEqual(k.sampleSize);
      expect(item.uniqueAuthors).toBeLessThanOrEqual(item.uniqueNotes);
    }
  });

  it('keeps personal entries private and explains dictionary matches with UTF-16 offsets', async () => {
    const id = await as(U.studentA, ORG1, (ctx) => savePersonalExpression(ctx, { expression: '宝子们', meaningKo: '여러분' }));
    expect((await as(U.studentB, ORG1, (ctx) => listExpressions(ctx))).some((e) => e.id === id)).toBe(false);
    const mine = await as(U.studentA, ORG1, (ctx) => listExpressions(ctx, { scope: 'mine' }));
    expect(mine.find((e) => e.id === id)).toMatchObject({ personal: true, reviewStatus: 'draft' });

    const text = '😀亲测好用';
    const r = await as(U.studentA, ORG1, (ctx) => explainSentence(ctx, text));
    expect(r.aiUsed).toBe(false);
    expect(r.matches[0]).toMatchObject({ expression: '亲测', start: 2, end: 4 });
    expect(text.slice(r.matches[0]!.start, r.matches[0]!.end)).toBe('亲测');
  });
});
