/**
 * Loads synthetic demo content into a local database (mock mode only):
 * notes via the mock provider + ingestion path, an expression dictionary,
 * editorial keyword seeds and one onboarded account for student A.
 * Usage: DATABASE_URL=... pnpm tsx scripts/seed-demo.ts
 */
import pg from 'pg';
import { canonicalTerm } from '@xhs/domain';
import { MockXhsProvider, type SearchResult } from '@xhs/providers';
import { ingestSearchResult } from '@xhs/core';

const ORGS = ['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002'];
const STUDENT_A = '00000000-0000-4000-a000-000000000001';

/** Shift fixture dates so the newest note is one day old, keeping relative spacing. */
function shiftDates(result: SearchResult, now: Date): SearchResult {
  const dates = result.notes.map((n) => n.publishedAt).filter((d): d is string => !!d).map(Date.parse);
  const shift = now.getTime() - 86_400_000 - Math.max(...dates);
  const move = (d: string | null) => (d ? new Date(Date.parse(d) + shift).toISOString() : null);
  return {
    ...result,
    notes: result.notes.map((n) => ({ ...n, publishedAt: move(n.publishedAt) })),
    latestHotArticles: result.latestHotArticles.map((n) => ({ ...n, publishedAt: move(n.publishedAt) })),
  };
}

const EXPRESSIONS: { expression: string; tone: string; topics: string[]; type: 'basic' | 'observed_recent' | 'trend_unverified'; ex: Record<string, string> }[] = [
  { expression: '姐妹们', tone: 'friendly', topics: ['beauty', 'fashion', 'daily-life'], type: 'basic', ex: { literal: '자매들', meaning: '여러분(친근한 호칭)', nuance: '여성 독자에게 친근하게 말을 거는 느낌', use: '도입부 호칭', avoid: '공식적·정보 전달 위주 글', example: '姐妹们，今天分享一个小技巧！' } },
  { expression: '宝子们', tone: 'friendly', topics: ['beauty', 'daily-life'], type: 'observed_recent', ex: { literal: '보물들', meaning: '여러분(애칭)', nuance: '매우 친근하고 가벼운 말투', use: '친근한 브이로그·일상', avoid: '육아 정보·진지한 주제' } },
  { expression: '亲测', tone: 'informative', topics: ['beauty', 'parenting'], type: 'basic', ex: { literal: '직접 테스트', meaning: '내가 직접 써 봄', nuance: '실제 경험임을 강조', use: '실제로 써 본 제품 후기', avoid: '써 보지 않은 제품(사실과 다르면 문제)' } },
  { expression: '踩雷', tone: 'friendly', topics: ['beauty', 'food-places'], type: 'basic', ex: { literal: '지뢰를 밟다', meaning: '돈 쓰고 실패함', nuance: '솔직한 실패 후기', use: '비추천 후기', avoid: '특정 브랜드를 근거 없이 비방' } },
  { expression: '拔草', tone: 'friendly', topics: ['beauty', 'food-places', 'fashion'], type: 'basic', ex: { literal: '풀을 뽑다', meaning: '사고 싶던 걸 실제로 사 봄/가 봄', nuance: '위시리스트를 해결한 느낌', use: '구매·방문 후기' } },
  { expression: '种草', tone: 'friendly', topics: ['beauty', 'fashion', 'food-places'], type: 'basic', ex: { literal: '풀을 심다', meaning: '남에게 사고 싶게 만들다', nuance: '추천', use: '추천 글', avoid: '협찬인데 표시하지 않는 경우' } },
  { expression: '绝绝子', tone: 'humor', topics: ['food-places', 'daily-life'], type: 'trend_unverified', ex: { literal: '최고 중의 최고', meaning: '정말 좋다(유행어)', nuance: '과장된 유행어, 남용하면 가볍게 보임', avoid: '효과·성능을 단정하는 문맥' } },
  { expression: '打卡', tone: 'plain', topics: ['food-places', 'travel-outing'], type: 'basic', ex: { literal: '출근 체크', meaning: '방문 인증', use: '장소 방문 기록' } },
  { expression: '攻略', tone: 'informative', topics: ['travel-outing'], type: 'basic', ex: { literal: '공략', meaning: '가이드·꿀팁 정리', use: '여행·정보 정리 글' } },
  { expression: '小众', tone: 'plain', topics: ['food-places', 'travel-outing'], type: 'basic', ex: { literal: '소수 대중', meaning: '아는 사람만 아는', nuance: '숨은 명소 느낌', avoid: '실제로 유명한 곳' } },
  { expression: '平价', tone: 'informative', topics: ['beauty', 'fashion'], type: 'basic', ex: { literal: '평가', meaning: '가성비 좋은 저렴한 가격', use: '가격대 소개' } },
  { expression: '带娃', tone: 'plain', topics: ['parenting'], type: 'basic', ex: { literal: '아이를 데리고', meaning: '아이를 돌보다/데리고 다니다', use: '육아 일상', avoid: '아이 실명·학교 등 개인정보와 함께 쓰기' } },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const now = new Date();
  try {
    await client.query('begin');
    for (const orgId of ORGS) {
      const provider = new MockXhsProvider({ now: () => now });
      const result = shiftDates(await provider.searchNotes({ query: '' }), now);
      await ingestSearchResult(client as never, { orgId, provider: 'mock', endpoint: result.endpoint, query: { query: '', seed: true } }, result);

      for (const e of EXPRESSIONS) {
        // Editorial examples stay in explanations.example ("작성 예시"); expression_evidence is only for observed quotes.
        await client.query(
          `insert into expressions (org_id, expression, explanations_json, tone, topics, expression_type, provenance, review_status, data_mode)
           values ($1, $2, $3, $4, $5, $6, 'editorial', 'published', 'mock')`,
          [orgId, e.expression, e.ex, e.tone, e.topics, e.type],
        );
      }
      for (const [zh, ko, topic] of [['护肤', '스킨케어', 'beauty'], ['探店', '가게 탐방', 'food-places'], ['穿搭', '코디', 'fashion'], ['育儿', '육아', 'parenting'], ['旅行攻略', '여행 가이드', 'travel-outing'], ['日常vlog', '일상 브이로그', 'daily-life']] as const) {
        await client.query(
          `insert into keywords (org_id, canonical_text, raw_text, kind, provenance, meaning_ko, topics, review_status, data_mode)
           values ($1, $2, $3, 'phrase', 'editorial_seed', $4, $5, 'published', 'mock') on conflict do nothing`,
          [orgId, canonicalTerm(zh), zh, ko, [topic]],
        );
      }
      // Meanings for observed tags (editorial gloss, not a provider field).
      for (const [zh, ko] of [['护肤', '스킨케어'], ['韩系妆容', '한국식 메이크업'], ['平价好物', '가성비 아이템'], ['敏感肌', '민감성 피부'], ['日常vlog', '일상 브이로그'], ['独居生活', '자취 생활'], ['韩国生活', '한국 생활'], ['收纳', '정리 수납'], ['育儿日常', '육아 일상'], ['亲子游', '아이와 나들이'], ['辅食', '이유식'], ['宝妈分享', '엄마의 공유'], ['首尔探店', '서울 가게 탐방'], ['韩国美食', '한국 음식'], ['咖啡店', '카페'], ['面包控', '빵 덕후'], ['韩国旅行', '한국 여행'], ['济州岛', '제주도'], ['首尔周边', '서울 근교'], ['旅行攻略', '여행 가이드'], ['韩系穿搭', '한국식 코디'], ['小个子穿搭', '키 작은 사람 코디'], ['通勤穿搭', '출근 코디'], ['ootd', '오늘의 코디']] as const) {
        await client.query(`update keywords set meaning_ko = $3 where org_id = $1 and canonical_text = $2 and meaning_ko is null`, [orgId, canonicalTerm(zh), ko]);
      }
    }

    // One onboarded account for student A so the home screen is populated.
    const exists = (await client.query(`select 1 from creator_accounts where owner_user_id = $1`, [STUDENT_A])).rowCount;
    if (!exists) {
      const acc = (await client.query(
        `insert into creator_accounts (org_id, owner_user_id, display_name) values ($1, $2, '데모 뷰티·일상 계정') returning id`, [ORGS[0], STUDENT_A],
      )).rows[0].id;
      const profile = {
        displayName: '데모 뷰티·일상 계정', topics: ['beauty', 'daily-life'], mainTopic: 'beauty', subTopics: ['민감성 피부'],
        audience: '한국 화장품에 관심 있는 20~30대 중국어 사용자', goals: ['grow_followers', 'learn_chinese'], tone: 'friendly',
        formats: ['vlog', 'routine', 'review'], chineseLevel: 'intermediate', showFace: true, useVoice: true, avoidTopics: [],
      };
      const v = (await client.query(
        `insert into account_profile_versions (org_id, account_id, version, profile_json, created_by) values ($1, $2, 1, $3, $4) returning id`, [ORGS[0], acc, profile, STUDENT_A],
      )).rows[0].id;
      await client.query(`update creator_accounts set current_profile_version_id = $1 where id = $2`, [v, acc]);
    }
    await client.query('commit');
    const counts = (await client.query(`select (select count(*) from notes)::int as notes, (select count(*) from keywords)::int as keywords, (select count(*) from expressions)::int as expressions`)).rows[0];
    console.info('demo content seeded', counts);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
