import type { MetricValue } from './metrics.ts';

export const RANKING_VERSION = 'rules-v1';

export type RankProfile = {
  mainTopic: string;
  topics: readonly string[];
  formats: readonly string[];
  avoidTopics: readonly string[];
};

export type RankCandidate = {
  id: string;
  title: string | null;
  topics: readonly string[];
  formats: readonly string[];
  publishedAt: string | null;
  authorRef: string | null;
  likes: MetricValue | null;
  saves: MetricValue | null;
  isFallback: boolean;
};

export type ReasonCode =
  | 'main_topic' | 'related_topic' | 'shootable_format' | 'recent' | 'reaction_high_in_sample';
export type ConCode =
  | 'format_not_in_profile' | 'topic_outside_profile' | 'date_unknown' | 'metrics_unknown' | 'older_than_window';

export const REASON_TEXT: Record<ReasonCode, string> = {
  main_topic: '내 주력 주제와 같은 주제입니다.',
  related_topic: '내가 고른 주제 중 하나와 관련 있습니다.',
  shootable_format: '내가 촬영 가능하다고 고른 형식입니다.',
  recent: '최근 7일 안에 게시되었습니다.',
  reaction_high_in_sample: '같은 조건의 저장된 자료 중 반응 수가 상위권입니다(표본 내 비교).',
};
export const CON_TEXT: Record<ConCode, string> = {
  format_not_in_profile: '내 촬영 가능 형식에 없는 형식입니다. 촬영 방식을 바꿔야 할 수 있습니다.',
  topic_outside_profile: '내 계정 주제와 직접 관련이 없습니다.',
  date_unknown: '게시일을 확인할 수 없습니다.',
  metrics_unknown: '반응 수를 확인할 수 없습니다.',
  older_than_window: '최근 7일보다 오래된 자료입니다.',
};

export type Ranked = { id: string; score: number; reasons: ReasonCode[]; cons: ConCode[] };

/** Lower bounds and exact values are comparable; ranges/estimates use their lower bound; unknown is not. */
function comparable(m: MetricValue | null): number | null {
  if (!m) return null;
  if (m.precision === 'exact') return m.exact;
  if (m.precision === 'lower_bound' || m.precision === 'range' || m.precision === 'estimated') return m.lowerBound;
  return null;
}

/**
 * Spec 4.1 rule-based ranking: filter → fit → exclusions → recency/reaction → diversity.
 * The score is internal and versioned; the UI shows only reason codes.
 */
export function rankForProfile(profile: RankProfile, candidates: readonly RankCandidate[], now: Date, opts: { limit?: number; perAuthor?: number } = {}): Ranked[] {
  const limit = opts.limit ?? 6;
  const perAuthor = opts.perAuthor ?? 2;
  const avoid = profile.avoidTopics.map((t) => t.toLowerCase()).filter(Boolean);
  const reactions = candidates.map((c) => comparable(c.saves) ?? comparable(c.likes)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const p75 = reactions.length >= 4 ? reactions[Math.floor(reactions.length * 0.75)] ?? null : null;

  const scored: Ranked[] = [];
  for (const c of candidates) {
    if (c.isFallback) continue;
    if (avoid.some((a) => (c.title ?? '').toLowerCase().includes(a))) continue;
    const reasons: ReasonCode[] = [];
    const cons: ConCode[] = [];
    let score = 0;

    if (c.topics.includes(profile.mainTopic)) { score += 3; reasons.push('main_topic'); }
    else if (c.topics.some((t) => profile.topics.includes(t))) { score += 2; reasons.push('related_topic'); }
    else { cons.push('topic_outside_profile'); }

    if (c.formats.some((f) => profile.formats.includes(f))) { score += 2; reasons.push('shootable_format'); }
    else { score -= 1; cons.push('format_not_in_profile'); }

    if (c.publishedAt === null) cons.push('date_unknown');
    else if (now.getTime() - Date.parse(c.publishedAt) <= 7 * 86_400_000) { score += 1; reasons.push('recent'); }
    else cons.push('older_than_window');

    const r = comparable(c.saves) ?? comparable(c.likes);
    if (r === null) cons.push('metrics_unknown');
    else if (p75 !== null && r >= p75) { score += 1; reasons.push('reaction_high_in_sample'); }

    // Personalization first: nothing that fits neither topic nor format is recommended.
    if (!reasons.includes('main_topic') && !reasons.includes('related_topic')) continue;
    scored.push({ id: c.id, score, reasons, cons });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const perAuthorCount = new Map<string, number>();
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: Ranked[] = [];
  for (const s of scored) {
    const author = byId.get(s.id)?.authorRef ?? s.id;
    const n = perAuthorCount.get(author) ?? 0;
    if (n >= perAuthor) continue;
    perAuthorCount.set(author, n + 1);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
