import { redirect } from 'next/navigation';
import { deletePersonalExpression, explainSentence, ExpressionQuery, listExpressions, toggleSave } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, DemoBadge, Empty, ErrorNotice, input, selectAuto, PageHeader } from '@/components/ui';
import { EXPR_TYPE_LABEL, TOPIC_LABEL, topicLabel } from '@/components/labels';

export const metadata = { title: '중국어 표현 사전' };
const TONE: Record<string, string> = { friendly: '친근', informative: '정보형', humor: '유머', plain: '담백' };

async function save(f: FormData) {
  'use server';
  await orRedirectWithError('/app/expressions', () => withPageCtx((ctx) => toggleSave(ctx, 'expression', String(f.get('id')))));
  redirect(String(f.get('back') ?? '/app/expressions'));
}
async function remove(f: FormData) {
  'use server';
  await orRedirectWithError('/app/expressions', () => withPageCtx((ctx) => deletePersonalExpression(ctx, String(f.get('id')))));
  redirect('/app/expressions?scope=mine');
}

export default async function Expressions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const parsed = ExpressionQuery.safeParse({ q: sp.q || undefined, tone: sp.tone || undefined, topic: sp.topic || undefined, scope: sp.scope || undefined });
  const { items, explained } = await withPageCtx(async (ctx) => ({
    items: await listExpressions(ctx, parsed.success ? parsed.data : {}),
    explained: sp.sentence ? await explainSentence(ctx, sp.sentence.slice(0, 500)) : null,
  }));
  const back = `/app/expressions?${new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== 'error'))}`;
  return (
    <>
      <PageHeader title="중국어 표현 사전" description="검수된 공통 사전과 내 표현장(미검수)을 구분해 보여줍니다." />
      <ErrorNotice message={sp.error} />
      <Card className="mb-4">
        <h2 className="font-semibold">내 문장에 적용</h2>
        <form className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="sentence">내 중국어 문장</label>
          <input id="sentence" name="sentence" defaultValue={sp.sentence} maxLength={500} placeholder="예: 姐妹们，这个面霜我亲测好用" className={`${input} zh flex-1`} />
          <button className={btn.secondary}>표현 확인</button>
        </form>
        {explained && (
          <div className="mt-3 text-sm">
            {explained.matches.length > 0 && (
              <ul className="space-y-1">{explained.matches.map((m, i) => (
                <li key={i}><span className="zh font-semibold">{m.expression}</span> — {m.meaning ?? '뜻 미등록'}{m.nuance && <span className="text-muted"> · {m.nuance}</span>}{m.avoid && <span className="text-warn"> · 피할 상황: {m.avoid}</span>}</li>
              ))}</ul>
            )}
            {explained.notes.map((n) => <p key={n} className="mt-1 text-xs text-muted">{n}</p>)}
          </div>
        )}
      </Card>
      <form role="search" className="mb-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="eq">검색</label>
        <input id="eq" name="q" defaultValue={sp.q} placeholder="한국어·중국어 검색" className={`${input} max-w-xs`} />
        <select name="scope" defaultValue={sp.scope ?? 'all'} className={selectAuto} aria-label="범위"><option value="all">전체</option><option value="dictionary">검수된 사전</option><option value="mine">내 표현장</option><option value="saved">저장한 표현</option></select>
        <select name="tone" defaultValue={sp.tone ?? ''} className={selectAuto} aria-label="말투"><option value="">모든 말투</option>{Object.entries(TONE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="topic" defaultValue={sp.topic ?? ''} className={selectAuto} aria-label="주제"><option value="">모든 주제</option>{Object.entries(TOPIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button className={btn.secondary}>적용</button>
      </form>
      {items.length === 0 ? <Empty title="표현이 없습니다" /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((e) => (
            <li key={e.id} className={`rounded-2xl border bg-surface p-4 ${e.personal ? 'border-dashed border-warn/60' : 'border-line'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="zh text-xl font-semibold" lang="zh-CN">{e.expression}</p>
                <div className="flex gap-1">
                  <form action={save}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="back" value={back} /><button className={btn.small} aria-pressed={e.saved}>{e.saved ? '★ 저장됨' : '☆ 저장'}</button></form>
                  <a href={`/app/plans/new?seed=${encodeURIComponent(e.expression)}`} className={btn.ghost}>기획에 쓰기</a>
                  {e.personal && <form action={remove}><input type="hidden" name="id" value={e.id} /><button className={btn.ghost}>삭제</button></form>}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {e.personal ? <Badge tone="warn">내 표현장 · 미검수</Badge> : <Badge tone="ok">검수됨</Badge>}
                <Badge tone={e.expressionType === 'basic' ? 'neutral' : 'info'}>{EXPR_TYPE_LABEL[e.expressionType]}</Badge>
                {e.tone && <Badge>{TONE[e.tone] ?? e.tone}</Badge>}
                {e.topics.map((t) => <Badge key={t}>{topicLabel(t)}</Badge>)}
                {e.provenance === 'transcript_observed' && <Badge tone="info">음성 문안에서</Badge>}
                <DemoBadge />
              </div>
              <dl className="mt-2 space-y-0.5 text-sm">
                {e.explanations.literal && <div><dt className="inline text-muted">직역 </dt><dd className="inline">{e.explanations.literal}</dd></div>}
                {e.explanations.meaning && <div><dt className="inline text-muted">실제 뜻 </dt><dd className="inline">{e.explanations.meaning}</dd></div>}
                {e.explanations.nuance && <div><dt className="inline text-muted">뉘앙스 </dt><dd className="inline">{e.explanations.nuance}</dd></div>}
                {e.explanations.use && <div><dt className="inline text-muted">쓰는 상황 </dt><dd className="inline">{e.explanations.use}</dd></div>}
                {e.explanations.avoid && <div><dt className="inline text-warn">피할 상황 </dt><dd className="inline">{e.explanations.avoid}</dd></div>}
              </dl>
              {e.explanations.example && <p className="mt-2 text-xs"><Badge>작성 예시</Badge> <span className="zh">{e.explanations.example}</span></p>}
              {e.evidence.map((ev, i) => <p key={i} className="mt-1 text-xs"><Badge tone="info">관찰 사례</Badge> <span className="zh text-muted">{ev.quote}</span></p>)}
              {e.expressionType === 'trend_unverified' && <p className="mt-2 text-xs text-muted">증가를 뒷받침하는 비교 데이터가 없어 “유행”으로 표시하지 않습니다.</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
