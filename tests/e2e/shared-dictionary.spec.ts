import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
  await page.waitForURL(/\/app/);
}

test('admin stages, reviews and publishes a private JSON import; students browse only public fields', async ({ page }) => {
  const errors: string[] = [];
  let expect404 = false;
  page.on('console', (message) => {
    if (message.type() === 'error' && !(expect404 && message.text().includes('status of 404'))) errors.push(message.text());
  });
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$|^wss?:$/.test(url.protocol) && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(request.url());
  });

  await login(page, 'student-a@demo.invalid');
  expect404 = true;
  expect((await page.goto('/admin/dictionary'))?.status()).toBe(404);
  expect404 = false;

  await login(page, 'admin@demo.invalid');
  await page.goto('/admin/dictionary');
  await expect(page.getByRole('heading', { name: '공용 사전' })).toBeVisible();
  await page.getByLabel('가져오기 이름').fill('E2E 공용 사전');
  const paginationTags = Array.from({ length: 24 }, (_, index) => ({
    id: `e2e-pagination-tag-${index + 1}`,
    term: `分页测试${String(index + 1).padStart(2, '0')}`,
    meaning: `페이지 이동 선택 유지 ${index + 1}`,
    kind: '편집 태그',
    categories: ['뷰티'],
    cautions: [],
    groups: ['페이지 테스트'],
    observation_count: index + 1,
  }));
  await page.getByLabel('JSON 파일 (최대 2MB)').setInputFiles({
    name: 'e2e-dictionary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      tags: [{
        id: 'e2e-glass-skin-tag', term: '水光肌', meaning: '물광 피부', kind: '편집 태그', categories: ['뷰티'],
        cautions: ['효과를 보장하는 표현과 함께 쓰지 않기'], groups: ['피부 표현'], observation_count: 12,
        private_source_note: 'PRIVATE_SOURCE_MUST_NOT_RENDER', source_url: 'https://private.invalid/source',
      }, ...paginationTags],
      expressions: [{
        id: 'e2e-soft-expression', term: '清透感', meaning: '맑고 가벼운 느낌', kind: '편집 표현', categories: ['뷰티'],
        cautions: [], groups: ['질감 표현'], trend_status: '미검증 관찰',
        private_quote: 'PRIVATE_QUOTE_MUST_NOT_RENDER',
      }],
    })),
  });
  await page.getByRole('button', { name: '가져와서 미리보기' }).click();
  await page.waitForURL(/\/admin\/dictionary\/[0-9a-f-]{36}\?staged=1$/);
  await expect(page.getByText('새로 추가').locator('..').getByText('26')).toBeVisible();
  await expect(page.getByText('PRIVATE_SOURCE_MUST_NOT_RENDER')).toHaveCount(0);
  await expect(page.getByText('PRIVATE_QUOTE_MUST_NOT_RENDER')).toHaveCount(0);
  await expect(page.getByText('https://private.invalid/source')).toHaveCount(0);
  const adminHtml = await page.content();
  expect(adminHtml).not.toContain('PRIVATE_SOURCE_MUST_NOT_RENDER');
  expect(adminHtml).not.toContain('PRIVATE_QUOTE_MUST_NOT_RENDER');
  expect(adminHtml).not.toContain('https://private.invalid/source');

  await page.getByLabel(/추가·수정·유지 건수/).check();
  await page.getByRole('button', { name: '검토 완료' }).click();
  await expect(page.getByText('아직 학생 사전에는 반영되지 않았습니다.')).toBeVisible();
  await page.getByLabel(/학생용 공용 사전에 공개/).check();
  await page.getByRole('button', { name: '공용 사전에 반영' }).click();
  await expect(page.getByText('공용 사전에 반영했습니다.')).toBeVisible();

  await login(page, 'student-a@demo.invalid');
  await page.goto('/app/dictionary?q=' + encodeURIComponent('水光肌'));
  await expect(page.getByRole('heading', { name: '공용 사전' })).toBeVisible();
  await expect(page.getByText('인기 순위, 검색량, 성과 보장을 뜻하지 않습니다.', { exact: false })).toBeVisible();
  await expect(page.getByText('水光肌', { exact: true })).toBeVisible();
  await expect(page.getByText('물광 피부', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE_SOURCE_MUST_NOT_RENDER')).toHaveCount(0);
  await expect(page.getByText('https://private.invalid/source')).toHaveCount(0);
  await page.getByLabel('水光肌 선택').check();
  await expect(page.getByText('태그 1/8 · 표현 0/3')).toBeVisible();
  const originalNotes = '집에서 저녁 스킨케어 뒤 촬영한 실제 기록';
  await page.getByLabel(/내 조건과 사실/).fill(originalNotes);
  await page.getByLabel(/내가 실제로 경험한 사실/).check();
  await page.getByRole('button', { name: '전송 내용·비용 미리보기' }).click();
  await expect(page.getByRole('heading', { name: '실행 전 최종 확인' })).toBeVisible();
  await expect(page.getByLabel(/내 조건과 사실/)).toHaveValue(originalNotes);
  await expect(page.getByText('gemini-3.8-flash', { exact: true })).toBeVisible();
  await expect(page.getByText('상류 API 최대 예상 비용')).toBeVisible();
  await expect(page.getByText('조직 예산 예약 상한')).toBeVisible();
  await expect(page.getByText('조직 예산 예약 상한').locator('..').getByText('0.06 USD', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '동의하고 1회 생성' })).toBeDisabled();
  expect(await page.content()).not.toContain('PRIVATE_SOURCE_MUST_NOT_RENDER');

  await page.getByLabel(/내 조건과 사실/).fill(`${originalNotes} 수정`);
  await expect(page.getByRole('heading', { name: '실행 전 최종 확인' })).toHaveCount(0);
  await expect(page.getByText('입력이나 선택 항목이 변경되었습니다. 생성 전에 새 미리보기가 필요합니다.')).toBeVisible();
  await page.getByLabel(/내 조건과 사실/).fill(originalNotes);
  await expect(page.getByRole('heading', { name: '실행 전 최종 확인' })).toHaveCount(0);
  await page.getByRole('button', { name: '전송 내용·비용 미리보기' }).click();
  await expect(page.getByRole('heading', { name: '실행 전 최종 확인' })).toBeVisible();
  await expect(page.getByLabel(/내 조건과 사실/)).toHaveValue(originalNotes);

  await page.getByLabel('태그·표현·뜻 검색').fill('');
  await page.getByLabel('항목 종류').selectOption('');
  await page.getByRole('button', { name: '검색' }).click();
  await expect(page.getByText('태그 1/8 · 표현 0/3')).toBeVisible();
  await expect(page.getByLabel('水光肌 선택 해제')).toBeVisible();
  await expect(page.getByLabel(/내 조건과 사실/)).toHaveValue(originalNotes);
  await page.getByRole('link', { name: '다음' }).click();
  await expect(page.getByText('태그 1/8 · 표현 0/3')).toBeVisible();
  await expect(page.getByLabel('水光肌 선택 해제')).toBeVisible();
  await expect(page.getByLabel(/내 조건과 사실/)).toHaveValue(originalNotes);

  await page.getByLabel('태그·표현·뜻 검색').fill('清透感');
  await page.getByLabel('항목 종류').selectOption('expression');
  await page.getByRole('button', { name: '검색' }).click();
  await expect(page.getByText('清透感', { exact: true })).toBeVisible();
  await expect(page.getByText('미검증 관찰', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE_QUOTE_MUST_NOT_RENDER')).toHaveCount(0);
  await expect(page.getByText('태그 1/8 · 표현 0/3')).toBeVisible();
  await expect(page.getByLabel(/내 조건과 사실/)).toHaveValue(originalNotes);
  await page.getByLabel('清透感 선택').check();
  await expect(page.getByText('태그 1/8 · 표현 1/3')).toBeVisible();
  await page.getByLabel('水光肌 선택 해제').click();
  await expect(page.getByText('태그 0/8 · 표현 1/3')).toBeVisible();

  const importer = page.getByRole('region', { name: '기획실 가져오기', exact: true });
  await expect(importer.getByRole('heading', { name: '기획실로 가져오기' })).toBeVisible();
  await importer.getByLabel('기획 이름', { exact: true }).fill('사전 촬영 작업지 테스트');
  await importer.getByLabel('가져올 중국어 제목', { exact: true }).fill('周末拍摄计划');
  await importer.getByLabel('썸네일 문구 (선택)', { exact: true }).fill('清透感');
  await importer.getByRole('button', { name: '비공개 기획으로 저장', exact: true }).click();
  await expect(importer.getByText('비공개 기획으로 저장했습니다.')).toBeVisible();
  await importer.getByRole('link', { name: '저장한 기획 열기' }).click();
  await expect(page.getByRole('heading', { name: '사전 촬영 작업지 테스트' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '공용사전에서 가져온 작업 메모' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '공용사전에서 가져온 작업 메모' })).toBeVisible();

  // Shooting preparation stays attached to the correct scene after reorder and reload.
  await page.getByRole('button', { name: '+ 장면 추가', exact: true }).click();
  await page.getByLabel('장면 1', { exact: true }).fill('공원 입구');
  await page.getByLabel('장면 1 구도', { exact: true }).fill('넓게 고정');
  await page.getByLabel('장면 1 자막', { exact: true }).fill('周末散步');
  await page.getByLabel('장면 1 준비물', { exact: true }).fill('삼각대');
  await page.getByLabel('장면 1 촬영 완료', { exact: true }).check();
  await page.getByRole('button', { name: '+ 장면 추가', exact: true }).click();
  await page.getByLabel('장면 2', { exact: true }).fill('산책길');
  await page.getByRole('button', { name: '장면 2 위로', exact: true }).click();
  await expect(page.getByLabel('장면 2 자막', { exact: true })).toHaveValue('周末散步');
  await expect(page.getByTestId('autosave-status')).toHaveText('저장됨');
  await page.reload();
  await expect(page.getByLabel('장면 1', { exact: true })).toHaveValue('산책길');
  await expect(page.getByLabel('장면 2 준비물', { exact: true })).toHaveValue('삼각대');
  await expect(page.getByLabel('장면 2 촬영 완료', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '버전 저장', exact: true }).click();
  await expect(page.getByText('버전으로 저장되지 않은 변경이 있습니다')).toHaveCount(0);
  await page.goto(page.url() + '/handoff');
  await expect(page.getByText('구도: 넓게 고정', { exact: false })).toBeVisible();
  await expect(page.getByText('준비물: 삼각대', { exact: false })).toBeVisible();

  expect(errors).toEqual([]);
  expect(external, 'dictionary flow must not contact external services').toEqual([]);
});
