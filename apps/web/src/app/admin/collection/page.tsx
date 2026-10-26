import {getQuote,requestHash} from '@xhs/core';
import {withAdmin} from '../forbidden-guard';
import {PageHeader,btn,input,ErrorNotice} from '@/components/ui';
import {QuoteConfirm} from '@/components/quote-confirm';
import {JobStatus} from '@/components/job-status';
import {quoteCollection,confirmCollection} from './actions';
const terms=['韩国美妆','韩国穿搭','首尔咖啡店','首尔vlog','首尔美食'];
export default async function Collection({searchParams}:{searchParams:Promise<{term?:string;quote?:string;job?:string;error?:string}>}){
 const sp=await searchParams,term=terms.includes(sp.term??'')?sp.term!:'韩国美妆';
 const quote=await withAdmin(ctx=>sp.quote&&/^[0-9a-f-]{36}$/.test(sp.quote)?getQuote(ctx,sp.quote):Promise.resolve(null));
 const scope={source:'apify',query:term,targetCount:50,days:7},matches=quote?.operation==='provider_search'&&quote.requestHash===requestHash('provider_search',scope);
 return <><PageHeader title="공용 게시물 시험 수집" description="관리자가 비용을 확인하고 1회 실행합니다. 학생 검색·정기 수집은 시작하지 않습니다."/><ErrorNotice message={sp.error}/><p className="mb-4">Apify · 최근 7일 · 최신순 · 최대 50건. 중복·결과 부족으로 신규 확보량은 더 적을 수 있습니다. 원문 열림 미확인 자료는 탐색에 자동 공개되지 않습니다.</p><form action={quoteCollection} className="flex flex-wrap gap-3"><label>수집 주제<select name="term" className={input} defaultValue={term}>{terms.map(t=><option key={t}>{t}</option>)}</select></label><button className={`${btn.secondary} self-end`}>1회 수집 비용 확인</button></form>{quote&&matches&&<QuoteConfirm quote={quote} title="공용 수집 실행 전 확인" action={confirmCollection} hidden={{term}} cancelHref="/admin/collection" scopeLines={[`검색어: ${term}`,'최근 7일·최신순·최대 50건, 다른 정렬로 추가 수집하지 않음','원문 확인 후 공개, 해석 AI·개별 상세 보완·정기 수집은 실행하지 않음']}/>}{sp.job&&/^[0-9a-f-]{36}$/.test(sp.job)&&<JobStatus jobId={sp.job} label="시험 수집"/>}</>;
}
