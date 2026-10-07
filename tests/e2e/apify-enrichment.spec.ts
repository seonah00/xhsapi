import { expect, test } from '@playwright/test';

test('selected-note enrichment uses an explicit zero-cost demo confirmation', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /student-b@demo\.invalid/ }).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=敏感肌');
  await page.getByRole('link', { name: '정보 업데이트' }).first().click();
  await expect(page.getByRole('heading', { name: '정보 업데이트' })).toBeVisible();
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
  await page.getByRole('link', { name: /이미지 업데이트 \(/ }).click();
  await expect(page.getByRole('heading', { name: '이미지 업데이트' })).toBeVisible();
  await page.getByRole('button', { name: '업데이트 비용 확인' }).click();
  await expect(page.getByText('최대 비용: 0 (데모 모드, 실제 과금 없음)')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByRole('status')).toContainText('완료', { timeout: 20_000 });
});

test('a browser image failure becomes an update target without starting a paid request', async ({ page }) => {
  const { default: pg } = await import('pg');
  const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
  const cover='https://sns-i10.rednotecdn.com/synthetic-failed-cover.jpg';
  const row=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,cover_url,provenance)
    values ('00000000-0000-4000-b000-000000000001','mock','cover-failure-demo','mock','https://demo.invalid/cover-failure','coverfailurefixture',$1,'{}') returning id`,[cover])).rows[0];
  try {
    await page.route(cover,route=>route.abort());
    await page.goto('/login');
    await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover?q=coverfailurefixture');
    await expect(page.getByText('표지를 불러오지 못함')).toBeVisible();
    await expect(page.getByRole('link',{name:'이미지 업데이트 (1건)'})).toHaveAttribute('href',`/app/notes/enrich?ids=${row.id}`);
    await expect(page.getByText(/Apify 보완/)).toHaveCount(0);
  } finally { await db.query('delete from notes where id=$1',[row.id]); await db.end(); }
});
