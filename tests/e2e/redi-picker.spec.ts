import { expect, test } from '@playwright/test';
test('REDi picker requires login and keeps unrelated matches out', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/app/dictionary/redi');
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: /student-a@demo.invalid/ }).click();
  await page.waitForURL(/\/app(?:$|\/)/);
  await page.goto('/app/dictionary/redi');
  await expect(page.getByRole('heading', { name: 'REDi에 사용할 표현 선택' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByLabel('주제나 한국어 뜻').fill('UNMATCHED_REDI_QUERY_93810');
  await expect(page.getByText('일치하는 항목이 없습니다. 짧은 핵심 단어로 바꿔 보세요.')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText('선택 0/10 · 선택 없음')).toBeVisible();
});
