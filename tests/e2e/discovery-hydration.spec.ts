import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'America/Los_Angeles' });

test('discovery dates hydrate without React errors in an English browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/login');
  await page.getByRole('button', { name: /student-a@demo.invalid/ }).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?topic=beauty');
  await expect(page.getByRole('heading', { name: '탐색', exact: true })).toBeVisible();
  await expect(page.locator('article').first()).toContainText(/관찰 .* (오전|오후) \d{2}:\d{2}/);
  // Client-only editing proves the page has hydrated; no collection or AI action.
  await page.getByLabel('대상 (예: 敏感肌)').fill('测试');
  await expect(page.getByRole('button', { name: '조합한 키워드로 게시물 찾기' })).toBeVisible();
  expect(errors).toEqual([]);
});
