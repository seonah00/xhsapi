import type { FactSheet, PlanContent } from './plans.ts';

export type GenerationInput = {
  facts: FactSheet;
  profile: { mainTopic: string; tone: string; formats: string[]; audience: string };
  references: { id: string; title: string | null; tags: string[] }[];
};

export type GenerationOutput =
  | { kind: 'questions'; missingFacts: string[]; reason: string }
  | {
      kind: 'proposal';
      candidates: { angle: string; difference: string; neededFacts: string[]; difficulty: 'low' | 'medium' | 'high' }[];
      titleOptions: string[];
      content: PlanContent;
      evidenceRefs: string[];
      missingFacts: string[];
      notes: string[];
    };

const TONE_OPENER: Record<string, string> = { friendly: '姐妹们～', informative: '整理了一下：', humor: '说出来你可能不信，', plain: '', custom: '' };

/**
 * Deterministic mock "AI" plan generation. It only recombines the student's own
 * facts and scenes; it never adds experiences, numbers, prices or results the
 * student did not enter. Without enough facts it returns questions (spec F08).
 */
export function generatePlan(input: GenerationInput): GenerationOutput {
  const f = input.facts;
  const missing: string[] = [];
  if (!f.subject) missing.push('무엇을 다루는지(대상·장소·제품·경험)를 한 줄로 적어 주세요.');
  if (f.confirmedFacts.length === 0) missing.push('직접 확인한 사실을 1개 이상 적어 주세요(예: 실제로 써 본 기간, 방문한 날).');
  if (f.shootableScenes.length === 0) missing.push('직접 촬영할 수 있는 장면을 1개 이상 적어 주세요.');
  if (missing.length) return { kind: 'questions', missingFacts: [...missing, ...f.unknownFacts.map((u) => `확인 필요: ${u}`)], reason: '실제 경험 정보가 부족해 초안 대신 확인 질문을 드립니다.' };

  const opener = TONE_OPENER[input.profile.tone] ?? '';
  const facts = f.confirmedFacts;
  const title = `${f.subject}｜${facts[0]}`.slice(0, 40);
  const bodyLines = [
    `${opener}今天想分享：${f.subject}`,
    ...facts.map((x, i) => `${i + 1}. ${x}`),
    f.sponsorship === 'yes' ? '（本篇为合作内容）' : '',
    '以上都是我自己的真实情况，仅供参考。',
  ].filter(Boolean);
  const refTags = [...new Set(input.references.flatMap((r) => r.tags))].slice(0, 4);
  const content: PlanContent = {
    intent: `${input.profile.audience}에게 「${f.subject}」에 대한 본인의 확인된 경험을 전달합니다.`,
    title,
    cover: f.subject.slice(0, 20),
    body: bodyLines.join('\n'),
    tags: refTags,
    subtitles: f.shootableScenes.map((s) => `（${s}）`).join('\n'),
    shots: [
      { scene: `시작 장면: ${f.shootableScenes[0]}`, note: '첫 3초 안에 주제를 한 문장으로 말하기' },
      ...f.shootableScenes.slice(1).map((s) => ({ scene: s, note: '' })),
      { scene: '마무리: 정리 한 컷', note: '확인된 사실만 요약' },
    ],
    meaningKo: [`오늘 공유할 것: ${f.subject}`, ...facts.map((x, i) => `${i + 1}. (입력한 사실 그대로) ${x}`), f.sponsorship === 'yes' ? '(협찬 콘텐츠 표시)' : '', '모두 본인의 실제 상황이며 참고용입니다.'].filter(Boolean).join('\n'),
  };
  return {
    kind: 'proposal',
    candidates: [
      { angle: '내 경험 순서대로 보여주기', difference: '참고 자료와 달리 본인의 실제 순서·장면으로 구성', neededFacts: [], difficulty: 'low' },
      { angle: '확인한 사실만 비교 정리', difference: '숫자·결과는 입력한 것만 사용', neededFacts: f.unknownFacts, difficulty: 'medium' },
    ],
    titleOptions: [title, `${f.subject}的真实分享`.slice(0, 40), `关于${f.subject}，我确认过的几件事`.slice(0, 40)],
    content,
    evidenceRefs: input.references.map((r) => r.id),
    missingFacts: f.unknownFacts.map((u) => `확인 필요: ${u}`),
    notes: ['데모 생성기: 입력한 사실을 재배열했을 뿐 새로운 경험·효과·수치를 만들지 않았습니다.', '제목 평가는 편집 의견이며 성공 확률이 아닙니다.'],
  };
}

/** Guard: every digit sequence in the generated Chinese text must come from the student's facts. */
export function findInventedNumbers(output: PlanContent, facts: FactSheet): string[] {
  const source = [facts.subject, ...facts.confirmedFacts, ...facts.shootableScenes, facts.price ?? '', facts.usagePeriod ?? '', facts.visitDate ?? '', facts.results ?? ''].join(' ');
  const allowed = new Set(source.match(/\d+(?:\.\d+)?/g) ?? []);
  const text = [output.title, output.cover, output.body, output.subtitles].join('\n');
  // List numbering like "1. " is structural, not a claim.
  const claims = text.replace(/^\s*\d+\.\s/gm, '').match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(claims.filter((n) => !allowed.has(n)))];
}
