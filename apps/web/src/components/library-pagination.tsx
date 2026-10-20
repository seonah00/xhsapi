import Link from 'next/link';
import {btn} from './ui';
export function LibraryPagination({label,path,page,pages,total,params={},parameter='page'}:{label:string;path:string;page:number;pages:number;total:number;params?:Record<string,string>;parameter?:string}){
 const href=(value:number)=>{const query=new URLSearchParams(params);query.set(parameter,String(value));return `${path}?${query}`;};
 return <nav aria-label={label} className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3"><p className="text-sm" aria-live="polite">총 {total}개 · {page}/{pages} 페이지</p><div className="flex gap-2">{page>1?<Link className={`${btn.secondary} min-h-11`} href={href(page-1)}>이전</Link>:<span aria-disabled="true" className={`${btn.secondary} min-h-11 opacity-40`}>이전</span>}{page<pages?<Link className={`${btn.secondary} min-h-11`} href={href(page+1)}>다음</Link>:<span aria-disabled="true" className={`${btn.secondary} min-h-11 opacity-40`}>다음</span>}</div></nav>;
}
