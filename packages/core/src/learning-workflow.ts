import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '@xhs/domain';
import type {Ctx} from './context.ts';
import {requireStaff} from './staff.ts';
import {getWriting} from './writing.ts';
import {getTemporaryWriting,saveTemporaryWriting} from './writing-temporary.ts';
const requireGuideAdmin=(ctx:Ctx)=>{if(ctx.role!=='org_admin')throw new AppError('FORBIDDEN','관리자만 사례를 편집·공개할 수 있습니다.');};
const text=z.string().trim().min(1).max(3000);
export const CaseGuideInput=z.object({id:z.string().uuid().optional(),revision:z.number().int().positive().optional(),title:text.max(200),audience:text,situation:text,coverAnalysis:text,titleAnalysis:text,bodyStructure:text,videoStructure:text,reusable:text,avoidCopy:text,questions:z.array(text.max(500)).min(1).max(8),checklist:z.array(text.max(500)).min(1).max(12),sourceNoteId:z.string().uuid().optional()}).strict();
export type CaseGuide={id:string;revision:number;status:'draft'|'published';content:z.infer<typeof CaseGuideInput>;reviewed_at:Date|null};
export async function listCaseGuides(ctx:Ctx):Promise<CaseGuide[]>{return (await ctx.db.query(`select id,revision,status,content,reviewed_at from case_guides where org_id=$1 and data_mode=$2 and (status='published' or $3::boolean) order by updated_at desc limit 100`,[ctx.orgId,ctx.mode,ctx.role==='org_admin'])).rows;}
export async function getCaseGuide(ctx:Ctx,id:string):Promise<CaseGuide>{
 const row=(await ctx.db.query(`select id,revision,status,content,reviewed_at from case_guides where id=$1 and org_id=$2 and data_mode=$3`,[z.string().uuid().parse(id),ctx.orgId,ctx.mode])).rows[0];if(!row)throw new AppError('NOT_FOUND','공개된 사례 가이드를 찾을 수 없습니다.');return row;
}
export async function saveCaseGuide(ctx:Ctx,raw:unknown){
 requireGuideAdmin(ctx);const {id,revision,...content}=CaseGuideInput.parse(raw);
 if(content.sourceNoteId&&!((await ctx.db.query('select 1 from notes where id=$1 and org_id=$2 and data_mode=$3',[content.sourceNoteId,ctx.orgId,ctx.mode])).rowCount))throw new AppError('NOT_FOUND','사례 게시물을 확인하세요.');
 if(!id)return (await ctx.db.query(`insert into case_guides(org_id,data_mode,content,created_by) values($1,$2,$3,$4) returning id,revision`,[ctx.orgId,ctx.mode,content,ctx.uid])).rows[0] as {id:string;revision:number};
 const row=(await ctx.db.query(`update case_guides set content=$4,status='draft',reviewed_by=null,reviewed_at=null,revision=revision+1,updated_at=now() where id=$1 and org_id=$2 and data_mode=$3 and revision=$5 returning id,revision`,[id,ctx.orgId,ctx.mode,content,revision])).rows[0];if(!row)throw new AppError('CONFLICT','가이드가 변경됐습니다. 다시 열어 주세요.');return row as {id:string;revision:number};
}
export async function publishCaseGuide(ctx:Ctx,id:string,revision:number){
 requireGuideAdmin(ctx);const guide=await getCaseGuide(ctx,id);CaseGuideInput.parse(guide.content);
 const result=await ctx.db.query(`update case_guides set status='published',reviewed_by=$4,reviewed_at=now(),revision=revision+1,updated_at=now() where id=$1 and org_id=$2 and data_mode=$3 and revision=$5`,[id,ctx.orgId,ctx.mode,ctx.uid,z.number().int().positive().parse(revision)]);if(!result.rowCount)throw new AppError('CONFLICT','가이드가 변경됐습니다. 다시 검토하세요.');
}
export async function importCaseGuide(ctx:Ctx,id:string,answers:string[]){
 const guide=await getCaseGuide(ctx,id);if(guide.status!=='published')throw new AppError('NOT_FOUND','공개된 사례만 가져올 수 있습니다.');
 const values=z.array(z.string().trim().min(1).max(1000)).max(8).parse(answers);if(values.length!==guide.content.questions.length)throw new AppError('VALIDATION_FAILED','모든 적용 질문에 내 경험을 적어 주세요.');
 const current=await getTemporaryWriting(ctx,'new');
 const notes=`사례 가이드: ${guide.content.title}\n참고할 구조: ${guide.content.reusable}\n그대로 복사하지 않을 것: ${guide.content.avoidCopy}\n`+values.map((answer,i)=>`${guide.content.questions[i]}\n${answer}`).join('\n\n');
 const content=current.content??{id:randomUUID(),revision:0,title:'',cover:'',body:'',meaningKo:'',meaningReviewedFor:'',tags:[],entryIds:[],learningNotes:''};
 const learningNotes=[content.learningNotes,notes].filter(Boolean).join('\n\n');if(learningNotes.length>12000)throw new AppError('VALIDATION_FAILED','참고 메모가 너무 깁니다. 기존 메모를 정리한 뒤 가져오세요.');
 return saveTemporaryWriting(ctx,{scope:'new',version:current.version,content:{...content,learningNotes}});
}
export async function submitWritingReview(ctx:Ctx,raw:unknown){
 const d=z.object({draftId:z.string().uuid(),revision:z.number().int().positive(),cohortId:z.string().uuid(),confirm:z.literal(true)}).parse(raw);
 const {draft}=await getWriting(ctx,d.draftId);if(draft.archivedAt)throw new AppError('CONFLICT','보관함에서 꺼낸 뒤 검토를 요청하세요.');
 // Validate ownership first. The database trigger copies the requested immutable version.
 if(d.revision>draft.revision)throw new AppError('NOT_FOUND','저장한 버전을 확인하세요.');
 try{return (await ctx.db.query(`insert into writing_reviews(org_id,owner_user_id,data_mode,cohort_id,draft_id,revision) values($1,$2,$3,$4,$5,$6) returning id`,[ctx.orgId,ctx.uid,ctx.mode,d.cohortId,d.draftId,d.revision])).rows[0].id as string;}
 catch(e){if(String(e).includes('writing_review_active'))throw new AppError('CONFLICT','이 버전은 이미 해당 기수에 검토 요청했습니다.');if(String(e).includes('WRITING_REVIEW_FORBIDDEN'))throw new AppError('FORBIDDEN','소속 기수에만 요청할 수 있습니다.');throw e;}
}
export type WritingReview={id:string;draft_id:string;revision:number;owner_user_id:string;cohort_id:string;status:string;snapshot:{title:string;cover:string;body:string;meaningKo:string;tags:string[]};created_at:Date;feedback:{content:string;created_at:Date}[]};
export async function listWritingReviews(ctx:Ctx,draftId?:string){
 return (await ctx.db.query(`select id,draft_id,revision,owner_user_id,cohort_id,status,snapshot,created_at from writing_reviews where org_id=$1 and data_mode=$2 and ($3::uuid is null or draft_id=$3) order by created_at desc limit 100`,[ctx.orgId,ctx.mode,draftId??null])).rows as Omit<WritingReview,'feedback'>[];
}
export async function getWritingReview(ctx:Ctx,id:string):Promise<WritingReview>{
 const row=(await ctx.db.query(`select * from writing_reviews where id=$1 and org_id=$2 and data_mode=$3`,[z.string().uuid().parse(id),ctx.orgId,ctx.mode])).rows[0];if(!row)throw new AppError('NOT_FOUND','검토 요청을 찾을 수 없습니다.');
 const feedback=(await ctx.db.query(`select content,created_at from writing_feedback where review_id=$1 order by created_at`,[id])).rows;return {...row,feedback};
}
export async function addWritingFeedback(ctx:Ctx,id:string,content:string){
 requireStaff(ctx);const review=await getWritingReview(ctx,id);if(review.status!=='submitted'||!(await ctx.db.query('select app.is_cohort_reviewer($1) as allowed',[review.cohort_id])).rows[0].allowed)throw new AppError('FORBIDDEN','배정된 기수의 요청에만 피드백을 남길 수 있습니다.');
 await ctx.db.query(`insert into writing_feedback(review_id,author_id,content) values($1,$2,$3)`,[id,ctx.uid,z.string().trim().min(1).max(5000).parse(content)]);
}
export async function withdrawWritingReview(ctx:Ctx,id:string){const review=await getWritingReview(ctx,id);if(review.owner_user_id!==ctx.uid)throw new AppError('FORBIDDEN','본인 요청만 철회할 수 있습니다.');await ctx.db.query('select app.withdraw_writing_review($1)',[review.id]);}
