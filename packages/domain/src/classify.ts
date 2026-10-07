import type { FormatSlug, TopicSlug } from './enums.ts';

/**
 * Keyword classifier for provider notes that arrive without our taxonomy (RF01/RF02 live results).
 * Editorial keyword lists written for this project; matches title, stored excerpt and tags only.
 * Results are stored with confidence `low` and classifier version `keyword-v1` so they can be
 * told apart from provider mappings and reviewed later. No match means no label (never guessed).
 */
export const CLASSIFIER_VERSION = 'keyword-v1';

const TOPIC_KEYWORDS: Record<TopicSlug, readonly string[]> = {
  beauty: ['护肤', '美妆', '化妆', '彩妆', '口红', '粉底', '面膜', '精华', '防晒', '眼影', '敏感肌', '底妆', '香水', '美甲', '妆容', '卸妆'],
  'daily-life': ['日常', '独居', '打工人', '上班族', '记录生活', '生活碎片', '周末日常'],
  parenting: ['育儿', '宝宝', '带娃', '母婴', '亲子', '宝妈', '辅食', '早教'],
  'food-places': ['探店', '美食', '餐厅', '咖啡店', '咖啡馆', '甜品', '烤肉', '必吃', '小吃', '好吃'],
  'travel-outing': ['旅行', '旅游', '出行', '景点', '自由行', '酒店', 'citywalk', '一日游', '行程'],
  fashion: ['穿搭', 'ootd', '时尚', '搭配', '包包', '显瘦', '衣橱'],
};

const FORMAT_KEYWORDS: Record<FormatSlug, readonly string[]> = {
  vlog: ['vlog'],
  review: ['测评', '评测', '使用感', '回购', '踩雷', '避雷', '真实感受'],
  comparison: ['对比', '横评', ' vs '],
  routine: ['流程', '步骤', 'routine', '早c晚a'],
  'how-to': ['教程', '手把手', '如何', '怎么做'],
  'information-list': ['合集', '清单', '攻略', '汇总', '盘点'],
  story: ['故事', '经历'],
  'photo-diary': ['plog', '图文日记', '随手拍'],
};

function matches(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => text.includes(k.toLowerCase()));
}

export function classifyNote(n: { title: string | null; body: string | null; tags: readonly string[] }): { topics: TopicSlug[]; formats: FormatSlug[] } {
  const text = ` ${[n.title ?? '', n.body ?? '', ...n.tags].join(' ').toLowerCase()} `;
  return {
    topics: (Object.keys(TOPIC_KEYWORDS) as TopicSlug[]).filter((t) => matches(text, TOPIC_KEYWORDS[t])),
    formats: (Object.keys(FORMAT_KEYWORDS) as FormatSlug[]).filter((f) => matches(text, FORMAT_KEYWORDS[f])),
  };
}
