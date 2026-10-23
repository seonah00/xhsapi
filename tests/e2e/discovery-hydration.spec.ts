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

test('expression excerpts hydrate when an emoji crosses either clipping boundary', async ({ page }) => {
  const { default: pg } = await import('pg');
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const query = 'Unicode边界合成测试';
  const body = `😀${'前'.repeat(33)} YYDS ${'后'.repeat(53)}😀结束`;
  const { rows: [row] } = await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,body_excerpt,provenance)
    values('00000000-0000-4000-b000-000000000001','mock','unicode-hydration-fixture','mock','https://demo.invalid/unicode',$1,$2,'{}') returning id`, [query, body]);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: /student-a@demo.invalid/ }).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover?q=' + encodeURIComponent(query));
    const evidence = page.getByRole('region', { name: '이 검색에서 발견한 해시태그·표현' });
    await expect(evidence).toContainText('YYDS');
    await evidence.locator('summary').filter({ hasText: '근거 게시물·사용 문맥' }).last().click();
    await expect(evidence).toContainText(body.slice(0, -2));
    await page.getByLabel('대상 (예: 敏感肌)').fill('测试');
    await expect(page.getByRole('button', { name: '조합한 키워드로 게시물 찾기' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await db.query('delete from notes where id=$1', [row.id]);
    await db.end();
  }
});
