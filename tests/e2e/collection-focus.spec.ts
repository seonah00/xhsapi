import {test,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
test('student collection flow removes retired tools and connects terms to saved references @mobile',async({page},info)=>{
 const {default:pg}=await import('pg');const db=new pg.Pool({connectionString:process.env.DATABASE_URL});const org='00000000-0000-4000-b000-000000000001',term='合集测试'+info.project.name;
 const keyword=(await db.query(`insert into keywords(org_id,canonical_text,raw_text,kind,provenance,data_mode,review_status,shared_dictionary_key,shared_dictionary_meta) values($1,$2,$2,'hashtag','editorial_seed','mock','published',$2,$3) returning id`,[org,term,{term,meaning:'모음 흐름 검증',type:'편집 태그',categories:[],cautions:[],groups:[],observedCount:null,unknownTrendNote:'인기 지표 아님'}])).rows[0].id;
 const note=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,provider_tags,provenance) values($1,'mock',$2,'mock','https://demo.invalid/collection',$2,array[$2],'{}') returning id`,[org,term])).rows[0].id;
 try{
 await page.goto('/login');await page.getByRole('button',{name:/student-a@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await expect(page.getByRole('heading',{name:'게시물과 중국어 표현 모음',exact:true})).toBeVisible();
 for(const path of ['/app','/app/dictionary','/app/dictionary/mine']){
  await page.goto(path);await expect(page.locator('a[href^="/app/write"],a[href^="/app/guides"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/글쓰기|AI 초안/})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 }
 await page.goto('/app/dictionary?entryType=tag&q='+encodeURIComponent(term));const reference=page.getByRole('link',{name:'관련 게시물 보기',exact:true}).first();const href=await reference.getAttribute('href');expect(href).toMatch(/^\/app\/discover\?q=/);await reference.click();await page.waitForURL(/\/app\/discover\?q=/);await expect(page.getByRole('heading',{name:term,exact:true})).toBeVisible();
 for(const path of ['/app/write','/app/write/history','/app/guides','/app/guides/new'])expect((await page.goto(path))?.status()).toBe(404);
 }finally{await db.query('delete from notes where id=$1',[note]);await db.query('delete from keywords where id=$1',[keyword]);await db.end();}
});
