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
  await expect(page.getByRole('heading', { name: '해시태그·표현 모음' })).toBeVisible();
  await expect(page.getByText('인기 순위, 검색량, 성과 보장을 뜻하지 않습니다.', { exact: false })).toBeVisible();
  await expect(page.getByText('水光肌', { exact: true })).toBeVisible();
  await expect(page.getByText('물광 피부', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE_SOURCE_MUST_NOT_RENDER')).toHaveCount(0);
  await expect(page.getByText('https://private.invalid/source')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'내 모음에 저장',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'관련 게시물 보기',exact:true})).toHaveAttribute('href','/app/discover?q='+encodeURIComponent('水光肌'));
  await page.getByRole('button',{name:'내 모음에 저장',exact:true}).click();
  await expect(page.getByRole('link',{name:'내 모음 보기',exact:true})).toBeVisible();
  await page.getByLabel('태그·표현·뜻 검색').fill('清透感');
  await page.getByLabel('항목 종류').selectOption('expression');
  await page.getByRole('button',{name:'검색',exact:true}).click();
  await expect(page.getByRole('heading',{name:'清透感',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'복사',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'AI 도움',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);expect(external,'dictionary flow must not contact external services').toEqual([]);
});
