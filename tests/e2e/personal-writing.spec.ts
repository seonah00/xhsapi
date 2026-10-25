import {test,expect} from '@playwright/test';
test('private dictionary to writing, saved versions and another student isolation without paid calls',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/student-a@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/dictionary/mine');
 await page.getByLabel('중국어 태그·표현').fill('记录生活测试');await page.getByLabel('내가 정리한 뜻').fill('생활 기록 검증용');await page.getByRole('button',{name:'내 항목 등록',exact:true}).click();
 await expect(page.getByRole('link',{name:'등록 완료 · 바로 글쓰기'})).toBeVisible();await page.getByRole('link',{name:'등록 완료 · 바로 글쓰기'}).click();
 await expect(page.getByRole('heading',{name:'바로 글쓰기',exact:true})).toBeVisible();
 await page.getByLabel('중국어 제목',{exact:true}).fill('个人写作测试');await page.getByLabel('중국어 본문',{exact:true}).fill('这是第一版。');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();
 await expect(page.getByText('버전 1 저장 완료',{exact:false})).toBeVisible();
 await page.getByLabel('중국어 본문',{exact:true}).fill('这是第二版。');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();
 await expect(page.getByText('버전 2 저장 완료',{exact:false})).toBeVisible();
 await page.getByRole('link',{name:'저장본·이력 열기',exact:true}).click();
 await page.waitForURL(/\/app\/write\/history\/[0-9a-f-]+$/);const savedUrl=page.url();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('这是第二版。');
 await page.getByText(/^버전 1 ·/).click();await expect(page.getByText('这是第一版。',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('这是第二版。');
 await page.context().clearCookies();await page.goto('/login');await page.getByRole('button',{name:/student-b@demo.invalid/}).click();await page.waitForURL(/\/app/);
 expect((await page.goto(savedUrl))?.status()).toBe(404);
});

test('private dictionary editing, classification and bilingual examples feed recoverable writing @mobile',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/student-a@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/dictionary/mine');await page.getByLabel('중국어 태그·표현').fill('松弛测试');await page.getByLabel('내가 정리한 뜻').fill('편안한 느낌');await page.getByRole('button',{name:'내 항목 등록',exact:true}).click();
 await expect(page.getByRole('link',{name:'등록 완료 · 바로 글쓰기'})).toBeVisible();
 const card=page.getByRole('listitem').filter({hasText:'松弛测试'});await card.getByText('뜻·분류·예문 수정',{exact:true}).click();
 const edit=card.getByRole('form',{name:'松弛测试 편집'});
 await edit.getByLabel('뜻',{exact:true}).fill('힘을 빼고 편안한 분위기');await edit.getByLabel('개인 메모',{exact:true}).fill('주말 콘텐츠');await edit.getByLabel('분류',{exact:true}).fill('일상');await edit.getByLabel('즐겨찾기',{exact:true}).check();await edit.getByLabel('사용법·사용 상황',{exact:true}).fill('편안한 주말 기록에 사용');
 await edit.getByLabel('중국어 예문 1',{exact:true}).fill('记录轻松的周末。');await edit.getByLabel('한국어 뜻 1',{exact:true}).fill('편안한 주말을 기록해요.');await edit.getByRole('button',{name:'사전 변경 저장',exact:true}).click();await expect(edit.getByText('사전 변경 저장 완료',{exact:true})).toBeVisible();
 await page.reload();await expect(card.getByText('사용법: 편안한 주말 기록에 사용',{exact:true})).toBeVisible();await card.getByText('예문·분류·관찰 정보',{exact:true}).click();await expect(card.getByText('记录轻松的周末。',{exact:true})).toBeVisible();
 await page.getByLabel('분류 필터').selectOption('일상');await page.getByLabel('즐겨찾기만').check();await page.getByRole('button',{name:'검색',exact:true}).click();await expect(card).toBeVisible();
 await card.getByRole('link',{name:'이 항목으로 글쓰기',exact:true}).click();await page.getByText('松弛测试 활용 보기',{exact:true}).click();await expect(page.getByText('내 사전 사용법: 편안한 주말 기록에 사용',{exact:true})).toBeVisible();
 await page.getByLabel('중국어 제목',{exact:true}).fill('恢复测试');await page.getByLabel('중국어 본문',{exact:true}).fill('没有手动保存的内容。');await expect(page.getByText('자동 임시 저장 완료',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'임시 저장 복원',exact:true})).toBeVisible();await page.getByRole('button',{name:'임시 저장 복원',exact:true}).click();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('没有手动保存的内容。');
 await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();await expect(page.getByText('버전 1 저장 완료',{exact:false})).toBeVisible();await expect(page.getByText('작성 이력에 저장됨',{exact:true})).toBeVisible();
 await page.goto('/app/write');await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'임시 저장 복원',exact:true})).toHaveCount(0);
});
