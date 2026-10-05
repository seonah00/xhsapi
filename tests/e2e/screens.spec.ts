import { expect, test, type Page } from '@playwright/test';

/** Captures core screens for review: `pnpm test:e2e --grep @screens`. Output: docs/screenshots/. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}

for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 360, height: 780 }]] as const) {
  test(`capture ${name} screens @screens`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') { console.log('[browser error]', page.url(), m.text()); errors.push(m.text()); } });
    await page.setViewportSize(viewport);
    await login(page, 'student-a@demo.invalid');
    const shots: [string, string][] = [
      ['home', '/app'],
      ['discover', '/app/discover?q=' + encodeURIComponent('카페')],
      ['keywords', '/app/keywords'],
      ['expressions', '/app/expressions?sentence=' + encodeURIComponent('姐妹们，这家咖啡店我亲测好喝')],
      ['account-new', '/app/accounts/new'],
    ];
    for (const [file, path] of shots) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `docs/screenshots/m1-${name}-${file}.png`, fullPage: name === 'desktop', caret: 'initial' });
    }
    // Reference + transcript for a video note.
    await page.goto('/app/discover?q=' + encodeURIComponent('敏感肌'));
    await page.locator('article', { hasText: '敏感肌早晚护肤顺序' }).getByRole('button', { name: '레퍼런스로 가져오기' }).click();
    await page.waitForURL(/\/app\/references\/[0-9a-f-]{36}$/);
    const ref = page.url();
    await page.goto(`${ref}/transcript`);
    if (await page.getByRole('button', { name: '추출 요청' }).isVisible()) {
      await page.getByRole('button', { name: '추출 요청' }).click();
      await page.screenshot({ path: `docs/screenshots/m1-${name}-quote-confirm.png`, fullPage: name === 'desktop', caret: 'initial' });
      await page.getByRole('button', { name: '확인하고 실행' }).click();
    }
    await page.getByRole('heading', { name: '시간대별 문장' }).waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `docs/screenshots/m1-${name}-transcript.png`, fullPage: name === 'desktop', caret: 'initial' });
    await page.goto(ref);
    if (await page.getByRole('button', { name: '분석하기' }).isVisible()) {
      await page.getByRole('button', { name: '분석하기' }).click();
      await page.getByRole('button', { name: '확인하고 실행' }).click();
    }
    await page.getByText('관찰 사실', { exact: true }).waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `docs/screenshots/m1-${name}-reference.png`, fullPage: name === 'desktop', caret: 'initial' });
    // M2 screens (a plan exists from the M2 spec, which runs earlier in the same database).
    await page.goto('/app/plans');
    const first = page.locator('a[href^="/app/plans/"]').filter({ hasNotText: '새 기획' }).first();
    if (await first.count()) {
      await first.click();
      await page.waitForURL(/\/app\/plans\/[0-9a-f-]{36}$/);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `docs/screenshots/m2-${name}-plan.png`, fullPage: name === 'desktop', caret: 'initial' });
    }
    await page.goto('/app/check');
    await page.getByLabel('본문 (최대 10,000자)').fill('这款面霜是最好的，100%有效！');
    await page.getByRole('button', { name: '점검' }).click();
    await page.getByRole('heading', { name: /결과/ }).waitFor();
    await page.screenshot({ path: `docs/screenshots/m2-${name}-check.png`, fullPage: name === 'desktop', caret: 'initial' });
    for (const [m, f, path] of [['m3', 'results', '/app/results'], ['m3', 'library', '/app/library'], ['m4', 'reference-accounts', '/app/reference-accounts']] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `docs/screenshots/${m}-${name}-${f}.png`, fullPage: name === 'desktop', caret: 'initial' });
    }
    if (name === 'desktop') {
      await login(page, 'admin@demo.invalid');
      for (const [m, file, path] of [['m3', 'providers', '/admin/providers'], ['m3', 'usage', '/admin/usage'], ['m4', 'taxonomy', '/admin/taxonomy'], ['m4', 'reports', '/review/reports?all=1']] as const) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `docs/screenshots/${m}-admin-${file}.png`, fullPage: true, caret: 'initial' });
      }
    }
    expect(errors, 'browser console errors').toEqual([]);
  });
}
