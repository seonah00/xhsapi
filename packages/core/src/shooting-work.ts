import {z} from 'zod';
import {AppError} from '@xhs/domain';
import type {Ctx} from './context.ts';
import {CaseGuideInput,getCaseGuide} from './learning-workflow.ts';
import {getTemporaryWriting,saveTemporaryWriting} from './writing-temporary.ts';
import {randomUUID} from 'node:crypto';
export type ShootingWork={id:string;revision:number;guideId:string;guideRevision:number;guide:z.infer<typeof CaseGuideInput>;subject:string;checked:string[];notes:Record<string,string>;memo:string;importedRevision:number};
export async function getShootingWork(ctx:Ctx,id:string):Promise<ShootingWork>{
 const row=(await ctx.db.query('select * from shooting_work where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4',[z.string().uuid().parse(id),ctx.orgId,ctx.uid,ctx.mode])).rows[0];if(!row)throw new AppError('NOT_FOUND','본인의 촬영 기록을 찾을 수 없습니다.');
 return {id:row.id,revision:row.revision,guideId:row.guide_id,guideRevision:row.guide_revision,guide:CaseGuideInput.parse(row.guide_snapshot),subject:row.subject,checked:row.checked,notes:row.notes,memo:row.memo,importedRevision:row.imported_revision};
}
export async function listShootingWork(ctx:Ctx){return (await ctx.db.query(`select id,subject,guide_snapshot->>'title' as title,updated_at from shooting_work where org_id=$1 and owner_user_id=$2 and data_mode=$3 order by updated_at desc limit 50`,[ctx.orgId,ctx.uid,ctx.mode])).rows as {id:string;subject:string;title:string;updated_at:Date}[];}
export async function startShootingWork(ctx:Ctx,guideId:string){
 const guide=await getCaseGuide(ctx,guideId);if(guide.status!=='published'||!guide.content.shooting)throw new AppError('NOT_FOUND','공개된 촬영 가이드를 선택하세요.');
 const row=(await ctx.db.query(`insert into shooting_work(org_id,owner_user_id,data_mode,guide_id,guide_revision,guide_snapshot) values($1,$2,$3,$4,$5,$6) on conflict(org_id,owner_user_id,data_mode,guide_id) do nothing returning id`,[ctx.orgId,ctx.uid,ctx.mode,guideId,guide.revision,guide.content])).rows[0];
 return row?.id??(await ctx.db.query('select id from shooting_work where org_id=$1 and owner_user_id=$2 and data_mode=$3 and guide_id=$4',[ctx.orgId,ctx.uid,ctx.mode,guideId])).rows[0].id as string;
}
export const ShootingWorkInput=z.object({id:z.string().uuid(),revision:z.number().int().positive(),subject:z.string().trim().max(200),checked:z.array(z.string().max(60)).max(20),notes:z.record(z.string().max(1000)).refine(v=>Object.keys(v).length<=20),memo:z.string().max(3000)}).strict();
export async function saveShootingWork(ctx:Ctx,raw:unknown){
 const d=ShootingWorkInput.parse(raw),work=await getShootingWork(ctx,d.id);const ids=new Set(work.guide.shooting!.shots.map(s=>s.id));
 if(d.checked.some(id=>!ids.has(id))||Object.keys(d.notes).some(id=>!ids.has(id)))throw new AppError('VALIDATION_FAILED','가이드에 없는 컷입니다.');
 const row=(await ctx.db.query(`update shooting_work set subject=$5,checked=$6,notes=$7,memo=$8,revision=revision+1,updated_at=now() where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 and revision=$9 returning revision`,[d.id,ctx.orgId,ctx.uid,ctx.mode,d.subject,JSON.stringify([...new Set(d.checked)]),JSON.stringify(d.notes),d.memo,d.revision])).rows[0];
 if(!row)throw new AppError('CONFLICT','다른 창에서 촬영 기록이 변경됐습니다. 현재 메모를 복사한 뒤 다시 열어 주세요.');return {revision:row.revision as number};
}
export async function importShootingWork(ctx:Ctx,id:string,revision:number){
 id=z.string().uuid().parse(id);
 await ctx.db.query('select id from shooting_work where id=$1 and org_id=$2 and owner_user_id=$3 and data_mode=$4 for update',[id,ctx.orgId,ctx.uid,ctx.mode]);
 const work=await getShootingWork(ctx,id);if(work.revision!==z.number().int().positive().parse(revision))throw new AppError('CONFLICT','최신 촬영 기록을 저장한 뒤 가져오세요.');
 const selected=work.guide.shooting!.shots.filter(s=>work.checked.includes(s.id));if(!selected.length)throw new AppError('VALIDATION_FAILED','촬영한 컷을 하나 이상 체크하고 저장하세요.');
 const text=`촬영 기록: ${work.subject||work.guide.title}\n가이드: ${work.guide.title} (검토된 저장본 ${work.guideRevision})\n`+selected.map(s=>`${s.title}: ${work.notes[s.id]||'직접 확인한 내용을 작성하세요.'}`).join('\n')+`\n내 후기·추가 메모: ${work.memo}\n미촬영 필수 컷: ${work.guide.shooting!.shots.filter(s=>s.required&&!work.checked.includes(s.id)).map(s=>s.title).join(' · ')||'없음'}\n예시 자막은 내 실제 경험과 맞게 수정하고, 확인하지 않은 가격·효능·인기는 쓰지 마세요.`;
 const temp=await getTemporaryWriting(ctx,'new');if(temp.content?.learningNotes.includes(text))return;const content=temp.content??{id:randomUUID(),revision:0,title:'',cover:'',body:'',meaningKo:'',tags:[],entryIds:[],learningNotes:''};
 const learningNotes=[content.learningNotes,text].filter(Boolean).join('\n\n');if(learningNotes.length>12000)throw new AppError('VALIDATION_FAILED','개인 참고 메모가 너무 깁니다. 기존 글쓰기 메모를 정리하세요.');
 await saveTemporaryWriting(ctx,{scope:'new',version:temp.version,content:{...content,learningNotes}});
 await ctx.db.query('update shooting_work set imported_revision=$2 where id=$1',[id,revision]);
}
