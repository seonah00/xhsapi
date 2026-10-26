import Link from 'next/link';
import {getShootingWork} from '@xhs/core';
import {withPageCtx} from '@/server/ctx';
import {PageHeader,ErrorNotice,btn} from '@/components/ui';
import {ShootingWorkspace} from '@/components/shooting-workspace';
export default async function Work({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string}>}){const {id}=await params,sp=await searchParams;const work=await withPageCtx(ctx=>getShootingWork(ctx,id));return <><PageHeader title={work.guide.title+' · 촬영 체크'} description="본인만 볼 수 있는 촬영 기록입니다. 시작할 때의 가이드로 기록을 유지합니다." actions={<Link href="/app/guides" className={btn.secondary}>사례·촬영 가이드</Link>}/><ErrorNotice message={sp.error}/><ShootingWorkspace work={work}/></>;}
