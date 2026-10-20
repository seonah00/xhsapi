import {test,expect} from '@playwright/test';
test('private dictionary to writing, saved versions and another student isolation without paid calls',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/student-a@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/dictionary/mine');
 await page.getByLabel('중국어 태그·표현').fill('记录生活测试');await page.getByLabel('내가 정리한 뜻').fill('생활 기록 검증용');await page.getByRole('button',{name:'내 항목 등록',exact:true}).click();
 await expect(page.getByRole('link',{name:'등록 완료 · 바로 글쓰기'})).toBeVisible();await page.getByRole('link',{name:'등록 완료 · 바로 글쓰기'}).click();
 await expect(page.getByRole('heading',{name:'바로 글쓰기',exact:true})).toBeVisible();
 await page.getByLabel('중국어 제목',{exact:true}).fill('个人写作测试');await page.getByLabel('중국어 본문',{exact:true}).fill('这是第一版。');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();
 await expect(page.getByText('버전 1 저장 완료',{exact:false})).toBeVisible();
 await page.getByLabel('중국어 본문',{exact:true}).fill('这是第二版。');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();
 await expect(page.getByText('버전 2 저장 완료',{exact:false})).toBeVisible();
 await page.getByRole('link',{name:'저장본·이력 열기',exact:true}).click();
 await page.waitForURL(/\/app\/write\/history\/[0-9a-f-]+$/);const savedUrl=page.url();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('这是第二版。');
 await page.getByText(/^버전 1 ·/).click();await expect(page.getByText('这是第一版。',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('这是第二版。');
 await page.context().clearCookies();await page.goto('/login');await page.getByRole('button',{name:/student-b@demo.invalid/}).click();await page.waitForURL(/\/app/);
 expect((await page.goto(savedUrl))?.status()).toBe(404);
});
