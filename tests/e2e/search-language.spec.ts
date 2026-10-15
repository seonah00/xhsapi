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

 test('unverified long tails require a real search before tag selection', async ({page}) => {
  await page.goto('/login');
  await page.getByRole('button', {name: /student-b@demo\.invalid/}).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=' + encodeURIComponent('防晒霜推荐'));
  await expect(page.getByRole('heading', {name: '사전과 검색 결과로 키워드 정리'})).toBeVisible();
  await page.getByText(/검증 전 검색 후보 .*개 · AI·사전·대상 조합/).click();
  const candidate=page.getByRole('checkbox', {name: '#敏感肌防晒霜推荐', exact: true});
  await expect(candidate).toBeDisabled();
  await expect(page.getByRole('button', {name: '선택한 1개 태그 복사'})).toHaveCount(0);
  await expect(candidate.locator('..').locator('..').getByRole('button',{name:'실제 게시물로 검증'})).toBeVisible();
  await expect(page).not.toHaveURL(/auto=/);
  await page.getByLabel('대상 (예: 敏感肌)').fill('敏感肌');
  await expect(page.getByRole('button', {name: '조합한 키워드로 게시물 찾기'})).toBeEnabled();
  await page.getByLabel('대상 (예: 敏感肌)').fill('민감성');
  await expect(page.getByRole('button', {name: '조합한 키워드로 게시물 찾기'})).toBeDisabled();
 });

test('general expansion flows through consent and copy without retired planning link',async({page})=>{
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
 await expect(page.getByRole('button',{name:'선택한 1개 태그 복사'})).toBeVisible();
 await expect(page.getByRole('link',{name:/선택 키워드로 기획하기/})).toHaveCount(0);
});

test('verified hashtag reactions use exact medians and unverified candidates cannot be copied',async({page})=>{
 const {default:pg}=await import('pg');
 const {parseMetricValue}=await import('@xhs/domain');
 const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const ids:string[]=[];
 try {
  for(let i=0;i<3;i++) {
   const row=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,provider_tags,author_ref,observed_at,published_at,provenance)
    values('00000000-0000-4000-b000-000000000001','mock',$1,'mock','https://demo.invalid/keyword-proof',$2,array['合成可靠词'],$3,now(),now(),'{}') returning id`,[`keyword-proof-${i}`,`合成关键词证据 ${i}`,`synthetic-author-${i}`])).rows[0];
   ids.push(row.id);
   await db.query(`insert into metric_snapshots(note_id,observed_at,metrics_json) values($1,now(),$2)`,[row.id,{saves:parseMetricValue([10,20,999999][i]),likes:parseMetricValue(100+i)}]);
  }
  await page.goto('/login');await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q='+encodeURIComponent('合成关键词证据'));
  const evidence=page.getByRole('region',{name:'실사용 검증 결과'});
  await expect(evidence).toContainText('실사용 확인 · 현재 표본 3/3건');
  await expect(evidence).toContainText('확인된 작성자 3명 · 비교 표본 충분');
  await expect(evidence).toContainText('저장 중앙값 20 · 정확한 수치 3/3건');
  await expect(evidence).toContainText('조회수 미제공');
  await expect(evidence.getByRole('link',{name:/근거 게시물/})).toHaveCount(3);
  await evidence.getByRole('checkbox',{name:'#合成可靠词',exact:true}).check();
  await expect(page.getByRole('button',{name:'선택한 1개 태그 복사'})).toBeVisible();
  await expect(page).not.toHaveURL(/auto=|quote=/);
  await page.goto('/app/discover?q='+encodeURIComponent('防晒霜推荐'));
  await page.getByText(/검증 전 검색 후보 .*개 · AI·사전·대상 조합/).click();
  const candidate=page.getByRole('checkbox',{name:'#敏感肌防晒霜推荐',exact:true});
  await expect(candidate).toBeDisabled();
  await candidate.locator('..').locator('..').getByRole('button',{name:'실제 게시물로 검증'}).click();
  await expect(page).toHaveURL(/q=%E6%95%8F%E6%84%9F%E8%82%8C%E9%98%B2%E6%99%92%E9%9C%9C%E6%8E%A8%E8%8D%90/);
  await expect(page.getByRole('region',{name:'실사용 검증 결과'})).toContainText('현재 표본에서 확인되지 않았습니다');
 } finally {await db.query('delete from notes where id=any($1::uuid[])',[ids]);await db.end();}
});
