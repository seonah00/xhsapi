import {test,expect} from '@playwright/test';
test('admin trial quotes one bounded weekly Apify search and student cannot execute it',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/student-a@demo.invalid/}).click();await page.waitForURL(/\/app/);expect((await page.goto('/admin/collection'))?.status()).toBe(404);
 await page.context().clearCookies();await page.goto('/login');await page.getByRole('button',{name:/admin@demo.invalid/}).click();await page.waitForURL(/\/app/);await page.goto('/admin/collection');await page.getByLabel('수집 수량').selectOption('25');await page.getByRole('button',{name:'1회 수집 비용 확인',exact:true}).click();await page.waitForURL(/quote=/);
 await expect(page.getByText('최근 7일·최신순·최대 25건, 다른 정렬로 추가 수집하지 않음',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'공용 수집 실행 전 확인',exact:true})).toBeVisible();await page.getByRole('button',{name:'확인하고 실행',exact:true}).click();await page.waitForURL(/job=/);await expect(page.getByText(/완료/, {exact:false}).first()).toBeVisible({timeout:20000});
});
