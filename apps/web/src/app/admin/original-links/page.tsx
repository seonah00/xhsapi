import { withAdmin } from '../forbidden-guard';
import { recoverLinks } from './actions';
import { PendingButton } from '@/components/pending-button';
import { Card, ErrorNotice, PageHeader, btn } from '@/components/ui';

export const metadata={title:'기존 원문 링크 복구'};
export default async function OriginalLinks({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  await withAdmin(async()=>true);
  const sp=await searchParams;
  const count=(key:string)=>/^\d{1,6}$/.test(sp[key]??'')?Number(sp[key]):0;
  const source=sp.source==='detail'?'detail':'search';
  const next=sp.nextOffset && /^\d{1,5}$/.test(sp.nextOffset)?Number(sp.nextOffset):null;
  return <>
    <PageHeader title="기존 원문 링크 복구" description="Apify에 보관된 완료 결과에서 현재 조직의 동일 게시물 주소만 다시 연결합니다."/>
    <ErrorNotice message={sp.error}/>
    <Card>
      <p>새 수집이나 재실행 없이 기존 결과만 읽습니다. 예산·정기 수집 설정은 변경하지 않습니다. 공유주소는 게시물과 함께 보관하며, 외부 로그인·삭제·주소 변경으로 열리지 않을 수 있습니다.</p>
      {sp.runs!==undefined && <p role="status" className="my-3">실행 {count('runs')}개 · 결과 {count('rows')}건 · 동일 게시물 {count('matched')}건 · 새 연결/교체 {count('linked')}건 · 기존 유지 {count('unchanged')}건 · 주소 형식 제외 {count('rejected')}건. {next===null?'이 종류의 보관 결과 확인을 마쳤습니다.':`다음 시작 위치: ${next}`}</p>}
      <form key={`${source}-${sp.nextOffset??'start'}`} action={recoverLinks} className="mt-4 flex flex-wrap items-end gap-3">
        <label>보관 결과 종류<select name="source" defaultValue={source} className="block min-h-11 rounded border border-line p-2"><option value="search">검색 결과</option><option value="detail">게시물 상세 결과</option></select></label>
        <label>시작 위치<input name="offset" type="number" min="0" max="10000" defaultValue={next??0} className="block min-h-11 w-28 rounded border border-line p-2"/></label>
        <PendingButton className={btn.primary}>기존 결과 10개 확인·연결</PendingButton>
      </form>
      <p className="mt-3 text-sm text-muted">한 번에 완료 실행 최대 10개, 실행당 결과 최대 1,000건을 확인합니다. 반복 실행해도 더 오래된 주소로 덮어쓰지 않습니다. 연결 수는 실제 샤오홍슈 열림 성공 수가 아닙니다.</p>
    </Card>
  </>;
}
