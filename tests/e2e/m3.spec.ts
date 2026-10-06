import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (t: string, d: number[]) => [...u32(d.length), ...[...t].map((c) => c.charCodeAt(0)), ...d, 0, 0, 0, 0];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...u32(2), ...u32(2), 8, 2, 0, 0, 0]),
  ...chunk('tEXt', [...'GPS\0Seoul'].map((c) => c.charCodeAt(0))), ...chunk('IDAT', [1]), ...chunk('IEND', [])]);

test('results, uploads, library sharing, admin switches and data deletion', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  let allow422 = false;
  page.on('console', (m) => { if (m.type() === 'error' && !(allow422 && m.text().includes('status of 422'))) { console.log('[browser error]', page.url(), m.text()); errors.push(m.text()); } });

  // Results (student-b; onboard if this spec runs alone)
  await login(page, 'student-b@demo.invalid');
  await page.goto('/app/results');
  if (await page.getByText('먼저 계정 방향을 설정하세요').isVisible()) {
    await page.goto('/app/accounts/new');
    await page.getByLabel('계정 표시명').fill('M3 계정');
    await page.getByRole('checkbox', { name: '뷰티', exact: true }).check();
    await page.getByLabel('주력 주제 (위에서 고른 것 중 하나)').selectOption('beauty');
    await page.getByLabel('목표 독자').fill('중국어 사용자');
    await page.getByRole('checkbox', { name: '일상 기록', exact: true }).check();
    await page.getByRole('checkbox', { name: '루틴', exact: true }).check();
    await page.getByRole('button', { name: '계정 만들기' }).click();
    await page.waitForURL(/\/app\?account=/);
    await page.goto('/app/results');
  }
  await page.getByLabel('제목(메모용)').fill('첫 발행 루틴 영상');
  await page.getByLabel('형식').selectOption('routine');
  await page.getByRole('button', { name: '등록' }).click();
  await page.waitForURL(/\/app\/results\/[0-9a-f-]{36}$/);
  await page.getByLabel('관찰 시각').fill('2026-10-05T10:00');
  await page.getByLabel('좋아요').fill('120');
  await page.getByLabel('저장', { exact: true }).fill('30');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByText('새 관찰값을 기록했습니다.', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: '미확인' }).first()).toBeVisible();
  await page.getByRole('link', { name: '목록' }).click();
  await expect(page.getByText('계산 안 함')).toBeVisible();
  await expect(page.getByText('인과관계가 아닙니다', { exact: false })).toBeVisible();

  // Image upload on a fresh reference; other students cannot fetch it
  await page.goto('/app/discover?q=' + encodeURIComponent('咖啡'));
  await page.locator('article').first().getByRole('button', { name: '레퍼런스로 가져오기' }).click();
  await page.waitForURL(/\/app\/references\/[0-9a-f-]{36}$/);
  const refUrl = page.url();
  await page.getByLabel('이미지 추가').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  const img = page.locator('img[src^="/api/v1/assets/"]').first();
  await expect(img).toBeVisible();
  const assetUrl = (await img.getAttribute('src'))!;
  const res = await page.request.get(assetUrl);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('no-store');
  expect((await res.body()).includes('Seoul')).toBe(false);
  allow422 = true; // the disguised SVG upload is rejected on purpose
  await page.getByLabel('이미지 추가').setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)>') });
  await expect(page.getByRole('alert').filter({ hasText: '허용되지 않는 형식' })).toBeVisible();
  allow422 = false;

  // Request library sharing
  await page.getByLabel(/공유하는 데 동의합니다/).check();
  await page.getByRole('button', { name: '공유 요청' }).click();
  await expect(page.getByText('공유를 요청했습니다.', { exact: false })).toBeVisible();

  await login(page, 'student-a@demo.invalid');
  expect((await page.request.get(assetUrl)).status()).toBe(404);

  // Reviewer publishes; student-a sees it
  await login(page, 'reviewer@demo.invalid');
  await page.goto('/review/library');
  await page.getByRole('button', { name: '검토 후 공개' }).first().click();
  await expect(page.getByText('공개했습니다.')).toBeVisible();
  await login(page, 'student-a@demo.invalid');
  await page.goto('/app/library');
  await expect(page.locator('li').filter({ hasText: '공개' }).first()).toBeVisible();

  // Admin: evidence-based permission, kill switch
  await login(page, 'admin@demo.invalid');
  await page.goto('/admin/providers');
  await expect(page.getByRole('row', { name: /RFX1/ }).getByText('제외')).toBeVisible();
  await page.getByLabel(/증빙 파일 올리기/).setInputFiles({ name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo agreement') });
  await expect(page.getByText(/올린 증빙 \(1\): agreement\.pdf/)).toBeVisible();
  await expect(page.getByText('1개를 올렸습니다.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'RF13' }).check();
  await page.getByRole('checkbox', { name: 'RF14' }).check();
  await page.getByRole('button', { name: '대기 기록 만들기' }).click();
  const pending = page.locator('li').filter({ hasText: 'RF13, RF14' }).first();
  await expect(pending.getByText('대기')).toBeVisible();
  await pending.getByLabel('증빙 파일').selectOption({ label: 'agreement.pdf' });
  await pending.getByLabel('증빙과 허가 범위를 확인함').check();
  await pending.getByRole('button', { name: '승인' }).click();
  await expect(page.locator('li').filter({ hasText: 'RF13, RF14' }).first().getByText('승인', { exact: true })).toBeVisible();
  await expect(page.getByText('현재 실제 live 가능 여부: 불가', { exact: false })).toBeVisible();

  await page.getByLabel(/전체 중지\(kill switch\)/).check();
  await page.getByLabel('변경 내용을 확인했습니다').check();
  await page.getByRole('button', { name: '적용' }).click();
  await login(page, 'student-b@demo.invalid');
  await page.goto(refUrl);
  await page.getByRole('button', { name: /분석하기|다시 분석/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: '모두 중지' })).toBeVisible();
  await login(page, 'admin@demo.invalid');
  await page.goto('/admin/providers');
  await page.getByLabel(/전체 중지\(kill switch\)/).uncheck();
  await page.getByLabel('변경 내용을 확인했습니다').check();
  await page.getByRole('button', { name: '적용' }).click();
  await page.goto('/admin/usage');
  await expect(page.getByRole('heading', { name: /데모 사용/ })).toBeVisible();
  await page.goto('/admin/audit');
  await expect(page.getByRole('cell', { name: 'provider_permissions.update' }).first()).toBeVisible();

  // Data deletion (student-c is active only in the other org after the admin spec)
  await login(page, 'student-c@other-org.demo.invalid');
  await page.goto('/app/privacy');
  await page.getByLabel(/내 데이터를 삭제합니다/).fill('내 데이터를 삭제합니다');
  await page.getByRole('button', { name: '내 데이터 삭제 요청' }).click();
  await expect(page.getByText('삭제를 요청했습니다.', { exact: false })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('삭제 완료(일부 기록 보존)')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
