import { withAdmin } from '../forbidden-guard';
import { recoverLinks } from './actions';
import { PendingButton } from '@/components/pending-button';
import { Card, ErrorNotice, PageHeader, btn } from '@/components/ui';
import { z } from 'zod';

export const metadata={title:'기존 원문 링크 복구'};
export default async function OriginalLinks({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const sp=await searchParams;
  const job=await withAdmin(async ctx=>z.string().uuid().safeParse(sp.job).success?(await ctx.db.query(`select id,state,input_ref,result_ref from app_jobs where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 and kind='note_link_recovery'`,[sp.job,ctx.orgId,ctx.uid,ctx.mode])).rows[0]:null);
  const result=job?.state==='succeeded'?job.result_ref:null;
  const count=(key:string)=>typeof result?.[key]==='number'?result[key]:0;
  const source=job?.input_ref?.source==='detail'?'detail':'search';
  const next=typeof result?.nextOffset==='number'?result.nextOffset:null;
  const pending=!!job&&['queued','running','waiting_external'].includes(job.state);
  return <>
    <PageHeader title="기존 원문 링크 복구" description="Apify에 보관된 완료 결과에서 현재 조직의 동일 게시물 주소만 다시 연결합니다."/>
    <ErrorNotice message={sp.error}/>
    <Card>
      <p>새 수집이나 재실행 없이 기존 결과만 읽습니다. 예산·정기 수집 설정은 변경하지 않습니다. 공유주소는 게시물과 함께 보관하며, 외부 로그인·삭제·주소 변경으로 열리지 않을 수 있습니다.</p>
      {pending && <p role="status" className="my-3">기존 결과 복구 작업 처리 중입니다. <a href={`/admin/original-links?job=${job.id}`} className="underline">진행 상태 새로고침</a></p>}
      {job&&!pending&&!result && <p role="alert">기존 결과를 복구하지 못했습니다. 작업 화면에서 상태를 확인하세요. 자동 재실행하지 않습니다.</p>}
      {result && <p role="status" className="my-3">실행 {count('runs')}개 · 결과 {count('rows')}건 · 동일 게시물 {count('matched')}건 · 새 연결/교체 {count('linked')}건 · 기존 유지 {count('unchanged')}건 · 주소 형식 제외 {count('rejected')}건. {next===null?'이 종류의 보관 결과 확인을 마쳤습니다.':`다음 시작 위치: ${next}`}</p>}
      <form key={`${source}-${next??'start'}`} action={recoverLinks} className="mt-4 flex flex-wrap items-end gap-3">
        <label>보관 결과 종류<select name="source" defaultValue={source} className="block min-h-11 rounded border border-line p-2"><option value="search">검색 결과</option><option value="detail">게시물 상세 결과</option></select></label>
        <label>시작 위치<input name="offset" type="number" min="0" max="10000" defaultValue={next??0} className="block min-h-11 w-28 rounded border border-line p-2"/></label>
        <PendingButton disabled={pending} className={btn.primary}>기존 결과 10개 확인·연결</PendingButton>
      </form>
      <p className="mt-3 text-sm text-muted">한 번에 완료 실행 최대 10개, 실행당 결과 최대 1,000건을 확인합니다. 반복 실행해도 더 오래된 주소로 덮어쓰지 않습니다. 연결 수는 실제 샤오홍슈 열림 성공 수가 아닙니다.</p>
    </Card>
  </>;
}
