/** Canonical form for matching: NFKC, ASCII case-fold, trimmed, no leading '#'. Raw text is stored separately. */
export function canonicalTerm(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/^#+|#+$/g, '').replace(/\[话题\]$/, '').trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const XHS_TOPIC = /#([^#\s[\]]{1,40})(?:\[话题\])?#/g;
const PLAIN_TAG = /(?:^|\s)#([^#\s[\]]{1,40})(?=\s|$)/g;

/**
 * Extracts hashtags only (spec F06): `#话题[话题]#` and space-delimited `#tag`.
 * Ordinary body phrases are never reported as hashtags. Duplicates collapse to one.
 */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Map<string, string>();
  for (const re of [XHS_TOPIC, PLAIN_TAG]) {
    for (const m of text.matchAll(re)) {
      const raw = m[1];
      if (!raw) continue;
      const key = canonicalTerm(raw);
      if (key && !out.has(key)) out.set(key, raw);
    }
  }
  return [...out.values()];
}

const HANGUL = /[가-힣]/;
export function containsHangul(s: string): boolean {
  return HANGUL.test(s);
}

/**
 * Editorial Korean→Chinese seed dictionary for query expansion in mock mode.
 * Candidates are shown to the user with their source; this is not a translation model.
 */
export const KO_ZH_SEED: Readonly<Record<string, readonly string[]>> = {
  스킨케어: ['护肤'], 피부: ['护肤', '肌肤'], 민감성: ['敏感肌'], 화장품: ['好物', '护肤'], 메이크업: ['妆容', '妆'], 화장: ['妆容'],
  파운데이션: ['粉底液'], 선크림: ['防晒'], 립: ['唇釉', '口红'],
  일상: ['日常'], 브이로그: ['vlog'], 자취: ['独居'], 혼자: ['一个人', '独居'], 수납: ['收纳'], 아침: ['早餐', '晨间'],
  육아: ['育儿', '带娃'], 아기: ['宝宝'], 이유식: ['辅食'], 유치원: ['幼儿园'], 그림책: ['绘本'],
  맛집: ['探店', '必吃'], 카페: ['咖啡店', '咖啡'], 빵: ['面包'], 디저트: ['甜品'], 편의점: ['便利店'], 브런치: ['早午餐'],
  여행: ['旅行', '攻略'], 제주: ['济州岛'], 서울: ['首尔'], 부산: ['釜山'], 단풍: ['赏枫'], 야경: ['夜景'],
  패션: ['穿搭'], 코디: ['穿搭'], 데일리룩: ['OOTD', '穿搭'], 가방: ['包包'], 운동화: ['运动鞋'], 셔츠: ['衬衫'],
};

export type QueryExpansion = { original: string; candidates: { text: string; source: 'editorial_seed' }[]; unmatched: string[] };

export function expandKoreanQuery(q: string): QueryExpansion {
  const original = q.trim();
  const candidates = new Map<string, { text: string; source: 'editorial_seed' }>();
  const unmatched: string[] = [];
  for (const word of original.split(/\s+/).filter(Boolean)) {
    if (!containsHangul(word)) {
      candidates.set(word, { text: word, source: 'editorial_seed' });
      continue;
    }
    const hits = Object.entries(KO_ZH_SEED).filter(([ko]) => word.includes(ko)).flatMap(([, zh]) => zh);
    if (hits.length === 0) unmatched.push(word);
    for (const zh of hits) candidates.set(zh, { text: zh, source: 'editorial_seed' });
  }
  return { original, candidates: [...candidates.values()], unmatched };
}
