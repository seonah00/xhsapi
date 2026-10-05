import { z } from 'zod';
import { FormatSlug, TopicSlug } from '@xhs/domain';

/** Spec F02 account profile. Child info is an age band only: no names, schools or birthdays. */
export const AccountProfile = z.object({
  displayName: z.string().trim().min(1).max(80),
  topics: z.array(TopicSlug).min(1).max(6),
  mainTopic: TopicSlug,
  subTopics: z.array(z.string().trim().min(1).max(40)).max(3).default([]),
  audience: z.string().trim().min(1).max(500),
  goals: z.array(z.enum(['grow_followers', 'build_portfolio', 'brand_collab', 'record_life', 'sell_or_promote', 'learn_chinese'])).min(1),
  tone: z.enum(['plain', 'friendly', 'informative', 'humor', 'custom']),
  toneCustom: z.string().trim().max(100).optional(),
  formats: z.array(FormatSlug).min(1),
  chineseLevel: z.enum(['beginner', 'intermediate', 'advanced', 'native']),
  showFace: z.boolean(),
  useVoice: z.boolean(),
  profileUrl: z.string().trim().url().max(300).optional(),
  region: z.string().trim().max(60).optional(),
  audienceRegion: z.string().trim().max(60).optional(),
  ownedItems: z.string().trim().max(500).optional(),
  shootingTime: z.string().trim().max(200).optional(),
  avoidTopics: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  childContent: z.object({ allowed: z.boolean(), ageBand: z.enum(['0-2', '3-6', '7-12', '13+']).optional() }).optional(),
}).refine((p) => p.topics.includes(p.mainTopic), { message: '주력 주제는 선택한 주제 중 하나여야 합니다.', path: ['mainTopic'] });
export type AccountProfile = z.infer<typeof AccountProfile>;

export const GOAL_LABELS: Record<AccountProfile['goals'][number], string> = {
  grow_followers: '팔로워 늘리기',
  build_portfolio: '포트폴리오 만들기',
  brand_collab: '브랜드 협업',
  record_life: '일상 기록',
  sell_or_promote: '판매·홍보',
  learn_chinese: '중국어 연습',
};
export const TONE_LABELS: Record<AccountProfile['tone'], string> = {
  plain: '담백', friendly: '친근', informative: '정보형', humor: '유머', custom: '사용자 정의',
};
export const LEVEL_LABELS: Record<AccountProfile['chineseLevel'], string> = {
  beginner: '입문', intermediate: '중급', advanced: '고급', native: '원어민 수준',
};
