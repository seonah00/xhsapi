import { expect, test } from '@playwright/test';

/** Strict CSP: per-request script nonce, no inline-script allowance, locked-down API responses. */
test('pages carry a fresh nonce CSP and every script tag uses it', async ({ request, page }) => {
  const csp = async (path: string) => {
    const r = await request.get(path);
    return { csp: r.headers()['content-security-policy'] ?? '', html: await r.text() };
  };
  const a = await csp('/login');
  const b = await csp('/login');
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(a.csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(a.csp).not.toBe(b.csp);
  const scriptSrc = a.csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  expect(scriptSrc).not.toContain('unsafe-inline');
  expect(scriptSrc).not.toContain('unsafe-eval');
  expect(a.csp).toContain("frame-ancestors 'none'");
  const tags = [...a.html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(tags.length).toBeGreaterThan(0);
  for (const t of tags) expect(t, t).toContain(`nonce="${nonce}"`);

  const api = await request.get('/api/v1/me');
  expect(api.headers()['content-security-policy']).toContain("default-src 'none'");

  // The app still hydrates and works under the policy (CSP violations would surface as console errors).
  const violations: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CSP/i.test(m.text())) violations.push(m.text()); });
  await page.goto('/login');
  await page.getByRole('button', { name: /student-a@demo\.invalid/ }).click();
  await page.waitForURL(/\/app/);
  await page.goto('/no-such-page');
  await expect(page.getByText(/찾을 수 없|404/).first()).toBeVisible();
  expect(violations).toEqual([]);
});
