import Link from 'next/link';
import {z} from 'zod';
import {composerEntries,getDictionaryAiStatus} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {getDictionaryAiConfig} from '@/server/dictionary-ai-config';
import {PageHeader,btn,ErrorNotice} from '@/components/ui';
import {DirectWriter} from '../dictionary/workspace';
export default async function Write({searchParams}:{searchParams:Promise<{ids?:string|string[]}>}) {
 const {ids}=await searchParams;const parsed=z.array(z.string().uuid()).max(11).safeParse(ids?([] as string[]).concat(ids):[]);
 if(!parsed.success) return <ErrorNotice message="내 사전에서 작성할 항목을 다시 선택하세요."/>;
 const data=await withPageCtx(async ctx=>({entries:await composerEntries(ctx,[...new Set(parsed.data)]),status:await getDictionaryAiStatus(ctx,getDictionaryAiConfig()),admin:ctx.role==='org_admin'}));
 if(data.entries.length!==new Set(parsed.data).size||data.entries.filter(e=>e.entryType==='tag').length>8||data.entries.filter(e=>e.entryType==='expression').length>3) return <ErrorNotice message="사용할 항목을 태그 8개·표현 3개 이내로 다시 선택하세요."/>;
 return <><PageHeader title="바로 글쓰기" description="선택한 태그·표현과 내 경험으로 작성합니다. AI를 실행하지 않고 직접 작성해도 됩니다." actions={<><Link href="/app/dictionary/mine" className={btn.secondary}>내 사전</Link><Link href="/app/write/history" className={btn.secondary}>작성 이력</Link></>}/><DirectWriter items={data.entries} aiStatus={data.status} canManage={data.admin}/></>;
}
