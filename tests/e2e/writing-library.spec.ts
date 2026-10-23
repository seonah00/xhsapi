import {test,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import pg from 'pg';
import {mkdir} from 'node:fs/promises';
test('student can restore, duplicate, search, archive and retrieve writing on desktop and mobile @mobile',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const prefix='界面词'+info.project.name;
 if(!process.env.DATABASE_URL?.includes('.tmp/pg'))throw new Error('UI fixtures require the local mock database');
 const fixture=new pg.Client({connectionString:process.env.DATABASE_URL});await fixture.connect();
 try{await fixture.query(`insert into personal_dictionary(org_id,owner_user_id,data_mode,entry_type,term,canonical_term,meaning,source_kind,saved_at) select '00000000-0000-4000-b000-000000000001','00000000-0000-4000-a000-000000000002','mock','expression',$1||n,$1||n,'학생 화면 페이지 예시','manual',now()-n*interval '1 second' from generate_series(1,13)n`,[prefix]);}finally{await fixture.end();}
 await page.goto('/login');await page.getByRole('button',{name:/student-b@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/write');await page.getByLabel('중국어 제목',{exact:true}).fill('版本库'+info.project.name);await page.getByLabel('중국어 본문',{exact:true}).fill('第一版内容');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();await expect(page.getByText('버전 1 저장 완료',{exact:false})).toBeVisible();
 await page.getByLabel('중국어 본문',{exact:true}).fill('第二版内容');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();await expect(page.getByText('버전 2 저장 완료',{exact:false})).toBeVisible();await expect(page.getByText('작성 이력에 저장됨',{exact:true})).toBeVisible();await page.getByRole('link',{name:'저장본·이력 열기',exact:true}).click();await page.waitForURL(/\/history\/[0-9a-f-]+$/);
 const original=page.url();const version=page.locator('main details').filter({has:page.locator('summary').filter({hasText:/^버전 1 ·/})});await version.locator(':scope > summary').click();await version.getByText('이 버전으로 복원',{exact:true}).click();await version.getByRole('button',{name:'복원하여 새 버전 저장',exact:true}).click();
 await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('第一版内容');await expect(page.getByText('이전 내용으로 새 버전 3을 저장했습니다.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'글 복제',exact:true}).click();await page.waitForURL(/notice=copied/);expect(page.url()).not.toBe(original);await expect(page.getByLabel('중국어 제목',{exact:true})).toHaveValue('版本库'+info.project.name+' (복제)');
 await page.getByRole('button',{name:'보관함으로 이동',exact:true}).click();await page.waitForURL(/state=archived/);await page.getByLabel('작성물 검색',{exact:true}).fill('版本库'+info.project.name);await page.getByRole('button',{name:'검색',exact:true}).click();
 await page.getByLabel('작성물 검색',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'검색',exact:true})).toBeFocused();
 const card=page.getByRole('listitem').filter({has:page.getByRole('link',{name:'版本库'+info.project.name+' (복제)',exact:true})});await expect(card).toBeVisible();await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:'작성 이력',exact:true})).toHaveAttribute('aria-current','page');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await mkdir('test-results/student-library',{recursive:true});await page.screenshot({path:`test-results/student-library/history-${info.project.name}.png`,fullPage:true});
 await card.getByRole('button',{name:'보관함에서 꺼내기',exact:true}).click();await page.waitForURL(/notice=unarchived/);await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('第一版内容');
 await page.goto('/app/dictionary/mine?q='+encodeURIComponent(prefix));await page.getByRole('navigation',{name:'내 사전 페이지',exact:true}).getByRole('link',{name:'다음',exact:true}).click();await expect(page.getByRole('checkbox',{name:prefix+'13 글쓰기 선택',exact:true})).toBeVisible();await page.getByLabel(prefix+'13 글쓰기 선택',{exact:true}).check();await expect(page.getByRole('button',{name:'선택한 1개로 바로 글쓰기',exact:true})).toBeEnabled();await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:'내 사전',exact:true})).toHaveAttribute('aria-current','page');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);if(info.project.name==='mobile'){const bottom=await page.getByRole('button',{name:'선택한 항목으로 글쓰기 (1개)',exact:true}).boundingBox();expect(bottom?.height).toBeGreaterThanOrEqual(44);expect((bottom?.y??-1)>=0&&(bottom?.y??10000)<780).toBe(true);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/student-library/dictionary-${info.project.name}.png`,fullPage:true});
});
