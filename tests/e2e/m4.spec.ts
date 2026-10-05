import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}

test('reference accounts, mock external refresh, reports queue and taxonomy admin', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') { console.log('[browser error]', page.url(), m.text()); errors.push(m.text()); } });
  const external: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$|^wss?:$/.test(u.protocol) && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') external.push(r.url()); });

  // F14: save two author candidates from stored notes and compare them
  await login(page, 'student-a@demo.invalid');
  await page.goto('/app/reference-accounts');
  await expect(page.getByText('공급자 성장 순위', { exact: false })).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '참고 계정으로 저장' }).first().click();
    await page.waitForURL(/\/app\/reference-accounts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: '주제 분포' })).toBeVisible();
    await page.getByRole('link', { name: '목록' }).click();
  }
  const boxes = page.getByRole('checkbox', { name: '비교' });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: '선택한 계정 비교 (2~3개)' }).click();
  await expect(page.getByRole('heading', { name: '참고 계정 비교' })).toBeVisible();

  // Mock external refresh: quote → confirm → job (no external request in mock mode)
  await page.goto('/app/discover?q=' + encodeURIComponent('护肤'));
  await page.getByRole('button', { name: /비용 확인 후 조회/ }).click();
  await expect(page.getByRole('heading', { name: '외부 조회 확인' })).toBeVisible();
  await expect(page.getByText('0 (데모 모드, 실제 과금 없음)')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByRole('status').filter({ hasText: '완료' })).toBeVisible({ timeout: 30_000 });

  // False-positive report from the standalone check (only id + reason + memo are sent)
  await page.goto('/app/check');
  await page.getByLabel('제목', { exact: true }).fill('最好的面霜');
  await page.getByRole('button', { name: '점검' }).click();
  const finding = page.locator('li', { has: page.locator('mark', { hasText: '最好' }) }).first();
  await finding.getByText('오류 신고').click();
  await finding.getByRole('radio', { name: '잘못된 경고(오탐)' }).check();
  await finding.getByPlaceholder(/짧은 메모/).fill('비교 문맥');
  await finding.getByRole('button', { name: '신고 보내기' }).click();
  await expect(finding.getByText('신고했습니다.', { exact: false })).toBeVisible();
  expect(page.url()).toMatch(/\/app\/check$/);

  // Staff queue shows the rule key, not the student's text
  await login(page, 'reviewer@demo.invalid');
  await page.goto('/review/reports');
  await expect(page.getByText('오탐 신고가 많은 규칙')).toBeVisible();
  await expect(page.locator('code', { hasText: 'abs-best@1' }).first()).toBeVisible();
  await expect(page.getByText('最好的面霜')).toHaveCount(0);
  await page.getByRole('button', { name: '처리 완료' }).first().click();
  await expect(page).toHaveURL(/\/review\/reports$/);

  // Taxonomy admin: add an org term, deactivate it; built-ins stay fixed
  await login(page, 'admin@demo.invalid');
  await page.goto('/admin/taxonomy');
  await page.getByLabel('종류').selectOption('region');
  await page.getByLabel('슬러그').fill('seoul-e2e');
  await page.getByLabel('한국어 이름').fill('서울 테스트');
  await page.getByRole('button', { name: '추가' }).click();
  const row = page.locator('li', { hasText: 'seoul-e2e' });
  await row.getByRole('button', { name: '비활성화' }).click();
  await expect(page.locator('li', { hasText: 'seoul-e2e' }).getByRole('button', { name: '다시 활성화' })).toBeVisible();

  // Voluntary leave (student-c's last use in the suite): wrong text is refused, then access ends.
  await login(page, 'student-c@other-org.demo.invalid');
  await page.goto('/app/privacy');
  await page.getByLabel(/조직에서 나갑니다/).fill('나가기');
  await page.getByRole('button', { name: '조직에서 나가기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '확인 문구' })).toBeVisible();
  await page.getByLabel(/조직에서 나갑니다/).fill('조직에서 나갑니다');
  await page.getByRole('button', { name: '조직에서 나가기' }).click();
  await page.waitForURL(/\/app\/select-organization\?left=1/);
  await expect(page.getByText('조직에서 나갔습니다.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '선택' })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external, 'browser requests leaving the app origin').toEqual([]);

  // Students cannot open staff/admin pages (the 404 itself logs a console error, so it is checked last)
  await login(page, 'student-b@demo.invalid');
  expect((await page.goto('/review/reports'))?.status()).toBe(404);
});
