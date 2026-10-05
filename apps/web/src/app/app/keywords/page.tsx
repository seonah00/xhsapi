import { redirect } from 'next/navigation';
import { listKeywords, KeywordQuery, toggleSave } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError, safeLocalPath } from '@/server/actions-util';
import { Badge, btn, DemoBadge, Empty, input, selectAuto, Notice, PageHeader } from '@/components/ui';
import { PROVENANCE_LABEL, TOPIC_LABEL, fmtDate, topicLabel } from '@/components/labels';

export const metadata = { title: '해시태그·키워드' };

async function save(f: FormData) {
  'use server';
  const back = safeLocalPath(f.get('back'), '/app/keywords');
  await orRedirectWithError(back, () => withPageCtx((ctx) => toggleSave(ctx, 'keyword', String(f.get('id')))));
  redirect(back);
}

export default async function Keywords({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const parsed = KeywordQuery.safeParse({ q: sp.q || undefined, provenance: sp.provenance || undefined, topic: sp.topic || undefined, days: sp.days || undefined });
  const data = await withPageCtx((ctx) => listKeywords(ctx, parsed.success ? parsed.data : {}));
  const back = `/app/keywords?${new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== 'error'))}`;
  return (
    <>
      <PageHeader title="해시태그·키워드" description="저장된 표본에서 관찰된 횟수입니다. 공식 검색량이나 인기 순위가 아닙니다." />
      <form role="search" className="mb-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="kq">검색</label>
        <input id="kq" name="q" defaultValue={sp.q} placeholder="중국어 또는 한국어 뜻" className={`${input} max-w-xs`} />
        <select name="provenance" defaultValue={sp.provenance ?? ''} className={selectAuto} aria-label="출처">
          <option value="">모든 출처</option>{['observed_tag', 'provider_related_term', 'editorial_seed'].map((p) => <option key={p} value={p}>{PROVENANCE_LABEL[p]}</option>)}
        </select>
        <select name="topic" defaultValue={sp.topic ?? ''} className={selectAuto} aria-label="주제"><option value="">모든 주제</option>{Object.entries(TOPIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="days" defaultValue={sp.days ?? '30'} className={selectAuto} aria-label="관찰 기간"><option value="7">7일</option><option value="14">14일</option><option value="30">30일</option><option value="90">90일</option></select>
        <button className={btn.secondary}>적용</button>
      </form>
      <p className="mb-3 text-xs text-muted">관찰 기간: 최근 {data.windowDays}일 · 표본: 게시물 {data.sampleSize}개 <DemoBadge mode={data.dataMode} /> · 같은 게시물 안에서 반복된 태그는 1회로 셉니다. 본문 문구는 해시태그로 세지 않습니다.</p>
      {data.items.length === 0 ? <Empty title="해당하는 키워드가 없습니다" /> : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((k) => (
            <li key={k.id} className="rounded-2xl border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="zh text-lg font-semibold" lang="zh-CN">{k.kind === 'hashtag' ? '#' : ''}{k.rawText}</p>
                  <p className="text-sm text-muted">{k.meaningKo ?? '뜻 미등록'}</p>
                </div>
                <form action={save}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="back" value={back} /><button className={btn.small} aria-pressed={k.saved}>{k.saved ? '★' : '☆'}</button></form>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone={k.provenance === 'observed_tag' ? 'ok' : k.provenance === 'ai_suggestion' ? 'warn' : 'neutral'}>{PROVENANCE_LABEL[k.provenance]}</Badge>
                {k.topics.map((t) => <Badge key={t}>{topicLabel(t)}</Badge>)}
              </div>
              {k.provenance === 'observed_tag' || k.provenance === 'observed_phrase' ? (
                <p className="mt-2 text-xs text-muted">관찰: 게시물 {k.uniqueNotes}개 / 작성자 {k.uniqueAuthors}명 (표본 {data.sampleSize}개 중) · 최근 관찰 {fmtDate(k.latestObservedAt)}</p>
              ) : (
                <p className="mt-2 text-xs text-muted">{k.provenance === 'editorial_seed' ? '강사·운영자가 고른 학습용 검색 출발점입니다. 관찰 횟수가 아닙니다.' : '공급자가 함께 등장한다고 제시한 연관어입니다. 검색 수요를 뜻하지 않습니다.'}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6"><Notice>고정된 해시태그 개수나 조합이 성공 공식은 아닙니다. 내 콘텐츠와 관련 있는 태그만 쓰세요.</Notice></div>
    </>
  );
}
