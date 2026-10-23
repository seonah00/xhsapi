import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';

test('student discovery prioritizes posts, preserves filters and offers previous navigation @mobile', async ({ page }, info) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const query = `移动浏览合成测试${info.project.name}`;
  const { rows } = await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,body_excerpt,provider_tags,provenance)
    select '00000000-0000-4000-b000-000000000001','mock',$1||i,'mock','https://demo.invalid/mobile',$1||i,'#旅行测试 合成例子',array['旅行测试'],'{}'
    from generate_series(1,55) i returning id`, [query]);
  const ids = rows.map(row => row.id);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await db.query(`insert into note_taxonomy(note_id,taxonomy_id,classifier_version,confidence) select n.id,t.id,'mobile-test','high' from notes n cross join taxonomy_terms t where n.id=any($1::uuid[]) and t.kind='topic' and t.slug='travel-outing'`, [ids]);
    await page.goto('/login');
    await page.getByRole('button', { name: /student-a@demo.invalid/ }).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover?' + new URLSearchParams({ q: query, topic: 'travel-outing', sort: 'saves' }));
    const analysis = page.getByTestId('discovery-analysis');
    await expect(analysis).not.toHaveAttribute('open');
    await expect(page.locator('article')).toHaveCount(50);
    const first = await page.locator('article').first().boundingBox();
    expect(first!.y).toBeLessThan(780);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (info.project.name === 'mobile') {
      for (const selector of ['[role=search] input[name=q]', '[role=search] select', '[role=search] button']) {
        for (const control of await page.locator(selector).all()) {
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      }
      expect(await page.getByRole('textbox', { name: '검색어', exact: true }).evaluate(e => getComputedStyle(e).fontSize)).toBe('16px');
      for (const link of [page.getByRole('link', {name:'한국어 자유문장으로 AI 검색어 만들기',exact:true}), page.getByRole('link', {name:/^비교 \(/})]) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(page.getByRole('link', { name: '원문 링크 있는 게시물만 보기', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '키워드 사용 추이 →', exact: true })).toHaveCount(0);
    await expect(page.locator('article').first()).not.toContainText('관찰 ');
    const pager = page.getByRole('navigation', { name: '게시물 페이지 상단' });
    await expect(pager.getByText('1페이지', { exact: true })).toBeVisible();
    await pager.getByRole('link', { name: '다음', exact: true }).click();
    await expect(pager.getByText('2페이지', { exact: true })).toBeVisible();
    await expect(page.locator('article')).toHaveCount(5);
    await expect(page.getByRole('textbox', { name: '검색어', exact: true })).toHaveValue(query);
    await expect(page.getByLabel('주제', { exact: true })).toHaveValue('travel-outing');
    await expect(page.getByLabel('정렬', { exact: true })).toHaveValue('saves');
    await expect(pager.getByRole('link', { name: '다음', exact: true })).toHaveCount(0);
    await pager.getByRole('link', { name: '이전', exact: true }).click();
    await expect(pager.getByText('1페이지', { exact: true })).toBeVisible();
    await analysis.locator('summary').first().click();
    await expect(page.getByRole('heading', { name: '사전과 검색 결과로 키워드 정리' })).toBeVisible();
    await analysis.locator('summary').first().click();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
    await mkdir('test-results/student-library', { recursive: true });
    await page.screenshot({ path: `test-results/student-library/discovery-${info.project.name}.png` });
  } finally { await db.query('delete from notes where id=any($1::uuid[])', [ids]); await db.end(); }
});
