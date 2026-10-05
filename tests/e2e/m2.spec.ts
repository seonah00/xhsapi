import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}
const autosaved = (page: Page) => expect(page.getByTestId('autosave-status')).toHaveText('저장됨', { timeout: 10_000 });

test('plan → AI proposal → check & fix → submit → reviewer feedback → withdraw', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  let allow404 = false;
  page.on('console', (m) => { if (m.type() === 'error' && !(allow404 && m.text().includes('status of 404'))) { console.log('[browser error]', page.url(), m.text()); errors.push(m.text()); } });

  // Reviewer adds an editorial rule with a suggestion and a dictionary entry.
  await login(page, 'reviewer@demo.invalid');
  await page.goto('/review/rules');
  await page.getByLabel('규칙 키 (영문 소문자·숫자·하이픈)').fill('no-shenqi');
  await page.getByLabel('찾을 문구 (최대 100자)').fill('神器');
  await page.getByLabel('설명 (학생에게 보이는 이유)').fill('과장으로 읽힐 수 있는 표현입니다');
  await page.getByLabel('수정 제안 (중국어, 선택)').fill('好用的小工具');
  await page.getByRole('button', { name: '초안 저장' }).click();
  await page.locator('li', { hasText: 'no-shenqi@1' }).getByRole('button', { name: '검토 후 활성화' }).click();
  await expect(page.locator('li', { hasText: 'no-shenqi@1' }).getByText('활성', { exact: true })).toBeVisible();
  await page.goto('/review/expressions');
  await page.getByLabel('표현 (중국어)').fill('氛围感');
  await page.getByLabel('실제 뜻').fill('분위기 있는 느낌');
  await page.getByRole('button', { name: '초안 저장' }).click();
  await page.locator('li', { hasText: '氛围感' }).getByRole('button', { name: '검수 완료' }).click();
  await page.locator('li', { hasText: '氛围感' }).getByRole('button', { name: '공개' }).click();
  await expect(page.locator('li', { hasText: '氛围感' }).getByText('공개', { exact: true })).toBeVisible();

  // Student: reference → plan
  await login(page, 'student-a@demo.invalid');
  await page.goto('/app/discover?q=' + encodeURIComponent('敏感肌'));
  await page.locator('article', { hasText: '敏感肌早晚护肤顺序' }).getByRole('button', { name: '레퍼런스로 가져오기' }).click();
  await page.getByRole('link', { name: '이 자료로 기획' }).click();
  await page.getByLabel('기획 이름').fill('E2E 민감성 루틴');
  await page.getByRole('button', { name: '기획 만들기' }).click();
  await page.waitForURL(/\/app\/plans\/[0-9a-f-]{36}$/);
  const planUrl = page.url();

  await page.getByLabel('실제로 다룰 대상·장소·제품·경험').fill('敏感肌面霜');
  await page.getByLabel('확인된 사실 (한 줄에 하나)').fill('我用了两周\n早晚各一次');
  await page.getByLabel('직접 촬영할 수 있는 장면 (한 줄에 하나)').fill('洗手台上涂抹');
  await page.getByLabel('광고·협찬 여부').selectOption('no');
  await autosaved(page);

  // AI proposal (mock) → apply
  await page.getByRole('button', { name: '제안 받기' }).click();
  await page.getByRole('button', { name: '확인하고 실행' }).click();
  await expect(page.getByText('제목 후보')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '이 제안 적용 (초안 교체)' }).click();
  await expect(page.getByText('AI 제안을 적용하고 새 버전으로 저장했습니다.', { exact: false })).toBeVisible();
  await expect(page.getByLabel(/본문 \(중국어\)/)).toHaveValue(/我用了两周/);

  // Edit with a flagged phrase and a phone number, save a version, check
  await page.getByLabel(/본문 \(중국어\)/).fill('这个面霜是护肤神器！我用了两周。电话13812345678');
  await autosaved(page);
  const v0 = await page.getByRole('button', { name: /버전 \d+ 점검/ }).textContent();
  await page.getByRole('button', { name: '버전 저장' }).click();
  await expect(page.getByRole('button', { name: /버전 \d+ 점검/ })).not.toHaveText(v0!);
  await page.getByRole('button', { name: /버전 \d+ 점검/ }).click();
  await expect(page.locator('mark', { hasText: '神器' })).toBeVisible();
  await expect(page.locator('mark', { hasText: '13812345678' })).toBeVisible();
  await page.locator('li', { has: page.locator('mark', { hasText: '神器' }) }).getByRole('button', { name: '수정 제안 적용' }).click();
  await expect(page.getByLabel(/본문 \(중국어\)/)).toHaveValue(/好用的小工具/);
  await expect(page.getByText('초안이 이 점검 이후 바뀌었습니다.', { exact: false })).toBeVisible();

  // Re-version, re-check, submit (wait for the new version number before checking)
  const before = await page.getByRole('button', { name: /버전 \d+ 점검/ }).textContent();
  await page.getByRole('button', { name: '버전 저장' }).click();
  await expect(page.getByRole('button', { name: /버전 \d+ 점검/ })).not.toHaveText(before!);
  await page.getByRole('button', { name: /버전 \d+ 점검/ }).click();
  await expect(page.locator('mark', { hasText: '神器' })).toHaveCount(0);
  await expect(page.getByText('공유되는 것')).toBeVisible();
  await page.getByRole('button', { name: '제출', exact: true }).click();
  await expect(page.getByText('제출했습니다.', { exact: false })).toBeVisible();

  // Reviewer reviews
  await login(page, 'reviewer@demo.invalid');
  await page.goto('/review/submissions');
  await page.getByRole('link', { name: /student-a@demo\.invalid/ }).first().click();
  await expect(page.getByText('好用的小工具', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '검토 시작' }).click();
  await expect(page.getByText('검토 중').first()).toBeVisible();
  const reviewUrl = page.url();
  await page.getByLabel('코멘트', { exact: true }).fill('전화번호는 지워 주세요.');
  await page.getByLabel('체크리스트 (한 줄에 하나, 선택)').fill('개인정보 삭제');
  await page.getByRole('radio', { name: '수정 요청' }).check();
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByText('피드백을 보냈습니다.')).toBeVisible();

  // A reviewer of another cohort cannot open it
  await login(page, 'reviewer-other-cohort@demo.invalid');
  allow404 = true;
  expect((await page.goto(reviewUrl))?.status()).toBe(404);
  allow404 = false;

  // Student sees feedback, the plan status did not change, then withdraws
  await login(page, 'student-a@demo.invalid');
  await page.goto('/app/submissions');
  await expect(page.getByText('수정 요청').first()).toBeVisible();
  await expect(page.getByText('최근 피드백: 전화번호는 지워 주세요.')).toBeVisible();
  await page.goto(planUrl);
  await expect(page.getByLabel('기획 상태')).toHaveValue('draft');
  await page.getByRole('button', { name: '철회' }).first().click();
  await expect(page.getByText('철회됨').first()).toBeVisible();

  // Reviewer loses access after withdrawal
  await login(page, 'reviewer@demo.invalid');
  allow404 = true;
  expect((await page.goto(reviewUrl))?.status()).toBe(404);
  allow404 = false;

  // Handoff + export
  await login(page, 'student-a@demo.invalid');
  await page.goto(`${planUrl}/handoff`);
  await expect(page.getByRole('button', { name: '본문 복사' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Markdown 내보내기' }).click()]);
  const md = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(md).toContain('데모 데이터');
  expect(md).toContain('게시 승인·법적 안전 보장 아님');

  // Published dictionary entry is visible to students
  await page.goto('/app/expressions?q=' + encodeURIComponent('氛围感'));
  await expect(page.getByText('검수됨').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('autosave conflict across two tabs and standalone check keeps text out of the URL', async ({ page, context }) => {
  await login(page, 'student-a@demo.invalid');
  await page.goto('/app/plans/new');
  await page.getByLabel('기획 이름').fill('충돌 테스트');
  await page.getByRole('button', { name: '기획 만들기' }).click();
  await page.waitForURL(/\/app\/plans\/[0-9a-f-]{36}$/);
  const other = await context.newPage();
  await other.goto(page.url());
  await page.getByLabel('제목 (중국어)').fill('第一个标签页');
  await autosaved(page);
  await other.getByLabel('제목 (중국어)').fill('第二个标签页');
  await expect(other.getByTestId('autosave-status')).toHaveText(/다른 곳에서 수정됨/, { timeout: 10_000 });
  await other.close();

  await page.goto('/app/check');
  await page.getByLabel('본문 (최대 10,000자)').fill('最好的面霜，联系13812345678');
  await page.getByRole('button', { name: '점검' }).click();
  await expect(page.locator('mark', { hasText: '13812345678' })).toBeVisible();
  expect(page.url()).not.toContain('13812345678');
  expect(page.url()).toMatch(/\/app\/check$/);
});
