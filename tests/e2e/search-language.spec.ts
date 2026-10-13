import { expect, test } from '@playwright/test';

test('Korean search previews a composed Chinese query; result evidence counts distinct notes',async({page})=>{
  const {default:pg}=await import('pg');
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const org='00000000-0000-4000-b000-000000000001';
  const row=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,body_excerpt,provider_tags,provenance)
    values($1,'mock','language-evidence-fixture','mock','https://demo.invalid/evidence','圣水洞 咖啡店 合成测试','yyds #咖啡[话题]# #咖啡[话题]#',array['咖啡'],'{}') returning id`,[org])).rows[0];
  try {
    await page.goto('/login');
    await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover');
    await page.getByRole('textbox',{name:'검색어',exact:true}).fill('성수동 카페');
    await page.getByRole('button',{name:'검색',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'중국어 검색어',exact:true})).toHaveValue('圣水洞 咖啡店');
    await expect(page).not.toHaveURL(/auto=/);
    await page.getByRole('button',{name:'이 중국어로 검색'}).click();
    const section=page.getByRole('region',{name:'이 검색에서 발견한 해시태그·표현'});
    await expect(section).toContainText('중복 제외 1개 게시물');
    await expect(section).toContainText('1/1개 게시물에서 발견');
    await expect(section).toContainText('yyds');
    await expect(section).toContainText('실제 사용 빈도가 아닙니다');
    await section.locator('summary').first().click();
    await expect(section.getByRole('link',{name:'圣水洞 咖啡店 合成测试'}).first()).toHaveAttribute('href',`/app/notes/${row.id}`);
    await page.getByRole('textbox',{name:'검색어',exact:true}).fill('알수없는단어 카페');
    await page.getByRole('button',{name:'검색',exact:true}).click();
    await expect(page.getByText(/아직 변환하지 못한 단어:/)).toBeVisible();
    await expect(page.getByRole('textbox',{name:'중국어 검색어',exact:true})).toHaveValue('');
  } finally {await db.query('delete from notes where id=$1',[row.id]);await db.end();}
});

test('free Korean sentence follows AI preview, consent and worker completion without external calls',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/discover/language');
 await page.getByLabel('한국어로 찾고 싶은 내용').fill('비가 오는 날 서울에서 아이와 실내에서 놀 곳');
 await page.getByRole('button',{name:'AI 중국어 검색어 만들기'}).click();
 await expect(page.getByRole('heading',{name:'AI 처리 확인'})).toBeVisible();
 await expect(page.getByText(/최대 .*CNY/)).toHaveCount(0);
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'AI 실행',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('완료',{timeout:20000});
 await expect(page.getByText('고정 데모 예시이며 실제 번역·분석 결과가 아닙니다.')).toBeVisible();
 await expect(page.getByRole('heading',{name:'旅行攻略'})).toBeVisible();
 await expect(page.getByRole('button',{name:'이 중국어로 게시물 검색'})).toBeVisible();
});

 test('keyword suggestions separate unverified long tails and allow selection without running searches', async ({page}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: /student-b@demo\.invalid/}).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=' + encodeURIComponent('防晒霜推荐'));
  await expect(page.getByRole('heading', {name: '사전과 검색 결과로 키워드 정리'})).toBeVisible();
  await page.getByRole('checkbox', {name: '#敏感肌防晒霜推荐', exact: true}).check();
  await expect(page.getByRole('button', {name: '선택한 1개 태그 복사'})).toBeVisible();
  await expect(page).not.toHaveURL(/auto=/);
  await page.getByLabel('대상 (예: 敏感肌)').fill('敏感肌');
  await expect(page.getByRole('button', {name: '조합한 키워드로 게시물 찾기'})).toBeEnabled();
  await page.getByLabel('대상 (예: 敏感肌)').fill('민감성');
  await expect(page.getByRole('button', {name: '조합한 키워드로 게시물 찾기'})).toBeDisabled();
 });

test('general expansion flows through consent, selection and a private plan with facts',async({page})=>{
 await page.goto('/login');
 await page.getByRole('button',{name:/student-a@demo\.invalid/}).click();
 await page.waitForURL(/\/app/);
 await page.goto('/app/discover/language');
 await page.getByLabel('연관·롱테일 키워드를 찾을 주제').fill('저당 도시락');
 await page.getByRole('button',{name:'AI 키워드 확장 준비'}).click();
 await expect(page.getByText('확장할 검색 주제: 저당 도시락')).toBeVisible();
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'AI 실행',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('완료',{timeout:20000});
 await expect(page.getByText('고정 데모 예시이며 실제 번역·분석 결과가 아닙니다.')).toBeVisible();
 await page.getByRole('checkbox',{name:'#雨天亲子旅行',exact:true}).check();
 await page.getByRole('link',{name:'선택 키워드로 기획하기 (1/8)'}).click();
 await page.getByLabel('기획 이름').fill('키워드에서 만든 기획');
 await page.getByLabel('직접 확인한 사실 (한 줄에 하나, 선택)').fill('직접 만든 도시락');
 await page.getByLabel('촬영 가능한 장면 (한 줄에 하나, 선택)').fill('도시락 준비 장면');
 await page.getByRole('button',{name:'기획실에 저장'}).click();
 await page.waitForURL(/\/app\/plans\/[0-9a-f-]{36}$/);
 await expect(page.getByRole('heading',{name:'키워드에서 가져온 기획 소재'})).toBeVisible();
 await expect(page.getByText('실사용 미확인 추천 후보')).toBeVisible();
 await expect(page.getByLabel('확인된 사실 (한 줄에 하나)')).toHaveValue('직접 만든 도시락');
 await page.getByRole('button',{name:'제안 받기',exact:true}).click();
 await page.getByRole('button',{name:'확인하고 실행'}).click();
 await expect(page.getByText('제목 후보')).toBeVisible({timeout:20000});
});
