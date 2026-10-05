import { describe, expect, it } from 'vitest';
import { FactSheet, findInventedNumbers, generatePlan, mockContextual, runRules, fieldText } from '@xhs/core';

const facts = (p: Partial<FactSheet> = {}) => FactSheet.parse(p);
const rule = (value: string, type: 'keyword' | 'exact_phrase' = 'keyword', fields = ['title', 'body']) => ({
  id: 'r1', rule_key: 'test', version: 1, source_class: 'test_editorial', scope: { fields }, match_config: { type, value },
  finding_type: 'absolute_or_exaggerated_claim', severity: 'medium' as const, rationale: '근거 없는 최상급', suggestion_zh: '个人觉得很好用', review_due_at: new Date('2020-01-01'),
});

describe('runRules', () => {
  it('reports every occurrence with UTF-16 offsets that slice back to the span', () => {
    const sections = { title: '😀最好的面霜', body: '真的最好。最好用！' };
    const f = runRules(sections, facts({ sponsorship: 'no' }), [rule('最好')]);
    const hits = f.filter((x) => x.layer === 'rule');
    expect(hits).toHaveLength(3);
    for (const h of hits) expect(fieldText(sections, h.fieldKey as 'title').slice(h.start!, h.end!)).toBe('最好');
    expect(hits[0]).toMatchObject({ fieldKey: 'title', start: 2, end: 4, reviewOverdue: true, suggestionZh: '个人觉得很好用' });
  });

  it('respects field scope and tag joining', () => {
    const sections = { title: '', body: '', tags: ['护肤', '最好用'] };
    expect(runRules(sections, facts({ sponsorship: 'no' }), [rule('最好')]).filter((x) => x.layer === 'rule')).toEqual([]);
    const t = runRules(sections, facts({ sponsorship: 'no' }), [rule('最好', 'keyword', ['tags'])]).find((x) => x.layer === 'rule')!;
    expect(fieldText(sections, 'tags').slice(t.start!, t.end!)).toBe('最好');
  });

  it('detects personal info, named schools, unsupported numbers and missing sponsorship marks', () => {
    const f = runRules({ title: '用了3天', body: '电话13812345678，孩子在阳光幼儿园。价格89元' }, facts({ sponsorship: 'yes', price: '89元' }), []);
    const types = f.map((x) => x.type);
    expect(types).toContain('personal_information');
    expect(types).toContain('child_privacy');
    expect(f.find((x) => x.type === 'source_uncertain' && x.originalSpan === '3')).toBeTruthy();
    expect(f.find((x) => x.originalSpan === '89')).toBeUndefined();
    expect(f.find((x) => x.type === 'sponsorship_review_needed' && x.severity === 'medium')).toBeTruthy();
  });

  it('ignores list numbering when looking for numbers', () => {
    const f = runRules({ title: '', body: '1. 早上洗脸\n2. 晚上卸妆' }, facts({ sponsorship: 'no' }), []);
    expect(f.filter((x) => x.type === 'source_uncertain')).toEqual([]);
  });

  it('returns no findings for clean text (UI shows the no-guarantee disclaimer)', () => {
    expect(runRules({ title: '我的晨间护肤', body: '我的晨间护肤顺序分享' }, facts({ sponsorship: 'no' }), [rule('最好')])).toEqual([]);
  });
});

describe('generatePlan (mock)', () => {
  const profile = { mainTopic: 'beauty', tone: 'friendly', formats: ['vlog'], audience: '중국어 사용자' };

  it('asks questions instead of drafting when facts are missing', () => {
    const out = generatePlan({ facts: facts({ subject: '面霜', unknownFacts: ['가격'] }), profile, references: [] });
    expect(out.kind).toBe('questions');
    if (out.kind === 'questions') expect(out.missingFacts.join(' ')).toContain('확인 필요: 가격');
  });

  it('only recombines the student\'s facts and never invents numbers', () => {
    const f = facts({ subject: '敏感肌面霜', confirmedFacts: ['我用了两周', '早晚各一次'], shootableScenes: ['洗手台上涂抹'], sponsorship: 'no' });
    const out = generatePlan({ facts: f, profile, references: [{ id: 'ref-1', title: 't', tags: ['护肤'] }] });
    expect(out.kind).toBe('proposal');
    if (out.kind !== 'proposal') return;
    expect(findInventedNumbers(out.content, f)).toEqual([]);
    expect(out.content.body).toContain('我用了两周');
    expect(out.evidenceRefs).toEqual(['ref-1']);
    expect(out.titleOptions).toHaveLength(3);
  });

  it('the guard catches numbers that are not in the facts', () => {
    const f = facts({ subject: 'x', confirmedFacts: ['用了两周'] });
    expect(findInventedNumbers({ intent: '', title: '7天见效', cover: '', body: '1. 用了两周', tags: [], subtitles: '', shots: [], meaningKo: '' }, f)).toEqual(['7']);
  });
});

describe('mockContextual', () => {
  it('flags title/body mismatch and unrelated tags as low-confidence opinions', () => {
    const r = mockContextual({ title: '首尔咖啡推荐', body: '今天讲护肤顺序', tags: ['育儿日常'] });
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => f.type).sort()).toEqual(['title_body_mismatch', 'unrelated_tag']);
    expect(r.findings.every((f) => f.requiresHumanReview && f.confidence === 'low')).toBe(true);
  });
  it('can fail (deterministic trigger) so partial results are testable', () => {
    expect(mockContextual({ body: 'MOCK_AI_FAIL' }).ok).toBe(false);
  });
});
