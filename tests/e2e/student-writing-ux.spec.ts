import {test,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';
import pg from 'pg';
async function login(page:import('@playwright/test').Page,email:string){
 await page.context().clearCookies();await page.goto('/login');await page.getByRole('button',{name:new RegExp(email.replaceAll('.','\\.'))}).click();await page.waitForURL(/\/app/);
}

test('shared selections lead to writing without losing manual or AI input @mobile',async({page},info)=>{
 const prefix='动线词'+info.project.name;
 await login(page,'admin@demo.invalid');await page.goto('/admin/dictionary');await page.getByLabel('가져오기 이름').fill(prefix);
 await page.getByLabel('JSON 파일 (최대 2MB)').setInputFiles({name:'ux.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({tags:Array.from({length:25},(_,i)=>({id:prefix+i,term:prefix+String(i).padStart(2,'0'),meaning:'동선 검증 태그',kind:'주제',categories:['일상']})),expressions:[]}))});
 await page.getByRole('button',{name:'가져와서 미리보기'}).click();await page.getByLabel(/추가·수정·유지 건수/).check();await page.getByRole('button',{name:'검토 완료'}).click();await page.getByLabel(/학생용 공용 사전에 공개/).check();await page.getByRole('button',{name:'공용 사전에 반영'}).click();
 await login(page,'student-b@demo.invalid');await page.goto('/app/dictionary?q='+encodeURIComponent(prefix));
 await page.getByRole('checkbox',{name:prefix+'00 선택',exact:true}).check();
 const go=page.getByRole('button',{name:'선택한 1개로 글쓰기',exact:true});await expect(go).toBeVisible();
 if(info.project.name==='mobile'){const r=await go.boundingBox();expect(r!.height).toBeGreaterThanOrEqual(44);expect(r!.y+r!.height).toBeLessThanOrEqual(780);}
 await go.click();
 await page.getByRole('tab',{name:'직접 작성',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'AI 도움',exact:true})).toBeFocused();await page.keyboard.press('Home');
 await expect(page.getByRole('tab',{name:'직접 작성',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByText('임시 저장 확인 중…',{exact:true})).toHaveCount(0);
 if(await page.getByRole('button',{name:'임시 저장 지우고 새로 작성',exact:true}).isVisible())await page.getByRole('button',{name:'임시 저장 지우고 새로 작성',exact:true}).click();
 await page.getByLabel('중국어 제목',{exact:true}).fill('수동 초안 유지');await expect(page.getByText('임시 저장 완료',{exact:false})).toBeVisible();
 await page.getByRole('tab',{name:'AI 도움',exact:true}).click();await page.getByLabel(/내 조건과 사실/).fill('실제 산책 경험');
 await go.click();await expect(page.getByRole('tab',{name:'직접 작성',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByLabel('중국어 제목',{exact:true})).toHaveValue('수동 초안 유지');
 await page.getByRole('tab',{name:'AI 도움',exact:true}).click();await expect(page.getByLabel(/내 조건과 사실/)).toHaveValue('실제 산책 경험');
 await page.getByRole('tab',{name:'직접 작성',exact:true}).click();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await mkdir('test-results/student-library',{recursive:true});await page.screenshot({path:`test-results/student-library/shared-writing-${info.project.name}.png`});
 await page.goto('/app/write');await expect(page.getByText('왼쪽 목록에서 항목을 선택하세요.')).toHaveCount(0);await expect(page.getByRole('link',{name:'내 사전에서 항목 선택',exact:true})).toBeVisible();await expect(page.getByLabel('중국어 제목',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('results comparison stays inside the mobile viewport @mobile',async({page},info)=>{
 await login(page,'student-b@demo.invalid');await page.goto('/app/results');
 if(await page.getByText('먼저 계정 방향을 설정하세요',{exact:true}).isVisible()){
  await page.goto('/app/accounts/new');await page.getByLabel('계정 표시명').fill('UI 검증 계정');await page.getByRole('checkbox',{name:'뷰티',exact:true}).check();await page.getByLabel('주력 주제 (위에서 고른 것 중 하나)').selectOption('beauty');await page.getByLabel('목표 독자').fill('중국어 사용자');await page.getByRole('checkbox',{name:'일상 기록',exact:true}).check();await page.getByRole('checkbox',{name:'루틴',exact:true}).check();await page.getByRole('button',{name:'계정 만들기'}).click();await page.waitForURL(/\/app\?account=/);await page.goto('/app/results');
 }
 await page.getByLabel('제목(메모용)').fill('모바일표 검증 '+info.project.name);await page.getByLabel('형식',{exact:true}).selectOption('routine');await page.getByRole('button',{name:'등록',exact:true}).click();await page.waitForURL(/\/app\/results\/[0-9a-f-]+$/);await page.getByRole('link',{name:'목록',exact:true}).click();
 for(const width of [375,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:375,height:812});await mkdir('test-results/student-library',{recursive:true});await page.screenshot({path:`test-results/student-library/results-fixed-${info.project.name}.png`});
});

test('copyable original connection preserves valid shares and handles expiry without exposing tokens @mobile',async({page})=>{
 if(!process.env.DATABASE_URL?.includes('.tmp/pg'))throw new Error('local mock database required');
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();const org='00000000-0000-4000-b000-000000000001',pid='c'.repeat(24),share=`https://www.xiaohongshu.com/explore/${pid}?xsec_token=synthetic-ux-only`;
 const id=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,provenance) values($1,'mock',$2,'mock',$3,'공유주소 UX 합성 예시','{}') returning id`,[org,pid,share.split('?')[0]])).rows[0].id;
 try{
  await db.query(`insert into note_access_links(note_id,org_id,access_url,expires_at) values($1,$2,$3,now()+interval '1 hour')`,[id,org,share]);await login(page,'student-a@demo.invalid');await page.goto('/app/notes/'+id);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'원문 연결 링크 복사',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(new URL(`/app/notes/${id}/original`,page.url()).href);await expect(page.getByText('synthetic-ux-only',{exact:false})).toHaveCount(0);
  const redirect=await page.request.get(`/app/notes/${id}/original`,{maxRedirects:0});expect(redirect.status()).toBe(302);expect(redirect.headers().location).toBe(share);expect(redirect.headers()['cache-control']).toContain('no-store');
  await db.query(`update note_access_links set expires_at=now()-interval '1 second' where note_id=$1`,[id]);
  const expired=await page.request.get(`/app/notes/${id}/original`,{maxRedirects:0});expect(expired.headers().location).toContain('link=unavailable');await page.goto(expired.headers().location!);
  await expect(page.getByRole('alert').filter({hasText:'공유 링크'})).toBeVisible();await expect(page.getByRole('button',{name:'원문 연결 링크 복사',exact:true})).toHaveCount(0);
 }finally{await db.query('delete from notes where id=$1',[id]);await db.end();}
});
