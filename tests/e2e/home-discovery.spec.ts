import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test('home search and library entry points remain accessible and never collect @mobile', async ({ page }, info) => {
  const { default: pg } = await import('pg');
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const jobCount = async () => Number((await db.query('select count(*) from app_jobs')).rows[0].count);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const before = await jobCount();
    await page.goto('/login');
    await page.getByRole('button', { name: /student-a@demo\.invalid/ }).click();
    await page.waitForURL(/\/app/);
    await expect(page.getByRole('search', { name: '게시물 검색' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/student-library/home-${info.project.name}.png`, fullPage: true });
    await page.getByRole('textbox', { name: '게시물 검색어', exact: true }).fill('敏感肌');
    await page.getByRole('button', { name: '게시물 검색', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/app/discover' && url.searchParams.get('q') === '敏感肌');
    await expect(page.getByRole('heading', { name: '敏感肌早晚护肤顺序', exact: true })).toBeVisible();
    await page.goto('/app');
    await page.getByRole('textbox', { name: '게시물 검색어', exact: true }).fill('성수동 카페');
    await page.getByRole('button', { name: '게시물 검색', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '중국어 검색어', exact: true })).toHaveValue('圣水洞 咖啡店');
    await page.getByRole('button', { name: '이 중국어로 검색' }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('q') === '圣水洞 咖啡店' && !url.searchParams.has('prepare'));
    await page.goto('/app');
    await page.getByRole('link', { name: '뷰티', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/app/discover' && url.searchParams.get('topic') === 'beauty');
    for (const [name, path, type] of [
      ['해시태그 찾기', '/app/dictionary', 'tag'],
      ['표현 찾기', '/app/dictionary', 'expression'],
      ['내 모음 열기', '/app/dictionary/mine', ''],
    ] as const) {
      await page.goto('/app');
      await page.getByRole('link', { name: new RegExp(name) }).click();
      await expect(page).toHaveURL(url => url.pathname === path && (!type || url.searchParams.get('entryType') === type));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(await jobCount()).toBe(before);
    expect(errors).toEqual([]);
  } finally {
    await db.end();
  }
});
