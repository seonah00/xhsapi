import Link from 'next/link';
import { redirect } from 'next/navigation';
import { keywordTrackingHistory, saveKeywordTracking } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { service } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { btn, Card, ErrorNotice, input, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
const back='/admin/keyword-tracking';
async function save(form:FormData) {
  'use server';
  await orRedirectWithError(back,()=>withAdmin(ctx=>saveKeywordTracking(ctx,service,{term:String(form.get('term')??''),intervalDays:Number(form.get('intervalDays')),enabled:form.get('enabled')==='on',approvedUntil:new Date(String(form.get('until'))+'T23:59:59+09:00').toISOString()})));
  redirect(back);
}
export default async function TrackingAdmin({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const rows=await withAdmin(keywordTrackingHistory);
  const {error}=await searchParams;
  return <><PageHeader title="공용 키워드 정기 수집" description="조직 공용 결과를 재사용합니다. 실행 승인은 최대 31일이며 월 예산·검색 한도·공급자 스위치가 함께 적용됩니다." actions={<Link href="/app/discover/trends" className={btn.secondary}>수강생 추이 화면</Link>}/>
    <ErrorNotice message={error}/>
    <Card><h2 className="font-semibold">키워드 등록</h2><form action={save} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label>중국어 검색어<input className={input} name="term" maxLength={50} required/></label>
      <label>수집 주기<select className={input} name="intervalDays" defaultValue="7"><option value="1">매일</option><option value="7">매주</option><option value="30">30일마다</option></select></label>
      <label>승인 종료일<input className={input} type="date" name="until" required/></label>
      <label className="flex items-center gap-2"><input type="checkbox" name="enabled"/>승인 기간 내 반복 수집 비용에 동의하고 활성화</label>
      <p className="text-sm text-muted">새 검색 1회당 현재 등록된 견적을 예약합니다. 공급자·스위치의 건당 상한이 적용됩니다. 등록 직후 첫 수집을 시작하며, 주기 변경은 다음 수집 완료 후 적용됩니다. 중지해도 이미 접수한 작업은 완료·정산됩니다.</p>
      <button className={btn.primary}>키워드 저장</button>
    </form></Card>
    <div className="mt-4 space-y-3">{rows.map(row=><Card key={row.id}><h2 className="font-semibold">{row.term}</h2><p className="text-sm">{row.enabled?'활성':'중지'} · {row.state} · {row.intervalDays}일 주기 · 집계 {row.snapshots.length}회</p><p className="text-sm">다음 예정 {fmtDate(row.nextRunAt,true)} · 승인 종료 {fmtDate(row.approvedUntil,true)}</p><form action={save} className="mt-2 flex flex-wrap items-end gap-3"><input type="hidden" name="term" value={row.term}/><input type="hidden" name="intervalDays" value={row.intervalDays}/><label>승인 종료일<input type="date" className={input} name="until" defaultValue={new Date(Date.parse(row.approvedUntil)+9*3600000).toISOString().slice(0,10)} required/></label><label><input type="checkbox" name="enabled" defaultChecked={row.enabled}/>반복 수집 승인</label><button className={btn.secondary}>변경 저장</button></form></Card>)}</div>
    <p className="mt-4 text-sm text-muted">실패·결과 불명·예산 부족은 자동 재시도하지 않고 중지합니다. 원인을 해결한 뒤 관리자가 다시 승인하세요. 같은 결과 불명 작업은 다시 실행하지 않습니다.</p>
  </>;
}
