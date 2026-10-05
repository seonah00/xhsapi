import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}

test.describe.configure({ mode: 'serial' });

const consoleErrors: string[] = [];
let expect404 = false;
test.beforeEach(({ page }) => {
  consoleErrors.length = 0;
  expect404 = false;
  // Only the isolation step expects a 404 document.
  page.on('console', (m) => { if (m.type() === 'error' && !(expect404 && m.text().includes('status of 404'))) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
});
test.afterEach(() => {
  expect(consoleErrors, 'browser console errors').toEqual([]);
});

test('student onboarding → discover → reference → analysis → transcript → expression', async ({ page }) => {
  await login(page, 'student-b@demo.invalid');
  await expect(page.getByText('데모 데이터 · 실제 샤오홍슈 데이터 아님')).toBeVisible();

  // Onboarding (F02)
  await page.goto('/app/accounts/new');
  await page.getByLabel('계정 표시명').fill('E2E 뷰티 계정');
  await page.getByRole('checkbox', { name: '뷰티', exact: true }).check();
  await page.getByLabel('주력 주제 (위에서 고른 것 중 하나)').selectOption('beauty');
  await page.getByLabel('목표 독자').fill('한국 화장품에 관심 있는 중국어 사용자');
  await page.getByRole('checkbox', { name: '중국어 연습', exact: true }).check();
  await page.getByRole('checkbox', { name: '브이로그', exact: true }).check();
  await page.getByRole('checkbox', { name: '루틴', exact: true }).check();
  await page.getByRole('button', { name: '계정 만들기' }).click();
  await page.waitForURL(/\/app\?account=/);
  await expect(page.getByRole('heading', { name: '맞춤 레퍼런스' })).toBeVisible();
  await expect(page.getByText('내 주력 주제와 같은 주제입니다.').first()).toBeVisible();

  // Discover with Korean query expansion (F04)
  await page.goto('/app/discover?q=스킨케어');
  await expect(page.getByText('중국어 후보(편집 시드 사전)')).toBeVisible();
  const card = page.locator('article', { hasText: '敏感肌早晚护肤顺序' });
  await expect(card).toBeVisible();
  await expect(card.getByText('조회수 제공 안 됨')).toBeVisible();
  await card.getByRole('button', { name: '☆ 저장' }).click();
  await expect(page.locator('article', { hasText: '敏感肌早晚护肤顺序' }).getByRole('button', { name: '★ 저장됨' })).toBeVisible();
  await page.locator('article', { hasText: '敏感肌早晚护肤顺序' }).getByRole('button', { name: '비교 추가' }).click();
  await expect(page.locator('article', { hasText: '敏感肌早晚护肤顺序' }).getByRole('button', { name: '비교에서 빼기' })).toBeVisible();
  await page.locator('article').filter({ has: page.getByRole('button', { name: '비교 추가' }) }).first().getByRole('button', { name: '비교 추가' }).click();
  await expect(page.getByRole('button', { name: '비교에서 빼기' })).toHaveCount(2);
  await page.getByRole('link', { name: /비교 \(2\/3\)/ }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveCount(3);
  await expect(page.getByRole('row', { name: /관찰 시점/ })).toBeVisible();

  // Empty result is honest
  await page.goto('/app/discover?q=양자역학');
  await expect(page.getByText('관련 근거가 부족합니다')).toBeVisible();

  // Reference from note (F05)
  await page.goto('/app/discover?q=敏感肌');
  await page.locator('article', { hasText: '敏感肌早晚护肤顺序' }).getByRole('button', { name: '레퍼런스로 가져오기' }).click();
  await page.waitForURL(/\/app\/references\/[0-9a-f-]{36}$/);
  const refUrl = page.url();

  // Analysis via quote → confirm → job (mock)
  await page.getByRole('button', { name: '분석하기' }).click();
  await expect(page.getByText('분석 실행 확인')).toBeVisible();
  await expect(page.getByText('0 (데모 모드, 실제 과금 없음)')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByText('관찰 사실', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('영상의 화면 구도·편집·장면 전환은 분석하지 않았습니다.')).toBeVisible();

  // F15 transcript (mock)
  await page.getByRole('link', { name: /추출하러 가기/ }).click();
  await page.getByRole('button', { name: '추출 요청' }).click();
  await expect(page.getByText('음성 문안 추출 확인')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByRole('heading', { name: '시간대별 문장' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('00:00')).toBeVisible();
  await expect(page.getByText('ASR 자동 받아쓰기라 오인식이 있을 수 있습니다.').first()).toBeVisible();
  await page.locator('details').first().locator('summary').click();
  await page.locator('details').first().getByRole('textbox', { name: '뜻' }).fill('여러분');
  await page.locator('details').first().getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('내 표현장에 저장했습니다(미검수).')).toBeVisible();

  // Re-analysis now includes the audio transcript scope
  await page.goto(refUrl);
  await page.getByRole('button', { name: '다시 분석' }).click();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByText('음성 문안', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Expressions (F07): personal entry is labelled unreviewed; sentence explanation
  await page.goto('/app/expressions?scope=mine');
  await expect(page.getByText('내 표현장 · 미검수').first()).toBeVisible();
  await page.goto('/app/expressions?sentence=' + encodeURIComponent('姐妹们，这个面霜我亲测好用'));
  await expect(page.getByText('직접 써 봄', { exact: false }).first()).toBeVisible();

  // Keywords (F06)
  await page.goto('/app/keywords');
  await expect(page.getByText(/표본: 게시물 \d+개/)).toBeVisible();
  await expect(page.getByText('공식 검색량이나 인기 순위가 아닙니다.', { exact: false })).toBeVisible();

  // Isolation: another student cannot open this reference
  await page.context().clearCookies();
  await login(page, 'student-a@demo.invalid');
  expect404 = true;
  const res = await page.goto(refUrl);
  expect(res?.status()).toBe(404);
  await expect(page.getByText('접근할 수 없는 항목입니다')).toBeVisible();
});

test('mobile home and discover render without horizontal overflow @mobile', async ({ page }) => {
  await login(page, 'student-a@demo.invalid');
  for (const path of ['/app', '/app/discover', '/app/references', '/app/expressions', '/app/keywords', '/app/plans', '/app/plans/new', '/app/check', '/app/submissions']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
