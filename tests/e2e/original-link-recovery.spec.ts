import {expect,test} from '@playwright/test';
test('only administrators can inspect retained-result recovery and mock mode never contacts Apify',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/admin@demo\.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/admin/original-links');await expect(page.getByRole('heading',{name:'기존 원문 링크 복구',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'기존 결과 10개 확인·연결',exact:true}).click();
 await expect(page.getByText(/운영 모드와 서버의 Apify 키가 필요합니다/)).toBeVisible();
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.goto('/login');await page.getByRole('button',{name:/student-a@demo\.invalid/}).click();await page.waitForURL(/\/app/);
 expect((await page.request.get('/admin/original-links')).status()).toBe(404);
});
