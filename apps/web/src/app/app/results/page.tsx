import Link from 'next/link';
import { comparePublications, getQuote, listAccounts, listPublications, listReflections } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { JobStatus } from '@/components/job-status';
import { QuoteConfirm } from '@/components/quote-confirm';
import { Badge, btn, Card, Empty, ErrorNotice, input, label, LinkButton, Notice, PageHeader } from '@/components/ui';
import { FORMAT_LABEL, TOPIC_LABEL, fmtDate, formatLabel, topicLabel } from '@/components/labels';
import { addPublication, confirmReflection, quoteReflection } from './actions';

export const metadata = { title: '성과 기록' };
const nf = new Intl.NumberFormat('ko-KR');
const num = (v: number | null | undefined) => (typeof v === 'number' ? nf.format(v) : '미확인');

export default async function Results({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const groupBy = (['topic', 'format', 'month'] as const).find((g) => g === sp.group) ?? 'format';
  const d = await withPageCtx(async (ctx) => {
    const accounts = await listAccounts(ctx);
    const account = accounts.find((a) => a.id === sp.account) ?? accounts[0] ?? null;
    return {
      accounts, account, mode:ctx.mode,
      pubs: account ? await listPublications(ctx, account.id) : [],
      reflections: account ? await listReflections(ctx, account.id) : [],
      quote: sp.quote ? await getQuote(ctx, sp.quote) : null,
    };
  });
  if (!d.account) return <Empty title="먼저 계정 방향을 설정하세요"><div className="mt-2"><LinkButton href="/app/accounts/new" variant="primary">계정 설정</LinkButton></div></Empty>;
  const cmp = comparePublications(d.pubs, groupBy);
  const withSnap = d.pubs.filter((p) => p.snapshots[0]);
  return (
    <>
      <PageHeader title="성과 기록" description="샤오홍슈에 직접 발행한 게시물과 지표를 기록합니다. 비어 있는 지표는 ‘미확인’이며 0으로 계산하지 않습니다." />
      <ErrorNotice message={sp.error} />
      {d.accounts.length > 1 && (
        <nav aria-label="계정 선택" className="mb-4 flex flex-wrap gap-2">
          {d.accounts.map((a) => <Link key={a.id} href={`/app/results?account=${a.id}`} className={`rounded-full border px-3 py-1 text-sm ${a.id === d.account!.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface'}`}>{a.display_name}</Link>)}
        </nav>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">발행한 게시물</h2>
            {d.pubs.length === 0 ? <div className="mt-2"><Empty title="기록한 게시물이 없습니다">오른쪽에서 게시물을 등록하세요.</Empty></div> : (
              <ul className="mt-2 divide-y divide-line">
                {d.pubs.map((p) => {
                  const s = p.snapshots[0];
                  return (
                    <li key={p.id} className="py-3">
                      <Link href={`/app/results/${p.id}`} className="font-medium underline">{p.title ?? '제목 없음'}</Link>
                      <div className="mt-1 flex flex-wrap gap-1 text-xs">
                        {p.topic && <Badge>{topicLabel(p.topic)}</Badge>}{p.format && <Badge tone="info">{formatLabel(p.format)}</Badge>}
                        {p.paidPromotion === 'yes' && <Badge tone="warn">유료 프로모션</Badge>}{p.sponsorship === 'yes' && <Badge tone="warn">협찬</Badge>}
                        <span className="text-muted">발행 {fmtDate(p.publishedAt)} · 기록 {p.snapshots.length}회</span>
                      </div>
                      {s ? <p className="mt-1 text-sm">좋아요 {num(s.metrics.likes)} · 저장 {num(s.metrics.saves)} · 조회 {num(s.metrics.views)} <span className="text-xs text-muted">({fmtDate(s.observedAt, true)} 관찰)</span></p>
                        : <p className="mt-1 text-sm text-muted">아직 지표 기록이 없습니다.</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">내 계정 안에서 비교</h2>
              <nav aria-label="비교 기준" className="flex gap-1 text-sm">
                {(['format', 'topic', 'month'] as const).map((g) => <Link key={g} href={`/app/results?account=${d.account!.id}&group=${g}`} className={`rounded-lg px-2 py-1 ${g === groupBy ? 'bg-accent-soft text-accent' : 'hover:bg-bg'}`}>{({ format: '형식별', topic: '주제별', month: '월별' })[g]}</Link>)}
              </nav>
            </div>
            {cmp.groups.length === 0 ? <p className="mt-2 text-sm text-muted">비교할 기록이 없습니다.</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 font-normal">그룹</th><th scope="col" className="font-normal">게시물(기록)</th><th scope="col" className="font-normal">좋아요 중앙값</th><th scope="col" className="font-normal">저장 중앙값</th><th scope="col" className="font-normal">저장률</th></tr></thead>
                  <tbody>{cmp.groups.map((g) => (
                    <tr key={g.key} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2 text-left font-medium">{groupBy === 'format' ? FORMAT_LABEL[g.key] ?? g.key : groupBy === 'topic' ? TOPIC_LABEL[g.key] ?? g.key : g.key}</th>
                      <td>{g.posts} ({g.withData})</td><td>{num(g.median.likes)}</td><td>{num(g.median.saves)}</td>
                      <td>{g.saveRate.value === null ? <span className="text-muted">계산 안 함</span> : `${(g.saveRate.value * 100).toFixed(1)}% (${g.saveRate.basis}건)`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">저장률은 같은 기록에 조회수와 저장 수가 모두 있을 때만 계산합니다.</p>
            <ul className="mt-2 space-y-1">{cmp.warnings.map((w) => <li key={w} className="text-xs text-warn">! {w}</li>)}</ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">게시물 등록</h2>
            <form action={addPublication} className="mt-3 space-y-2 text-sm">
              <input type="hidden" name="accountId" value={d.account.id} />
              <p className="text-xs text-muted">기획과 연결하려면 기획의 “최종본 전달” 화면에서 등록하세요.</p>
              <div><label htmlFor="ptitle" className={label}>제목(메모용)</label><input id="ptitle" name="title" maxLength={200} className={input} /></div>
              <div><label htmlFor="noteUrl" className={label}>게시물 링크 (선택)</label><input id="noteUrl" name="noteUrl" type="url" className={input} /></div>
              <div><label htmlFor="publishedAt" className={label}>발행일시</label><input id="publishedAt" name="publishedAt" type="datetime-local" className={input} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label htmlFor="topic" className={label}>주제</label><select id="topic" name="topic" className={input}><option value="">-</option>{Object.entries(TOPIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div><label htmlFor="format" className={label}>형식</label><select id="format" name="format" className={input}><option value="">-</option>{Object.entries(FORMAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div><label htmlFor="sponsorship" className={label}>협찬</label><select id="sponsorship" name="sponsorship" className={input}><option value="unknown">미확인</option><option value="no">아님</option><option value="yes">협찬</option></select></div>
                <div><label htmlFor="paidPromotion" className={label}>유료 프로모션</label><select id="paidPromotion" name="paidPromotion" className={input}><option value="unknown">미확인</option><option value="no">안 함</option><option value="yes">함</option></select></div>
              </div>
              <button className={btn.primary}>등록</button>
            </form>
          </Card>

          <Card>
            <h2 id="reflect" className="font-semibold">회고 제안 <Badge tone={d.mode==='mock'?'warn':'info'}>{d.mode==='mock'?'데모 · AI 아님':'AI 텍스트 회고'}</Badge></h2>
            <p className="mt-1 text-xs text-muted">고른 본인 게시물의 최신 기록만 사용해 다음 촬영에서 검증할 가설을 만듭니다. 계정 방향은 자동으로 바뀌지 않습니다.</p>
            {sp.confirm && d.quote ? (
              <div className="mt-3"><QuoteConfirm quote={d.quote} title="회고 제안 확인" action={confirmReflection} hidden={{ accountId: d.account.id, ids: sp.ids ?? '' }} cancelHref={`/app/results?account=${d.account.id}`}
                scopeLines={[`대상: 선택한 게시물 ${(sp.ids ?? '').split(',').filter(Boolean).length}개의 최신 기록`, d.mode==='mock'?'외부 AI 호출 없음(데모 규칙)':'제목·주제·형식·수치·발행/관찰 시점·프로모션/협찬 정보를 OpenAI로 전송합니다.']} /></div>
            ) : withSnap.length === 0 ? <p className="mt-2 text-sm text-muted">지표가 기록된 게시물이 필요합니다.</p> : (
              <form action={quoteReflection} className="mt-3 space-y-1 text-sm">
                <input type="hidden" name="accountId" value={d.account.id} />
                {withSnap.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="snapshotIds" value={p.snapshots[0]!.id} defaultChecked /> {p.title ?? '제목 없음'}</label>)}
                <button className={`${btn.secondary} mt-2`}>회고 제안 받기</button>
              </form>
            )}
            {sp.job && <div className="mt-3"><JobStatus jobId={sp.job} label="회고" /></div>}
            {d.reflections.map((r) => (
              <div key={r.id} className="mt-3 rounded-xl bg-bg p-3 text-sm">
                <p className="text-xs text-muted">{fmtDate(r.createdAt, true)} · 게시물 {r.output.basedOn.posts}개 기준</p>
                <ul className="mt-1 list-disc pl-5">{r.output.observations.map((o) => <li key={o}>{o}</li>)}</ul>
                <p className="mt-1 font-medium">검증할 가설</p><ul className="list-disc pl-5">{r.output.hypotheses.map((h) => <li key={h}>{h}</li>)}</ul>
                {r.output.experiments?.map((e,i)=><div key={i} className="mt-3 rounded-lg border border-line p-2"><p className="font-medium">다음 실험 {i+1}: {e.change}</p><p>유지할 조건: {e.keepConstant}</p><p>측정 지표: {e.measure}</p><p>기록 시점: {e.when}</p><p className="text-xs text-muted">근거: {e.evidenceIds.map(id=>r.output.evidence?.find(x=>x.id===id)?.title??id).join(', ')}</p></div>)}
                <ul className="mt-1 text-xs text-warn">{r.output.limitations.map((l) => <li key={l}>! {l}</li>)}</ul>
              </div>
            ))}
          </Card>
          <Notice>성과 수치는 직접 입력한 값입니다. CSV 가져오기와 자동 연동은 이후 단계에서 지원합니다.</Notice>
        </div>
      </div>
    </>
  );
}
