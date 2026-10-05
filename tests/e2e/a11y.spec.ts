import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** WCAG 2.1 A/AA automated scan of the main screens (spec 10: accessibility). Manual checks remain separate. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.map((v) => `${path} ${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const STUDENT = ['/app', '/app/discover?q=' + encodeURIComponent('护肤'), '/app/discover/compare', '/app/reference-accounts', '/app/references', '/app/references/new', '/app/library',
  '/app/keywords', '/app/expressions', '/app/plans', '/app/plans/new', '/app/check', '/app/submissions', '/app/results', '/app/accounts', '/app/privacy'];
const STAFF = ['/review/submissions', '/review/library', '/review/expressions', '/review/rules', '/review/reports'];
const ADMIN = ['/admin', '/admin/members', '/admin/invitations', '/admin/cohorts', '/admin/taxonomy', '/admin/providers', '/admin/usage', '/admin/jobs', '/admin/audit'];

test('axe: no WCAG A/AA violations on core screens', async ({ page }) => {
  test.setTimeout(180_000);
  const found: string[] = [];
  await page.goto('/login');
  found.push(...await scan(page, '/login'));
  await login(page, 'student-a@demo.invalid');
  for (const p of STUDENT) found.push(...await scan(page, p));
  // Detail screens: a fresh plan and a reference from a stored note
  await page.goto('/app/plans/new');
  await page.getByLabel('기획 이름').fill('접근성 점검');
  await page.getByRole('button', { name: '기획 만들기' }).click();
  await page.waitForURL(/\/app\/plans\/[0-9a-f-]{36}$/);
  found.push(...await scan(page, new URL(page.url()).pathname));
  await page.goto('/app/discover?q=' + encodeURIComponent('敏感肌'));
  await page.getByRole('button', { name: '레퍼런스로 가져오기' }).first().click();
  await page.waitForURL(/\/app\/references\/[0-9a-f-]{36}$/);
  const ref = new URL(page.url()).pathname;
  found.push(...await scan(page, ref), ...await scan(page, `${ref}/transcript`));
  // Dark colour scheme on representative screens
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const p of ['/app', '/app/discover?q=' + encodeURIComponent('护肤'), '/app/check', ref]) found.push(...(await scan(page, p)).map((v) => `[dark] ${v}`));
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page, 'reviewer@demo.invalid');
  for (const p of STAFF) found.push(...await scan(page, p));
  await login(page, 'admin@demo.invalid');
  for (const p of ADMIN) found.push(...await scan(page, p));
  console.log(found.join('\n'));
  expect(found).toEqual([]);
});
