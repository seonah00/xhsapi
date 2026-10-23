import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {AxeBuilder} from '@axe-core/playwright';

test('home, account settings and results stay usable on mobile without legacy guidance @mobile',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/login');await page.getByRole('button',{name:/student-b@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/results');
 if(await page.getByText('먼저 계정 방향을 설정하세요',{exact:true}).isVisible()){
  await page.goto('/app/accounts/new');await page.getByLabel('계정 표시명').fill('모바일 계정');await page.getByRole('checkbox',{name:'뷰티',exact:true}).check();await page.getByLabel('주력 주제 (위에서 고른 것 중 하나)').selectOption('beauty');await page.getByLabel('목표 독자').fill('중국어 사용자');await page.getByRole('checkbox',{name:'일상 기록',exact:true}).check();await page.getByRole('checkbox',{name:'루틴',exact:true}).check();await page.getByRole('button',{name:'계정 만들기'}).click();await page.waitForURL(/\/app\?account=/);
 }
 await page.setViewportSize({width:375,height:812});
 for(const route of ['/app','/app/accounts','/app/accounts/new','/app/results']){
  await page.goto(route);
  for(const field of await page.locator('main input:not([type=hidden]):not([type=checkbox]),main textarea,main select').all()){
   if(!await field.isVisible())continue;
   expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
   expect(await field.evaluate(e=>Number.parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  }
  for(const link of await page.locator('main a').all())if(await link.isVisible())expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await expect(page.getByText('기획과 연결하려면 기획의 “최종본 전달” 화면에서 등록하세요.',{exact:true})).toHaveCount(0);
 await expect(page.getByText(/CSV 가져오기와 자동 연동은 이후 단계/)).toHaveCount(0);
 await page.getByLabel('제목(메모용)').fill('모바일 성과 '+info.project.name);await page.getByRole('button',{name:'등록',exact:true}).click();await page.waitForURL(/\/app\/results\/[0-9a-f-]+$/);
 await page.getByLabel('관찰 시각',{exact:true}).fill('2026-10-23T12:00');await page.getByLabel('좋아요',{exact:true}).fill('12');await page.getByLabel('저장',{exact:true}).fill('5');await page.getByRole('button',{name:'기록',exact:true}).click();await page.waitForURL(/added=/);
 await expect(page.getByRole('table')).toContainText('12');
 for(const width of [360,375,390,768]){await page.setViewportSize({width,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:375,height:812});
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.goto('/app/accounts');await expect(page.getByText(/프로필 버전/)).toHaveCount(0);const resultLink=page.getByRole('link',{name:'성과 기록 보기 →',exact:true}).first();await expect(resultLink).toHaveAttribute('href',/\/app\/results\?account=/);
 await page.getByRole('link',{name:'수정',exact:true}).first().click();await page.getByLabel('목표 독자').fill('모바일에서 수정한 독자');await page.getByRole('button',{name:'변경사항 저장',exact:true}).click();await page.waitForURL(/saved=/);await page.reload();await expect(page.getByLabel('목표 독자')).toHaveValue('모바일에서 수정한 독자');
 await page.goto('/app');await mkdir('test-results/student-library',{recursive:true});await page.screenshot({path:`test-results/student-library/home-improved-${info.project.name}.png`});expect(errors).toEqual([]);
});
