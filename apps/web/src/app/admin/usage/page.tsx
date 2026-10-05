import { redirect } from 'next/navigation';
import { orgOps, reconcileUsage, setDailyLimits, setMonthlyBudget, usageSummary } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, ErrorNotice, input, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '사용량·한도' };

async function saveLimits(f: FormData) {
  'use server';
  await orRedirectWithError('/admin/usage', () => withAdmin((ctx) => setDailyLimits(ctx, { provider_search: Number(f.get('provider_search')), ai: Number(f.get('ai')), transcript: Number(f.get('transcript')) }, Number(f.get('revision')))));
  redirect('/admin/usage?saved=1');
}
async function saveBudget(f: FormData) {
  'use server';
  await orRedirectWithError('/admin/usage', () => withAdmin((ctx) => setMonthlyBudget(ctx, { currency: String(f.get('currency')), amount: String(f.get('amount')), month: String(f.get('month')) })));
  redirect('/admin/usage?saved=1');
}
async function reconcile(f: FormData) {
  'use server';
  await orRedirectWithError('/admin/usage', () => withAdmin((ctx) => reconcileUsage(ctx, { ledgerId: String(f.get('id')), outcome: String(f.get('outcome')), actualAmount: String(f.get('actual') ?? '') || undefined, evidence: String(f.get('evidence') ?? '') })));
  redirect('/admin/usage?saved=1');
}

export default async function Usage({ searchParams }: { searchParams: Promise<{ month?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : new Date().toISOString().slice(0, 7);
  const d = await withAdmin(async (ctx) => ({ s: await usageSummary(ctx, month), ops: await orgOps(ctx.db, ctx.orgId) }));
  const table = (rows: typeof d.s.demo) => rows.length === 0 ? <p className="text-sm text-muted">기록 없음</p> : (
    <table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-1 font-normal">작업</th><th scope="col" className="font-normal">상태</th><th scope="col" className="font-normal">횟수</th><th scope="col" className="font-normal">예약</th><th scope="col" className="font-normal">확정</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0"><td className="py-1">{r.endpoint}</td><td>{r.status}</td><td>{r.calls}</td><td className="tabular-nums">{r.reserved} {r.currency}</td><td className="tabular-nums">{r.actual} {r.currency}</td></tr>)}</tbody></table>
  );
  return (
    <>
      <PageHeader title="사용량·한도" description="학생 문안 없이 집계만 보여줍니다. 데모 사용량은 실제 비용 통계와 분리됩니다." />
      <ErrorNotice message={sp.error} />
      {sp.saved && <div className="mb-3"><Notice tone="ok">저장했습니다.</Notice></div>}
      <form className="mb-4 flex items-center gap-2 text-sm"><label htmlFor="month">월</label><input id="month" name="month" type="month" defaultValue={month} className="rounded-lg border border-line bg-surface px-2 py-1" /><button className={btn.small}>보기</button></form>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="font-semibold">실제 비용 사용 <Badge tone="accent">live</Badge></h2><div className="mt-2 overflow-x-auto">{table(d.s.real)}</div></Card>
        <Card><h2 className="font-semibold">데모 사용 <Badge tone="warn">비용 0</Badge></h2><div className="mt-2 overflow-x-auto">{table(d.s.demo)}</div></Card>
        <Card>
          <h2 className="font-semibold">월 live 예산</h2>
          {d.s.budgets.length === 0 ? <p className="mt-2 text-sm text-muted">설정된 예산이 없습니다(= 0, live 호출 불가).</p> : (
            <ul className="mt-2 space-y-1 text-sm">{d.s.budgets.map((b) => <li key={b.id}>{b.currency}: 한도 {b.limit} · 예약 {b.reserved} · 확정 {b.settled}</li>)}</ul>
          )}
          <form action={saveBudget} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="month" value={month} />
            <label>통화<select name="currency" className="ml-1 rounded-lg border border-line bg-surface px-2 py-1"><option>CNY</option><option>KRW</option><option>USD</option></select></label>
            <label>한도<input name="amount" inputMode="decimal" pattern={"\\d{1,12}(\\.\\d{1,8})?"} required className={`${input} ml-1 w-32`} /></label>
            <button className={btn.secondary}>저장</button>
          </form>
          <p className="mt-2 text-xs text-muted">통화별로 따로 관리합니다. 이미 예약·확정된 금액보다 낮출 수 없습니다.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">학생 1인 하루 한도</h2>
          <form action={saveLimits} className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <input type="hidden" name="revision" value={d.ops.revision} />
            <label>외부 검색<input name="provider_search" type="number" min={0} max={100} defaultValue={d.ops.limits.provider_search} className={`${input} mt-1`} /></label>
            <label>AI 작업<input name="ai" type="number" min={0} max={100} defaultValue={d.ops.limits.ai} className={`${input} mt-1`} /></label>
            <label>음성 문안<input name="transcript" type="number" min={0} max={100} defaultValue={d.ops.limits.transcript} className={`${input} mt-1`} /></label>
            <div className="col-span-3"><button className={btn.secondary}>저장</button></div>
          </form>
        </Card>
      </div>
      <Card className="mt-4">
        <h2 className="font-semibold">결과 불명 호출 정산</h2>
        <p className="mt-1 text-xs text-muted">시간 초과 등으로 실행 여부를 모르는 유료 호출입니다. 공급자 과금 내역을 확인한 뒤에만 정산하세요. 확인 없이 무료로 처리하지 않습니다.</p>
        {d.s.unknown.length === 0 ? <p className="mt-2 text-sm text-muted">없음</p> : (
          <ul className="mt-2 space-y-2">{d.s.unknown.map((u) => (
            <li key={u.id} className="rounded-xl bg-bg p-3 text-sm">
              <p>{u.endpoint} · 예약 {u.reserved} {u.currency} · {fmtDate(u.at, true)}</p>
              <form action={reconcile} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                <input type="hidden" name="id" value={u.id} />
                <label>결과<select name="outcome" className="ml-1 rounded-lg border border-line bg-surface px-2 py-1"><option value="settled">과금됨</option><option value="released">과금 안 됨(확인)</option></select></label>
                <label>실제 금액<input name="actual" inputMode="decimal" className="ml-1 w-24 rounded-lg border border-line bg-surface px-2 py-1" /></label>
                <label>증빙(확인 경로)<input name="evidence" required minLength={5} className="ml-1 w-64 rounded-lg border border-line bg-surface px-2 py-1" /></label>
                <button className={btn.small}>정산</button>
              </form>
            </li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
