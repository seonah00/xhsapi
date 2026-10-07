import { expect, test } from '@playwright/test';

test('selected-note enrichment uses an explicit zero-cost demo confirmation', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /student-b@demo\.invalid/ }).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=敏感肌');
  await page.getByRole('link', { name: '상세·표지 보완' }).first().click();
  await expect(page.getByRole('heading', { name: '상세·표지 보완' })).toBeVisible();
  await expect(page.getByText(/데모에서는 견적·승인 흐름만/)).toBeVisible();
  await page.getByRole('button', { name: '비용 확인' }).click();
  await expect(page.getByText('최대 비용: 0 (데모 모드, 실제 과금 없음)')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByRole('status')).toContainText('완료', { timeout: 20_000 });
  await page.getByRole('link', { name: '탐색 결과로 돌아가기' }).click();
  await expect(page).toHaveURL(/\/app\/discover/);
});

test('50-note target and batch cover confirmation remain explicit in demo mode', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /student-b@demo\.invalid/ }).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=敏感肌');
  await expect(page.getByLabel('수집 목표')).toHaveValue('50');
  await page.getByRole('button', { name: /비용 확인 후 조회/ }).click();
  await expect(page.getByText('목표: 관련 게시물 50건 이상 · 최대 5페이지')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByRole('status')).toContainText('완료', { timeout: 20_000 });
  await expect(page.getByText('공급자가 제공하는 결과가 끝났습니다.')).toBeVisible();
  await page.goto('/app/discover?q=敏感肌');
  await page.getByRole('link', { name: /표지 없는 .*건 Apify 보완/ }).click();
  await expect(page.getByRole('heading', { name: 'Apify 표지 일괄 보완' })).toBeVisible();
  await page.getByRole('button', { name: '보완 비용 확인' }).click();
  await expect(page.getByText('최대 비용: 0 (데모 모드, 실제 과금 없음)')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByRole('status')).toContainText('완료', { timeout: 20_000 });
});
