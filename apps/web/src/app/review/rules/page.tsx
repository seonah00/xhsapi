import { redirect } from 'next/navigation';
import { createRule, listRules, reviewRule } from '@xhs/core';
import { withStaff } from '@/server/staff';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, ErrorNotice, input, label, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { FIELD_LABEL, FINDING_LABEL, SEVERITY } from '@/components/plan-labels';

export const metadata = { title: '점검 규칙' };
const SOURCE: Record<string, string> = { test_editorial: '테스트용 편집 규칙', instructor_editorial: '강사 편집 권고', official_policy: '공식 정책', law: '법령', provider_list: '공급자 목록' };

async function create(f: FormData) {
  'use server';
  const opt = (k: string) => String(f.get(k) ?? '').trim() || undefined;
  await orRedirectWithError('/review/rules', () => withStaff((ctx) => createRule(ctx, {
    ruleKey: String(f.get('ruleKey') ?? ''), matchType: String(f.get('matchType')), value: String(f.get('value') ?? ''), fields: f.getAll('fields').map(String),
    findingType: String(f.get('findingType')), severity: String(f.get('severity')), rationale: String(f.get('rationale') ?? ''), suggestionZh: opt('suggestionZh'),
    sourceClass: String(f.get('sourceClass')), sourceUrl: opt('sourceUrl'), sourceDate: opt('sourceDate'),
  })));
  redirect('/review/rules');
}
async function decide(f: FormData) {
  'use server';
  await orRedirectWithError('/review/rules', () => withStaff((ctx) => reviewRule(ctx, String(f.get('id')), String(f.get('decision')) as never)));
  redirect('/review/rules');
}

export default async function Rules({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const rules = await withStaff((ctx) => listRules(ctx));
  return (
    <>
      <PageHeader title="점검 규칙" description="규칙은 문자열 일치(정확한 문구·키워드)만 지원합니다. 정규식·코드는 허용하지 않습니다. 검토 주기 30일." />
      <ErrorNotice message={error} />
      <div className="mb-4"><Notice tone="warn">타사 금지어 사전을 복제하지 마세요. 공식 정책·법령 규칙은 출처 URL·날짜가 있어야 활성화할 수 있습니다. 규칙 통과는 게시 승인이 아닙니다.</Notice></div>
      <Card className="mb-6">
        <h2 className="font-semibold">새 규칙 (초안)</h2>
        <form action={create} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="ruleKey" className={label}>규칙 키 (영문 소문자·숫자·하이픈)</label><input id="ruleKey" name="ruleKey" required pattern={"[a-z0-9\\-]{3,40}"} className={input} /></div>
          <div><label htmlFor="value" className={label}>찾을 문구 (최대 100자)</label><input id="value" name="value" required maxLength={100} className={`${input} zh`} /></div>
          <div><label htmlFor="matchType" className={label}>일치 방식</label><select id="matchType" name="matchType" className={input}><option value="keyword">키워드(대소문자 무시)</option><option value="exact_phrase">정확한 문구</option></select></div>
          <fieldset className="text-sm"><legend className={label}>적용 필드</legend>
            <div className="flex flex-wrap gap-2">{(['title', 'cover', 'body', 'tags', 'subtitles'] as const).map((k) => <label key={k}><input type="checkbox" name="fields" value={k} defaultChecked={k === 'title' || k === 'body'} /> {FIELD_LABEL[k]}</label>)}</div></fieldset>
          <div><label htmlFor="findingType" className={label}>탐지 유형</label><select id="findingType" name="findingType" className={input}>
            {['absolute_or_exaggerated_claim', 'unsupported_health_claim', 'sponsorship_review_needed', 'personal_information', 'child_privacy', 'language_awkwardness', 'source_uncertain'].map((t) => <option key={t} value={t}>{FINDING_LABEL[t]}</option>)}</select></div>
          <div><label htmlFor="severity" className={label}>심각도</label><select id="severity" name="severity" className={input}>{Object.entries(SEVERITY).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="sm:col-span-2"><label htmlFor="rationale" className={label}>설명 (학생에게 보이는 이유)</label><textarea id="rationale" name="rationale" required minLength={5} maxLength={500} rows={2} className={input} /></div>
          <div><label htmlFor="suggestionZh" className={label}>수정 제안 (중국어, 선택)</label><input id="suggestionZh" name="suggestionZh" maxLength={100} className={`${input} zh`} /></div>
          <div><label htmlFor="sourceClass" className={label}>출처 등급</label><select id="sourceClass" name="sourceClass" className={input}><option value="instructor_editorial">강사 편집 권고</option><option value="official_policy">공식 정책</option><option value="law">법령</option></select></div>
          <div><label htmlFor="sourceUrl" className={label}>출처 URL</label><input id="sourceUrl" name="sourceUrl" type="url" className={input} /></div>
          <div><label htmlFor="sourceDate" className={label}>출처 날짜</label><input id="sourceDate" name="sourceDate" type="date" className={input} /></div>
          <div className="sm:col-span-2"><button className={btn.primary}>초안 저장</button></div>
        </form>
      </Card>
      <ul className="space-y-2">
        {rules.map((r) => {
          const [sev, tone] = SEVERITY[r.severity] ?? ['?', 'neutral' as const];
          return (
            <li key={r.id} className="rounded-2xl border border-line bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs">{r.ruleKey}@{r.version}</span>
                <Badge tone={r.status === 'active' ? 'ok' : r.status === 'draft' ? 'neutral' : 'warn'}>{({ active: '활성', draft: '초안', retired: '폐기', review_overdue: '검토 지남' } as Record<string, string>)[r.status]}</Badge>
                {r.overdue && r.status === 'active' && <Badge tone="warn">검토 기한 지남</Badge>}
                <Badge tone={tone}>{sev}</Badge><Badge>{SOURCE[r.sourceClass] ?? r.sourceClass}</Badge>{!r.orgOwned && <Badge>기본 제공</Badge>}
              </div>
              <p className="mt-1"><span className="zh font-medium">“{r.value}”</span> <span className="text-muted">({r.matchType === 'keyword' ? '키워드' : '정확한 문구'} · {r.fields.map((f) => FIELD_LABEL[f]).join(', ')}) → {FINDING_LABEL[r.findingType]}</span></p>
              <p className="text-muted">{r.rationale}</p>
              <p className="text-xs text-muted">검토 {fmtDate(r.reviewedAt)} · 다음 검토 {fmtDate(r.reviewDueAt)}{r.sourceUrl && ` · 출처 ${r.sourceUrl}`}</p>
              {r.orgOwned && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.status === 'draft' && <form action={decide}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="activate" /><button className={btn.small}>검토 후 활성화</button></form>}
                  {r.status === 'active' && <form action={decide}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reviewed" /><button className={btn.small}>다시 검토함(+30일)</button></form>}
                  {r.status !== 'retired' && <form action={decide}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="retire" /><button className={btn.ghost}>폐기</button></form>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
