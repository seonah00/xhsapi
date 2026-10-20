import {expect,test} from '@playwright/test';
test('admin registers paused shared tracking; student sees history without cost controls',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/admin@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/admin/keyword-tracking');
 await page.getByLabel('중국어 검색어').fill('测试防晒追踪');
 await page.getByLabel('승인 종료일').fill(new Date(Date.now()+7*86400000).toISOString().slice(0,10));
 await page.getByRole('button',{name:'키워드 저장',exact:true}).click();
 await expect(page.getByRole('heading',{name:'测试防晒追踪'})).toBeVisible();
 await page.context().clearCookies();await page.goto('/login');await page.getByRole('button',{name:/student-a@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/discover/trends');
 await expect(page.getByRole('heading',{name:'키워드 사용 추이',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'#测试防晒追踪'})).toBeVisible();
 await expect(page.getByText('서로 다른 수집 결과가 2회 이상 쌓이면 비교합니다.').first()).toBeVisible();
 await expect(page.getByText('USD')).toHaveCount(0);
 expect((await page.goto('/admin/keyword-tracking'))?.status()).toBe(404);
});
