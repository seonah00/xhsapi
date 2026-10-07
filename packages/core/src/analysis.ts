import type { AnalysisScope } from '@xhs/domain';
import { demoReferenceSections, type ReferenceSection } from './reference-detail.ts';

export type EvidenceClaim = { kind: 'observation' | 'inference' | 'suggestion'; textKo: string; evidenceIds: string[]; uncertainty: string | null };

export type AnalysisInput = {
  title: string | null;
  body: string | null;
  tags: string[];
  userText: string | null;
  userMemo: string | null;
  noteType: 'video' | 'image' | null;
  transcript: { seq: number; startMs: number; endMs: number; text: string }[] | null;
};

export type AnalysisOutput = {
  analysisScope: AnalysisScope[];
  observations: EvidenceClaim[];
  inferences: EvidenceClaim[];
  suggestions: EvidenceClaim[];
  missingFacts: string[];
  limitations: string[];
  generator: 'mock-rules-v1' | 'openai-reference-v1' | 'openai-reference-v2';
  sections?: ReferenceSection[];
};

const CTA = /(收藏|关注|评论|点赞|私信|下期)/;
const NUMBER = /\d/;
const QUESTION = /[?？吗呢]/;

/**
 * Deterministic mock analysis (no AI). It reports only what the inputs show,
 * labels interpretations as hypotheses, and states what was not analysed (spec F05).
 */
export function analyzeReference(input: AnalysisInput): AnalysisOutput {
  const scope: AnalysisScope[] = [];
  const obs: EvidenceClaim[] = [];
  const inf: EvidenceClaim[] = [];
  const sug: EvidenceClaim[] = [];
  const limitations: string[] = [];
  const missing: string[] = [];
  const body = input.body ?? input.userText;
  const bodyId = input.body ? 'body' : 'userText';

  if (input.title) {
    scope.push(body ? 'body_only' : 'metadata_only');
    obs.push({ kind: 'observation', textKo: `제목 길이는 ${[...input.title].length}자입니다.`, evidenceIds: ['title'], uncertainty: null });
    if (NUMBER.test(input.title)) obs.push({ kind: 'observation', textKo: '제목에 숫자가 들어 있습니다.', evidenceIds: ['title'], uncertainty: null });
    if (QUESTION.test(input.title)) obs.push({ kind: 'observation', textKo: '제목이 질문 형태입니다.', evidenceIds: ['title'], uncertainty: null });
  } else if (body) {
    scope.push('body_only');
  }
  if (body) {
    obs.push({ kind: 'observation', textKo: `본문(또는 붙여넣은 텍스트)은 ${[...body].length}자입니다.`, evidenceIds: [bodyId], uncertainty: null });
  } else {
    missing.push('본문 텍스트가 없어 정보 구성은 분석하지 않았습니다.');
  }
  if (input.tags.length) obs.push({ kind: 'observation', textKo: `해시태그 ${input.tags.length}개가 붙어 있습니다: ${input.tags.slice(0, 5).join(', ')}`, evidenceIds: ['tags'], uncertainty: null });
  if (input.userMemo || (input.userText && !input.title)) scope.push('user_notes_only');

  if (input.transcript && input.transcript.length) {
    scope.push('audio_transcript');
    const opening = input.transcript.filter((s) => s.startMs < 3000);
    const last = input.transcript[input.transcript.length - 1]!;
    if (opening.length) obs.push({ kind: 'observation', textKo: `첫 3초 안의 발화: “${opening.map((s) => s.text).join(' ')}”`, evidenceIds: opening.map((s) => `seg:${s.seq}`), uncertainty: 'ASR 자동 받아쓰기라 오인식이 있을 수 있습니다.' });
    obs.push({ kind: 'observation', textKo: `발화는 ${input.transcript.length}개 문장으로 나뉘고 약 ${Math.round(last.endMs / 1000)}초까지 이어집니다.`, evidenceIds: ['transcript'], uncertainty: null });
    if (CTA.test(last.text)) obs.push({ kind: 'observation', textKo: `마지막 문장에서 저장·팔로우 등 행동을 요청합니다: “${last.text}”`, evidenceIds: [`seg:${last.seq}`], uncertainty: null });
    inf.push({ kind: 'inference', textKo: '도입부에서 주제를 바로 말하는 구조일 수 있습니다. 이것이 반응에 영향을 줬는지는 이 자료만으로 알 수 없습니다.', evidenceIds: opening.map((s) => `seg:${s.seq}`), uncertainty: '단일 자료의 상관 관찰이며 원인이 아닙니다.' });
    sug.push({ kind: 'suggestion', textKo: '내 영상에서도 첫 3초에 무엇을 다루는지 한 문장으로 말해 보고, 다음 회고에서 비교해 보세요.', evidenceIds: opening.map((s) => `seg:${s.seq}`), uncertainty: null });
  }
  if (input.noteType === 'video') {
    limitations.push('영상의 화면 구도·편집·장면 전환은 분석하지 않았습니다.');
    if (!input.transcript) limitations.push('음성 문안을 추출하지 않아 말하기 구조는 분석하지 않았습니다.');
  }
  if (input.title && body) {
    inf.push({ kind: 'inference', textKo: '제목이 약속한 내용이 본문에 실제로 있는지 직접 확인해 보세요. 자동 판단하지 않았습니다.', evidenceIds: ['title', bodyId], uncertainty: '검증할 가설입니다.' });
  }
  sug.push({ kind: 'suggestion', textKo: '이 자료를 그대로 따라 하기보다, 내 경험·장소·제품으로 바꿨을 때 달라지는 점을 기획 메모에 적어 두세요.', evidenceIds: [], uncertainty: null });

  return {
    analysisScope: [...new Set(scope.length ? scope : ['metadata_only' as const])],
    observations: obs,
    inferences: inf,
    suggestions: sug,
    missingFacts: missing,
    limitations,
    generator: 'mock-rules-v1',
    sections: demoReferenceSections(input),
  };
}

export type StoredAnalysis = { id: string; status: string; dataMode: string; createdAt: string; output: AnalysisOutput | null; analysisScope: string[] };

export async function getLatestAnalysis(ctx: import('./context.ts').Ctx, referenceId: string): Promise<StoredAnalysis | null> {
  const r = (await ctx.db.query(
    `select id, status, data_mode, created_at, output_json, analysis_scope from analyses
     where org_id = $1 and owner_user_id = $2 and target_type = 'reference' and target_id = $3 order by created_at desc limit 1`,
    [ctx.orgId, ctx.uid, referenceId],
  )).rows[0];
  return r ? { id: r.id, status: r.status, dataMode: r.data_mode, createdAt: r.created_at.toISOString(), output: r.output_json, analysisScope: r.analysis_scope } : null;
}

export async function pendingJobFor(ctx: import('./context.ts').Ctx, kind: string, referenceId: string): Promise<string | null> {
  const r = (await ctx.db.query(
    `select id from app_jobs where org_id = $1 and owner_user_id = $2 and kind = $3 and state in ('queued', 'running', 'waiting_external')
       and input_ref ->> 'referenceId' = $4 order by created_at desc limit 1`, [ctx.orgId, ctx.uid, kind, referenceId],
  )).rows[0];
  return r?.id ?? null;
}
