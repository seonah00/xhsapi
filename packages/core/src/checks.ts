import { AppError, checkInputHash, type CheckSections } from '@xhs/domain';
import { z } from 'zod';
import { notFound, type Ctx, type ServiceRunner as Runner } from './context.ts';
import { FactSheet, getVersion, sectionsOf } from './plans.ts';

export const BUILTIN_RULES_VERSION = 'builtin-v1';
export const MAX_CHECK_CHARS = 10_000;

export const CheckInput = z.object({
  sections: z.object({
    title: z.string().max(100).default(''),
    cover: z.string().max(100).default(''),
    body: z.string().max(MAX_CHECK_CHARS).default(''),
    tags: z.array(z.string().max(40)).max(30).default([]),
    subtitles: z.string().max(20_030).default(''),
  }).default({}),
  facts: FactSheet.default({}),
});

type Field = 'title' | 'cover' | 'body' | 'tags' | 'subtitles';
const FIELDS: Field[] = ['title', 'cover', 'body', 'tags', 'subtitles'];

export type Finding = {
  fieldKey: Field | 'document';
  start: number | null;
  end: number | null;
  type: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  confidence: 'high' | 'medium' | 'low';
  originalSpan: string | null;
  rationaleKo: string;
  suggestionZh: string | null;
  ruleKey: string | null;
  ruleId: string | null;
  sourceClass: string | null;
  reviewOverdue: boolean;
  requiresHumanReview: boolean;
  layer: 'rule' | 'builtin' | 'contextual';
  anchored: boolean;
};

type Rule = { id: string; rule_key: string; version: number; source_class: string; scope: { fields?: string[] }; match_config: { type: 'exact_phrase' | 'keyword'; value: string };
  finding_type: string; severity: Finding['severity']; rationale: string; suggestion_zh: string | null; review_due_at: Date | null };

/** Tags are checked as one text: tags joined by a single space; offsets refer to that string. */
export function fieldText(s: CheckSections, f: Field): string {
  return f === 'tags' ? (s.tags ?? []).join(' ') : (s[f] ?? '');
}

const PHONE = /(?<!\d)(?:1[3-9]\d{9}|01[016789]-?\d{3,4}-?\d{4})(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NAMED_SCHOOL = /[一-龥]{2,8}(?:幼儿园|小学|中学|学校)/g;
const SPONSOR_MARK = /(合作|广告|赞助|品牌方|推广)/;

function all(re: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
}

/** Layer 1: versioned rules + builtin detectors. Offsets are UTF-16 indices (JS string indices). */
export function runRules(sections: CheckSections, facts: FactSheet, rules: Rule[], now = new Date()): Finding[] {
  const out: Finding[] = [];
  for (const rule of rules) {
    const scope = rule.scope.fields ?? FIELDS;
    for (const f of FIELDS) {
      if (!scope.includes(f)) continue;
      const text = fieldText(sections, f);
      const needle = rule.match_config.value;
      const hay = rule.match_config.type === 'keyword' ? text.toLowerCase() : text;
      const n = rule.match_config.type === 'keyword' ? needle.toLowerCase() : needle;
      let from = 0;
      for (;;) {
        const i = hay.indexOf(n, from);
        if (i < 0) break;
        out.push({
          fieldKey: f, start: i, end: i + needle.length, type: rule.finding_type, severity: rule.severity, confidence: 'medium',
          originalSpan: text.slice(i, i + needle.length), rationaleKo: rule.rationale, suggestionZh: rule.suggestion_zh,
          ruleKey: `${rule.rule_key}@${rule.version}`, ruleId: rule.id, sourceClass: rule.source_class,
          reviewOverdue: !!rule.review_due_at && rule.review_due_at < now, requiresHumanReview: rule.severity === 'high', layer: 'rule', anchored: true,
        });
        from = i + needle.length;
      }
    }
  }
  const builtin = (f: Field, m: RegExpExecArray, type: string, severity: Finding['severity'], rationaleKo: string): Finding => ({
    fieldKey: f, start: m.index, end: m.index + m[0].length, type, severity, confidence: 'high', originalSpan: m[0], rationaleKo,
    suggestionZh: null, ruleKey: BUILTIN_RULES_VERSION, ruleId: null, sourceClass: 'builtin', reviewOverdue: false, requiresHumanReview: severity === 'high', layer: 'builtin', anchored: true,
  });
  const factText = [facts.subject, ...facts.confirmedFacts, facts.price ?? '', facts.usagePeriod ?? '', facts.visitDate ?? '', facts.results ?? ''].join(' ');
  const factNumbers = new Set(factText.match(/\d+(?:\.\d+)?/g) ?? []);
  for (const f of FIELDS) {
    const text = fieldText(sections, f);
    for (const m of all(PHONE, text)) out.push(builtin(f, m, 'personal_information', 'high', '전화번호로 보이는 개인정보입니다. 공개 게시물에서 지우세요.'));
    for (const m of all(EMAIL, text)) out.push(builtin(f, m, 'personal_information', 'high', '이메일 주소로 보이는 개인정보입니다.'));
    for (const m of all(NAMED_SCHOOL, text)) out.push(builtin(f, m, 'child_privacy', 'medium', '아이의 학교·기관 이름은 위치를 특정할 수 있습니다. 일반 명칭으로 바꾸는 것을 권합니다.'));
    if (f === 'title' || f === 'body' || f === 'cover') {
      const pii = out.filter((x) => x.fieldKey === f && x.type === 'personal_information');
      for (const m of all(/\d+(?:\.\d+)?/g, text.replace(/^\s*\d+\.\s/gm, (s) => ' '.repeat(s.length)))) {
        // Digits inside a phone number are already reported as personal information.
        if (pii.some((p) => m.index < p.end! && m.index + m[0].length > p.start!)) continue;
        if (!factNumbers.has(m[0])) out.push({ ...builtin(f, m, 'source_uncertain', 'low', '사실 입력에 없는 숫자입니다. 가격·기간·결과라면 근거를 확인하세요.'), confidence: 'low' });
      }
    }
  }
  const doc = (type: string, severity: Finding['severity'], rationaleKo: string): Finding => ({
    fieldKey: 'document', start: null, end: null, type, severity, confidence: 'high', originalSpan: null, rationaleKo, suggestionZh: null,
    ruleKey: BUILTIN_RULES_VERSION, ruleId: null, sourceClass: 'builtin', reviewOverdue: false, requiresHumanReview: true, layer: 'builtin', anchored: false,
  });
  if (facts.sponsorship === 'yes' && !SPONSOR_MARK.test([sections.title, sections.body, sections.cover].join(' '))) {
    out.push(doc('sponsorship_review_needed', 'medium', '광고·협찬이라고 입력했지만 본문에 표시가 없습니다. 표시 방법을 확인하세요.'));
  }
  if (facts.sponsorship === 'unknown') out.push({ ...doc('sponsorship_review_needed', 'info', '광고·협찬 여부가 “미확인”입니다. 게시 전에 확인하세요.'), requiresHumanReview: false });
  return out;
}

export type CheckRunView = {
  id: string; status: string; contentHash: string; rulesVersion: string; completeness: Record<string, string>; planVersionId: string | null;
  createdAt: string; findings: Finding[]; dataMode: string;
};

async function activeRules(ctx: Ctx): Promise<Rule[]> {
  return (await ctx.db.query<Rule>(
    `select id, rule_key, version, source_class, scope, match_config, finding_type, severity, rationale, suggestion_zh, review_due_at
     from check_rules where status in ('active', 'review_overdue') and (org_id is null or org_id = $1)`, [ctx.orgId],
  )).rows;
}

/**
 * Runs the rule layer immediately and stores an immutable check run (server-owned write).
 * When a plan version is given, the input must be exactly that version (hash match).
 */
export async function runCheck(ctx: Ctx, service: Runner, input: unknown, planRef?: { planId: string; versionId: string }): Promise<string> {
  let data = CheckInput.parse(input);
  if (planRef) {
    const v = await getVersion(ctx, planRef.planId, planRef.versionId);
    data = CheckInput.parse({ sections: sectionsOf(v.content), facts: v.facts });
    if (checkInputHash(data.sections, data.facts, data.facts.sponsorship) !== v.checkInputHash) throw new AppError('CONFLICT', '검사 입력이 선택한 버전과 다릅니다.');
  }
  const total = FIELDS.reduce((n, f) => n + fieldText(data.sections, f).length, 0);
  if (total > MAX_CHECK_CHARS) throw new AppError('VALIDATION_FAILED', `검사할 텍스트는 최대 ${MAX_CHECK_CHARS.toLocaleString()}자입니다.`);
  const rules = await activeRules(ctx);
  const findings = runRules(data.sections, data.facts, rules);
  const hash = checkInputHash(data.sections, data.facts, data.facts.sponsorship);
  const rulesVersion = `${BUILTIN_RULES_VERSION}+${rules.map((r) => `${r.rule_key}@${r.version}`).sort().join(',')}`.slice(0, 500);
  return service(async (db) => {
    const id = (await db.query<{ id: string }>(
      `insert into check_runs (org_id, owner_user_id, plan_version_id, content_hash, rules_version, status, completeness_json, data_mode)
       values ($1, $2, $3, $4, $5, 'completed', $6, $7) returning id`,
      [ctx.orgId, ctx.uid, planRef?.versionId ?? null, hash, rulesVersion, { rules: 'completed', contextual: 'not_requested' }, ctx.mode],
    )).rows[0]!.id;
    for (const f of findings) {
      await db.query(
        `insert into check_findings (check_run_id, field_key, start_utf16, end_utf16, finding_type, severity, confidence, rule_id, anchored, finding_json)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, f.fieldKey, f.start, f.end, f.type, f.severity, f.confidence, f.ruleId, f.anchored, f],
      );
    }
    return id;
  });
}

export async function getCheck(ctx: Ctx, id: string): Promise<CheckRunView> {
  const r = (await ctx.db.query(`select * from check_runs where id = $1 and org_id = $2`, [id, ctx.orgId])).rows[0];
  if (!r) notFound();
  const findings = (await ctx.db.query(`select finding_json from check_findings where check_run_id = $1 order by field_key, start_utf16 nulls first, id`, [id])).rows.map((x) => x.finding_json as Finding);
  return { id: r.id, status: r.status, contentHash: r.content_hash, rulesVersion: r.rules_version, completeness: r.completeness_json, planVersionId: r.plan_version_id, createdAt: r.created_at.toISOString(), findings, dataMode: r.data_mode };
}

export async function checksForVersion(ctx: Ctx, versionId: string): Promise<CheckRunView[]> {
  const ids = (await ctx.db.query<{ id: string }>(`select id from check_runs where plan_version_id = $1 and owner_user_id = $2 order by created_at desc limit 5`, [versionId, ctx.uid])).rows;
  return Promise.all(ids.map((r) => getCheck(ctx, r.id)));
}

/** Marks contextual (AI) layer as requested; the job fills it in or leaves the run partial. */
export async function markContextualRequested(service: Runner, checkRunId: string): Promise<void> {
  await service((db) => db.query(
    `update check_runs set status = 'partial', completeness_json = completeness_json || '{"contextual":"queued"}' where id = $1`, [checkRunId],
  ));
}

/** Mock contextual layer (no AI): document-level heuristics, all requiring human review. */
export function mockContextual(sections: CheckSections): { ok: boolean; findings: Finding[] } {
  if ((sections.body ?? '').includes('MOCK_AI_FAIL')) return { ok: false, findings: [] };
  const findings: Finding[] = [];
  const title = sections.title ?? '';
  const body = sections.body ?? '';
  const bigrams = [...title].slice(0, -1).map((c, i) => c + [...title][i + 1]).filter((b) => /[一-龥]{2}/.test(b));
  const base = { fieldKey: 'document' as const, start: null, end: null, originalSpan: null, suggestionZh: null, ruleKey: 'mock-contextual-v1', ruleId: null, sourceClass: 'ai_opinion',
    reviewOverdue: false, requiresHumanReview: true, layer: 'contextual' as const, anchored: false, confidence: 'low' as const };
  if (title && bigrams.length && !bigrams.some((b) => body.includes(b))) {
    findings.push({ ...base, type: 'title_body_mismatch', severity: 'low', rationaleKo: '제목의 핵심 단어가 본문에 보이지 않습니다. 제목이 약속한 내용을 본문에서 다루는지 확인하세요.' });
  }
  for (const tag of sections.tags ?? []) {
    const t = tag.replace(/^#/, '');
    const chars = [...t].filter((c) => /[一-龥]/.test(c));
    if (chars.length >= 2 && !chars.some((c) => (title + body).includes(c))) {
      findings.push({ ...base, type: 'unrelated_tag', severity: 'info', rationaleKo: `태그 “${tag}”가 제목·본문과 관련이 약해 보입니다. 관련 있는 태그만 쓰세요.` });
    }
  }
  return { ok: true, findings };
}

export const CHECK_DISCLAIMER = '현재 검사 범위에서 위험 표현을 찾지 못했습니다. 게시 승인이나 법적 안전을 보장하지 않습니다.';

/**
 * Applies one rule suggestion to the working draft, only if the flagged span is
 * still at the same place. Returns before/after for display; older versions remain for undo.
 */
export async function applySuggestion(ctx: Ctx, planId: string, checkId: string, findingIndex: number, revision: number): Promise<{ before: string; after: string; field: string }> {
  const { getPlan, saveDraft } = await import('./plans.ts');
  const check = await getCheck(ctx, checkId);
  const f = check.findings[findingIndex];
  if (!f || !f.suggestionZh || !f.anchored || f.start === null || f.end === null || !['title', 'cover', 'body', 'subtitles'].includes(f.fieldKey)) {
    throw new AppError('VALIDATION_FAILED', '적용할 수 있는 수정 제안이 없습니다.');
  }
  const plan = await getPlan(ctx, planId);
  const field = f.fieldKey as 'title' | 'cover' | 'body' | 'subtitles';
  const text = plan.draft.content[field];
  if (text.slice(f.start, f.end) !== f.originalSpan) throw new AppError('CONFLICT', '초안이 바뀌어 이 제안을 자동 적용할 수 없습니다. 직접 수정하세요.');
  const after = text.slice(0, f.start) + f.suggestionZh + text.slice(f.end);
  await saveDraft(ctx, planId, { content: { ...plan.draft.content, [field]: after }, facts: plan.draft.facts }, revision);
  return { before: text, after, field };
}
