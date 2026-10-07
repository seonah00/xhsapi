import { expect, test } from '@playwright/test';

/** A page opened before a redeploy posts to a server action the new server no longer has. */
test('stale server action after a redeploy reloads once, then explains instead of looping', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: /student-a@demo\.invalid/ }).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=' + encodeURIComponent('护肤'));
  // Simulate the new deployment: every server action answers "not found" the way Next.js does.
  await page.route('**/app/discover**', async (route) => {
    const r = route.request();
    if (r.method() === 'POST' && r.headers()['next-action']) {
      await route.fulfill({ status: 404, headers: { 'x-nextjs-action-not-found': '1', 'content-type': 'text/plain' }, body: 'Server action not found.' });
    } else await route.continue();
  });
  const save = page.getByRole('button', { name: '☆ 저장' }).first();
  await Promise.all([page.waitForEvent('load'), save.click()]); // first failure: automatic reload
  await expect(page.getByRole('heading', { name: '탐색' })).toBeVisible();
  await page.getByRole('button', { name: '☆ 저장' }).first().click(); // second failure within a minute: message, no loop
  await expect(page.getByRole('heading', { name: '새 버전이 배포되었습니다' })).toBeVisible();
  await expect(page.getByText('처리되지 않았습니다(비용 없음)', { exact: false })).toBeVisible();
});
