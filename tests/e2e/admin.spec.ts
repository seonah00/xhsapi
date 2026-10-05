import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}

test('admin: cohort, invite, join, suspend, audit; students cannot reach /admin', async ({ page }) => {
  const errors: string[] = [];
  let expect404 = false;
  page.on('console', (m) => { if (m.type() === 'error' && !(expect404 && m.text().includes('status of 404'))) errors.push(m.text()); });

  // Non-admin: no admin nav, /admin is a 404.
  await login(page, 'student-a@demo.invalid');
  await expect(page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '관리자' })).toHaveCount(0);
  expect404 = true;
  expect((await page.goto('/admin'))?.status()).toBe(404);
  expect((await page.goto('/admin/members'))?.status()).toBe(404);
  expect404 = false;

  // Admin overview
  await login(page, 'admin@demo.invalid');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '관리자' }).click();
  await expect(page.getByRole('heading', { name: '관리자 개요' })).toBeVisible();

  // Cohort + seats
  await page.goto('/admin/cohorts');
  await page.getByLabel('기수 이름').fill('E2E 기수');
  await page.getByRole('button', { name: '기수 만들기' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 기수' })).toBeVisible();
  await page.getByLabel('추가할 멤버').selectOption({ label: 'student-b@demo.invalid (학생)' });
  await page.getByRole('button', { name: '배정', exact: true }).click();
  await page.getByLabel('추가할 멤버').selectOption({ label: 'reviewer-other-cohort@demo.invalid (강사)' });
  await page.getByRole('button', { name: '배정', exact: true }).click();
  await expect(page.getByText('학생 1명 · 강사 1명')).toBeVisible();

  // Last admin cannot demote themselves
  await page.goto('/admin/members');
  const me = page.locator('li', { hasText: 'admin@demo.invalid' }).first();
  await me.getByLabel('역할', { exact: true }).selectOption('student');
  await me.getByLabel('역할 변경 확인').check();
  await me.getByRole('button', { name: '역할 변경' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '마지막 관리자' })).toBeVisible();

  // Invitation link (shown once, not in the URL)
  await page.goto('/admin/invitations');
  await page.getByLabel('기수 (선택)').selectOption({ label: 'E2E 기수' });
  await page.getByRole('button', { name: '초대 링크 만들기' }).click();
  const link = (await page.getByTestId('invite-link').textContent())!;
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{32}$/);
  expect(page.url()).not.toContain(link.split('/').pop()!);

  // A user from the other org joins through the link
  await login(page, 'student-c@other-org.demo.invalid');
  await page.goto(new URL(link).pathname);
  await page.getByRole('button', { name: '조직에 참여하기' }).click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByRole('link', { name: /데모 샤오홍슈 클래스 · 학생/ })).toBeVisible();
  // Single-use: second redemption fails
  await page.goto(new URL(link).pathname);
  await page.getByRole('button', { name: '조직에 참여하기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '만료되었거나 이미 사용' })).toBeVisible();

  // Admin sees the new member and suspends them
  await login(page, 'admin@demo.invalid');
  await page.goto('/admin/members');
  const c = page.locator('li', { hasText: 'student-c@other-org.demo.invalid' });
  await expect(c.getByText('E2E 기수 · 학생')).toBeVisible();
  await c.getByLabel('접근 중지 확인').check();
  await c.getByRole('button', { name: '중지' }).click();
  await expect(page.locator('li', { hasText: 'student-c@other-org.demo.invalid' }).getByText('중지됨')).toBeVisible();

  // Suspended member loses org1 access immediately
  await login(page, 'student-c@other-org.demo.invalid');
  await page.goto('/app/select-organization');
  const main = page.getByRole('main');
  await expect(main.getByText('데모 샤오홍슈 클래스')).toHaveCount(0);
  await expect(main.getByText('다른 조직(격리 테스트)')).toBeVisible();

  // Audit trail
  await login(page, 'admin@demo.invalid');
  await page.goto('/admin/audit');
  for (const action of ['기수 생성', '기수 배정', '초대 생성', '초대 수락', '멤버 변경']) {
    await expect(page.getByRole('cell', { name: action }).first()).toBeVisible();
  }
  await page.screenshot({ path: 'docs/screenshots/admin-desktop-audit.png', fullPage: true, caret: 'initial' });
  await page.goto('/admin/members');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'docs/screenshots/admin-desktop-members.png', fullPage: true, caret: 'initial' });
  expect(errors).toEqual([]);
});
