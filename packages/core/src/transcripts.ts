import { AppError } from '@xhs/domain';
import { maskPersonalInfo } from '@xhs/security';
import type { TranscriptResult } from '@xhs/providers';
import { notFound, type Ctx, type Db } from './context.ts';
import { getReference } from './references.ts';

export const EXCERPT_MAX = 40;
export const EXCERPTS_PER_RUN = 10;

export type TranscriptView = {
  runId: string;
  status: string;
  failCode: string | null;
  dataMode: string;
  textStored: boolean;
  segments: { seq: number; startMs: number; endMs: number; text: string | null; excerpt: string | null; masked: boolean }[];
  createdAt: string;
  updatedAt: string;
};

/** Preconditions for F15 before any quote is issued. */
export async function assertTranscriptAllowed(ctx: Ctx, referenceId: string): Promise<{ noteId: string; platformNoteId: string }> {
  const ref = await getReference(ctx, referenceId);
  if (!ref.note) throw new AppError('VALIDATION_FAILED', '저장한 샤오홍슈 노트 레퍼런스에서만 음성 문안을 추출할 수 있습니다.');
  if (ref.note.noteType === null) throw new AppError('VALIDATION_FAILED', '영상인지 확인되지 않은 노트입니다(검색 결과에 형식 정보가 없음). 음성 문안을 추출할 수 없습니다.');
  if (ref.note.noteType !== 'video') throw new AppError('VALIDATION_FAILED', '영상 노트가 아닙니다. 이미지 노트는 음성 문안을 추출할 수 없습니다.');
  const busy = await ctx.db.query(
    `select 1 from transcript_runs where reference_id = $1 and status in ('queued', 'submitted', 'processing', 'unknown_outcome')
     union all
     select 1 from app_jobs where org_id = $2 and owner_user_id = $3 and kind = 'transcript_submit' and state in ('queued', 'running')
       and input_ref ->> 'referenceId' = $1::text`, [referenceId, ctx.orgId, ctx.uid],
  );
  if (busy.rowCount) throw new AppError('CONFLICT', '이미 진행 중인 추출 작업이 있습니다.');
  return { noteId: ref.note.id, platformNoteId: ref.note.platformNoteId };
}

export async function getTranscript(ctx: Ctx, referenceId: string): Promise<TranscriptView | null> {
  await getReference(ctx, referenceId);
  const run = (await ctx.db.query(
    `select id, status, fail_code, data_mode, text_stored, created_at, updated_at from transcript_runs
     where reference_id = $1 and owner_user_id = $2 order by created_at desc limit 1`, [referenceId, ctx.uid],
  )).rows[0];
  if (!run) return null;
  const segments = (await ctx.db.query(
    `select seq, start_ms, end_ms, text_seg, excerpt, masked from transcript_segments where run_id = $1 order by seq`, [run.id],
  )).rows.map((s) => ({ seq: s.seq, startMs: s.start_ms, endMs: s.end_ms, text: s.text_seg, excerpt: s.excerpt, masked: s.masked }));
  return {
    runId: run.id, status: run.status, failCode: run.fail_code, dataMode: run.data_mode, textStored: run.text_stored, segments,
    createdAt: run.created_at.toISOString(), updatedAt: run.updated_at.toISOString(),
  };
}

export async function deleteTranscript(ctx: Ctx, referenceId: string): Promise<void> {
  await getReference(ctx, referenceId);
  const r = await ctx.db.query(`delete from transcript_runs where reference_id = $1 and owner_user_id = $2 and status not in ('queued', 'submitted', 'processing')`, [referenceId, ctx.uid]);
  if (!r.rowCount) notFound();
}

export type StoragePolicy = { storeFullText: boolean };

/**
 * Spec F15: full text only with cache + excerpt-display permission.
 * Mock fixtures are synthetic and labelled demo, so they are stored in full.
 */
export function transcriptStoragePolicy(mode: 'mock' | 'live', permission: { allow_cache: boolean; allow_excerpt_display: boolean } | null): StoragePolicy {
  if (mode === 'mock') return { storeFullText: true };
  return { storeFullText: !!permission && permission.allow_cache && permission.allow_excerpt_display };
}

/** Writes a finished provider result (worker, service role). Personal info is masked before storage. */
export async function storeTranscriptResult(db: Db, runId: string, result: TranscriptResult, policy: StoragePolicy): Promise<void> {
  if (result.status === 'processing') {
    await db.query(`update transcript_runs set status = 'processing' where id = $1`, [runId]);
    return;
  }
  if (result.status === 'failed') {
    const status = result.failCode === 'no_speech_detected' ? 'no_speech' : 'failed';
    await db.query(`update transcript_runs set status = $2, fail_code = $3 where id = $1`, [runId, status, result.failCode]);
    return;
  }
  let excerpts = 0;
  for (const s of result.segments) {
    const { text, masked } = maskPersonalInfo(s.text);
    const excerpt = excerpts < EXCERPTS_PER_RUN ? [...text].slice(0, EXCERPT_MAX).join('') : null;
    if (excerpt) excerpts += 1;
    await db.query(
      `insert into transcript_segments (run_id, seq, start_ms, end_ms, text_seg, excerpt, masked) values ($1, $2, $3, $4, $5, $6, $7)`,
      [runId, s.seq, s.startMs, s.endMs, policy.storeFullText ? text : null, excerpt, masked],
    );
  }
  const full = policy.storeFullText ? maskPersonalInfo(result.text).text : null;
  const last = result.segments[result.segments.length - 1];
  await db.query(
    `update transcript_runs set status = 'succeeded', full_text = $2, text_stored = $3, duration_ms = $4 where id = $1`,
    [runId, full, policy.storeFullText, last?.endMs ?? null],
  );
}
