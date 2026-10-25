import {notFound} from 'next/navigation';
import {withStaff} from '@/server/staff';
import {PageHeader} from '@/components/ui';
import {CaseGuideForm} from '@/components/case-guide-form';
export default async function NewGuide(){await withStaff(async ctx=>{if(ctx.role!=='org_admin')notFound();});return <><PageHeader title="사례 작성"/><CaseGuideForm/></>;}
