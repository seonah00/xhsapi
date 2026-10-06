import { z } from 'zod';

/** HTTP 200 can still be a business error: check `code` separately (spec 5.1). */
export const RedfoxEnvelope = z.object({
  code: z.number().int(),
  msg: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown(),
});
export const REDFOX_SUCCESS = 2000;

/** RF13 — from user-provided provider doc (2026-10-05). */
export const Rf13Data = z.object({ taskId: z.string().min(1).max(128) });

/** RF14 — status values outside the documented set fail validation (contract violation). */
export const Rf14Data = z.object({
  taskId: z.string().min(1),
  status: z.enum(['succeeded', 'processing', 'failed']),
  failReason: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  stampSents: z
    .array(z.object({ textSeg: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }))
    .nullable()
    .optional(),
});

/**
 * RF01 search (/story/api/xhs/search/search) — provider doc plus one real response shared by the
 * user (2026-10-06): wrapped in code/msg/data like every other endpoint; `total` can exceed the
 * number of returned articles; latestHotArticles and hotTopics are unrelated to the keyword.
 */
const n = z.number().int().nonnegative().nullable().optional();
export const Rf01Article = z.object({
  id: z.string().min(1).max(64),
  title: z.string().nullable().optional(),
  desc: z.string().nullable().optional(),
  authorId: z.string().min(1).max(64).nullable().optional(),
  authorNickname: z.string().nullable().optional(),
  authorFans: n,
  likedCount: n,
  collectedCount: n,
  commentsCount: n,
  sharedCount: n,
  interactiveCount: n,
  createTime: z.string().nullable().optional(),
  shareInfoLink: z.string().nullable().optional(),
  topicsName: z.string().nullable().optional(),
});
export const Rf01Data = z.object({
  articles: z.array(Rf01Article).nullable().optional(),
  latestHotArticles: z.array(Rf01Article).nullable().optional(),
  relatedSearches: z.array(z.object({ keyword: z.string(), articleCount: z.number().nullable().optional() })).nullable().optional(),
  keyword: z.string().nullable().optional(),
  pageNum: z.number().int().nullable().optional(),
  pageSize: z.number().int().nullable().optional(),
  tips: z.string().nullable().optional(),
  total: z.number().int().nullable().optional(),
});
export type Rf01Data = z.infer<typeof Rf01Data>;
