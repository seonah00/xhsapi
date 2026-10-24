import {test,expect} from '@playwright/test';
import pg from 'pg';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';

test('discovery save, private editing, recovered writing and searchable history remain connected @mobile',async({page},info)=>{
 if(!process.env.DATABASE_URL?.includes('.tmp/pg'))throw new Error('local mock database required');
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const term='旅程标签'+info.project.name,query='连贯测试'+info.project.name,title='完整流程'+info.project.name;
 const id=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,body_excerpt,provider_tags,provenance) values('00000000-0000-4000-b000-000000000001','mock',$1,'mock','https://demo.invalid/journey',$1,$2,array[$3],'{}') returning id`,[query,'#'+term,term])).rows[0].id;
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('/login');await page.getByRole('button',{name:/student-a@demo.invalid/}).click();await page.waitForURL(/\/app/);
  await page.goto('/app/discover?'+new URLSearchParams({q:query}));await expect(page.locator('article')).toHaveCount(1);
  await page.getByTestId('discovery-analysis').locator('summary').first().click();
  const card=page.getByRole('region',{name:'실사용 검증 결과'}).getByRole('listitem').filter({hasText:'#'+term});
  await card.getByRole('button',{name:'내 사전에 저장',exact:true}).click();
  const quickWrite=card.getByRole('link',{name:'바로 글쓰기',exact:true});await expect(quickWrite).toBeVisible();expect((await quickWrite.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await card.getByRole('link',{name:'내 사전 보기',exact:true}).click();await expect(page).toHaveURL(/\/dictionary\/mine/);
  await page.getByLabel('내 사전 검색',{exact:true}).fill(term);await page.getByRole('button',{name:'검색',exact:true}).click();
  const personal=page.getByRole('listitem').filter({hasText:term});await expect(personal).toBeVisible();
  await personal.getByText('뜻·분류·예문 수정',{exact:true}).click();const edit=personal.getByRole('form');await edit.getByLabel('뜻',{exact:true}).fill('전체 흐름 검증 태그');await edit.getByRole('button',{name:'사전 변경 저장',exact:true}).click();await expect(edit.getByText('사전 변경 저장 완료',{exact:true})).toBeVisible();
  await personal.getByLabel(term+' 글쓰기 선택',{exact:true}).check();await page.getByRole('button',{name:'선택한 1개로 바로 글쓰기',exact:true}).click();await expect(page).toHaveURL(/\/app\/write\?ids=/);
  await expect(page.getByText('임시 저장 확인 중…',{exact:true})).toHaveCount(0);
  if(await page.getByRole('button',{name:'임시 저장 지우고 새로 작성',exact:true}).isVisible())await page.getByRole('button',{name:'임시 저장 지우고 새로 작성',exact:true}).click();
  await expect(page.getByLabel('해시태그 (공백으로 구분)',{exact:true})).toHaveValue(term);
  await page.getByLabel('중국어 제목',{exact:true}).fill(title);await page.getByLabel('중국어 본문',{exact:true}).fill('从发现到保存，一起记录生活。');await expect(page.getByText('자동 임시 저장 완료',{exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'임시 저장 복원',exact:true}).click();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('从发现到保存，一起记录生活。');await expect(page.getByLabel('해시태그 (공백으로 구분)',{exact:true})).toHaveValue(term);
  await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();await expect(page.getByText('버전 1 저장 완료',{exact:false})).toBeVisible();const saved=page.getByRole('link',{name:'저장본·이력 열기',exact:true});expect((await saved.boundingBox())!.height).toBeGreaterThanOrEqual(44);await saved.click();await expect(page).toHaveURL(/\/write\/history\/[0-9a-f-]+$/);
  await page.getByRole('link',{name:'작성 이력 목록',exact:true}).click();await page.getByLabel('작성물 검색',{exact:true}).fill(title);await page.getByRole('button',{name:'검색',exact:true}).click();await page.getByRole('link',{name:title,exact:true}).click();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('从发现到保存，一起记录生活。');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
  await mkdir('test-results/student-library',{recursive:true});await page.screenshot({path:`test-results/student-library/learning-journey-${info.project.name}.png`});
 }finally{await db.query('delete from notes where id=$1',[id]);await db.end();}
});
