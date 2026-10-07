import { expect, test } from '@playwright/test';

test('hashtag search quotes a fresh query and displays its completed results', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover');
  await page.getByRole('textbox',{name:'검색어',exact:true}).fill('#敏感肌');
  await page.getByRole('button',{name:'새 게시물 검색',exact:true}).click();
  await expect(page.getByText('검색어: 敏感肌',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'확인하고 실행'}).click();
  await expect(page.getByRole('status')).toContainText('완료',{timeout:20000});
  await expect(page.locator('article').first()).toBeVisible();
  await expect(page.getByText(/이번 조회의/)).toBeVisible();
  await expect(page).not.toHaveURL(/#refresh$/);
});

test('a thumbnail opens its exact original post URL in a new tab', async ({ page, context }) => {
  const { default: pg } = await import('pg');
  const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
  const original='https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa?xsec_token=synthetic';
  const cover='https://sns-i10.rednotecdn.com/synthetic-thumbnail.svg';
  const row=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,cover_url,provenance)
    values ('00000000-0000-4000-b000-000000000001','mock','thumbnail-link-fixture','mock',$1,'thumbnaillinkfixture',$2,'{}') returning id`,[original,cover])).rows[0];
  try {
    await context.route(original, route=>route.fulfill({contentType:'text/html',body:'<p>synthetic original</p>'}));
    await context.route(cover, route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'}));
    await page.goto('/login');
    await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover?q=thumbnaillinkfixture');
    const link=page.getByRole('link',{name:'thumbnaillinkfixture 원문 열기 (새 탭)'});
    await expect(link).toHaveAttribute('href',original);
    await expect(link.locator('img')).toBeVisible();
    const [popup]=await Promise.all([page.waitForEvent('popup'),link.click()]);
    await expect(popup).toHaveURL(original);
    await popup.close();
    await expect(page).toHaveURL(/thumbnaillinkfixture/);
  } finally { await db.query('delete from notes where id=$1',[row.id]); await db.end(); }
});
