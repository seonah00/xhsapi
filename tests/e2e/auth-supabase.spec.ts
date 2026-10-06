import { expect, test, type Page } from '@playwright/test';

/**
 * @supabase — runs only with `E2E_AUTH=supabase bash scripts/e2e.sh` (local fake Supabase Auth/Storage).
 * The first admin comes from scripts/bootstrap-org.ts (E2E_ADMIN_LINK / E2E_ADMIN_EMAIL).
 */
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (t: string, d: number[]) => [...u32(d.length), ...[...t].map((c) => c.charCodeAt(0)), ...d, 0, 0, 0, 0];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...u32(2), ...u32(2), 8, 2, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND', [])]);

async function login(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
}

test('real login: bootstrap admin, invite-only sign-up, one-time password links, private storage @supabase', async ({ page }) => {
  test.setTimeout(120_000);
  const adminEmail = process.env.E2E_ADMIN_EMAIL!;
  const adminLink = process.env.E2E_ADMIN_LINK!;
  expect(adminLink).toMatch(/\/auth\/set-password\?token=/);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) { console.log('[browser error]', page.url(), m.text()); errors.push(m.text()); } });

  // No demo accounts in real-login mode.
  await page.goto('/login');
  await expect(page.getByText('데모 계정으로 로그인')).toHaveCount(0);

  // 1) First admin sets a password with the bootstrap link (single use).
  await page.goto(adminLink);
  await page.getByLabel('새 비밀번호 (10자 이상)').fill('admin-pass-2026!');
  await page.getByLabel('새 비밀번호 확인').fill('different-pass-2026');
  await page.getByRole('button', { name: '설정하기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '일치하지 않습니다' })).toBeVisible();
  await page.getByLabel('새 비밀번호 (10자 이상)').fill('admin-pass-2026!');
  await page.getByLabel('새 비밀번호 확인').fill('admin-pass-2026!');
  await page.getByRole('button', { name: '설정하기' }).click();
  await expect(page.getByText('비밀번호를 설정했습니다.')).toBeVisible();
  await page.goto(adminLink);
  await page.getByLabel('새 비밀번호 (10자 이상)').fill('another-pass-2026');
  await page.getByLabel('새 비밀번호 확인').fill('another-pass-2026');
  await page.getByRole('button', { name: '설정하기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '이미 사용되었습니다' })).toBeVisible();

  // 2) Wrong password is generic; right password signs in.
  await login(page, adminEmail, 'not-the-password');
  await expect(page.getByRole('alert').filter({ hasText: '이메일 또는 비밀번호가 올바르지 않습니다' })).toBeVisible();
  await login(page, adminEmail, 'admin-pass-2026!');
  await page.waitForURL(/\/app/);

  // 3) Admin creates a student invitation bound to an e-mail.
  await page.goto('/admin/invitations');
  await page.getByLabel('받는 사람 메모 (선택)').fill('student-e2e@example.invalid');
  await page.getByRole('button', { name: '초대 링크 만들기' }).click();
  const invite = (await page.getByTestId('invite-link').textContent())!;
  expect(invite).toMatch(/^http:\/\/localhost:\d+\/invite\//);

  // 4) The invitee creates an account (e-mail locked to the invitation) and joins.
  await page.context().clearCookies();
  await page.goto(invite);
  await expect(page.getByText('E2E 조직', { exact: false })).toBeVisible();
  await expect(page.getByLabel('이메일')).toHaveValue('student-e2e@example.invalid');
  await page.getByLabel('비밀번호 (10자 이상)').fill('student-pass-2026');
  await page.getByLabel('비밀번호 확인').fill('student-pass-2026');
  await page.getByRole('button', { name: '계정 만들고 참여하기' }).click();
  await page.waitForURL(/\/app/);

  // 5) Private image upload goes to the (fake) Supabase Storage and is served only through the gateway.
  await page.goto('/app/references/new');
  await page.getByLabel('본문').fill('스토리지 확인용 메모');
  await page.getByRole('button', { name: '저장' }).nth(1).click();
  await page.waitForURL(/\/app\/references\/[0-9a-f-]{36}$/);
  await page.getByLabel('이미지 추가').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  const img = page.locator('img[src^="/api/v1/assets/"]').first();
  await expect(img).toBeVisible();
  expect((await page.request.get((await img.getAttribute('src'))!)).status()).toBe(200);

  // 6) The used invitation cannot be reused.
  await page.context().clearCookies();
  await page.goto(invite);
  await expect(page.getByText('만료되었거나 이미 사용되었습니다', { exact: false })).toBeVisible();

  // 7) Admin issues a one-time password link for the student; the old password stops working.
  await login(page, adminEmail, 'admin-pass-2026!');
  await page.waitForURL(/\/app/);
  await page.goto('/admin/members');
  const row = page.locator('li', { hasText: 'student-e2e@example.invalid' });
  await row.getByLabel('비밀번호 링크 확인').check();
  await row.getByRole('button', { name: '비밀번호 설정 링크' }).click();
  const reset = (await row.getByTestId('password-link').textContent())!;
  await page.context().clearCookies();
  await page.goto(reset);
  await page.getByLabel('새 비밀번호 (10자 이상)').fill('student-new-2026');
  await page.getByLabel('새 비밀번호 확인').fill('student-new-2026');
  await page.getByRole('button', { name: '설정하기' }).click();
  await expect(page.getByText('비밀번호를 설정했습니다.')).toBeVisible();
  await login(page, 'student-e2e@example.invalid', 'student-pass-2026');
  await expect(page.getByRole('alert').filter({ hasText: '올바르지 않습니다' })).toBeVisible();
  await login(page, 'student-e2e@example.invalid', 'student-new-2026');
  await page.waitForURL(/\/app/);
  expect(errors).toEqual([]);
});
