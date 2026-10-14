import {test,expect} from '@playwright/test';
test('video loads only on request and reports unavailable streams without opening broken original links',async({page,context})=>{
 const {default:pg}=await import('pg');const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const org='00000000-0000-4000-b000-000000000001';
 const src='https://sns-v11.rednotecdn.com/stream/1/synthetic.mp4';
 const note=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,note_type,provenance) values($1,'mock','bbbbbbbbbbbbbbbbbbbbbbbb','mock','https://www.xiaohongshu.com/explore/bbbbbbbbbbbbbbbbbbbbbbbb','video-player-fixture','video','{}') returning id`,[org])).rows[0];
 const job=(await db.query(`insert into app_jobs(org_id,kind,data_mode,dedupe_key,state) values($1,'note_enrichment','mock','video-player-fixture','succeeded') returning id`,[org])).rows[0];
 try {
  await db.query(`insert into note_enrichments(note_id,org_id,permission_id,note_type,video_stream_url,actor_build,job_id,expires_at) values($1,$2,null,'video',$3,'1.0.0',$4,now()+interval '1 hour')`,[note.id,org,src,job.id]);
  let requests=0;await context.route(src,route=>{requests++;return route.fulfill({status:403,body:''});});
  await page.goto('/login');await page.getByRole('button',{name:/student-a@demo\.invalid/}).click();await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=video-player-fixture');
  const card=page.locator('article',{hasText:'video-player-fixture'});
  await expect(card.getByRole('link',{name:'게시물 원문 보기 ↗'})).toHaveCount(0);
  await card.getByRole('link',{name:'영상·상세 보기'}).click();
  await expect(page.getByRole('button',{name:'영상 재생',exact:true})).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);expect(requests).toBe(0);
  await page.getByRole('button',{name:'영상 재생',exact:true}).click();
  await expect(page.locator('video')).toHaveAttribute('src',src);
  await expect(page.getByRole('alert').filter({hasText:'영상을 불러오지 못했습니다'})).toBeVisible();
  await db.query(`update note_enrichments set expires_at=now()-interval '1 second' where note_id=$1`,[note.id]);
  await page.reload();await expect(page.getByRole('button',{name:'영상 재생',exact:true})).toHaveCount(0);
 } finally {await db.query('delete from notes where id=$1',[note.id]);await db.query('delete from app_jobs where id=$1',[job.id]);await db.end();}
});
