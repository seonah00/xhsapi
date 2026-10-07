import { expect, test } from '@playwright/test';

test('hashtag search quotes a fresh query and displays its completed results', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button',{name:/admin@demo\.invalid/}).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover');
  await page.getByRole('textbox',{name:'검색어',exact:true}).fill('#敏感肌');
  await page.getByRole('button',{name:'새 게시물 검색',exact:true}).click();
  await expect(page.getByText('검색어: 敏感肌',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'확인하고 실행'}).click();
  await expect(page.getByRole('status')).toContainText('완료',{timeout:20000});
  await expect(page.locator('article').first()).toBeVisible();
  await expect(page.getByText(/이번 조회의/)).toBeVisible();
  await expect(page).not.toHaveURL(/#refresh$/);
});

test('a thumbnail opens local detail with explicit original and title-search links', async ({ page, context }) => {
  const { default: pg } = await import('pg');
  const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
  const original='https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa?xsec_token=synthetic';
  const cover='https://sns-i10.rednotecdn.com/synthetic-thumbnail.svg';
  const row=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,cover_url,provenance)
    values ('00000000-0000-4000-b000-000000000001','mock','aaaaaaaaaaaaaaaaaaaaaaaa','mock',$1,'thumbnaillinkfixture',$2,'{}') returning id`,[original.split('?')[0],cover])).rows[0];
  try {
    await db.query(`insert into note_access_links(note_id,org_id,access_url,expires_at) values($1,'00000000-0000-4000-b000-000000000001',$2,now()+interval '1 hour')`,[row.id,original]);

    await context.route(cover, route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'}));
    await page.goto('/login');
    await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover?q=thumbnaillinkfixture');
    const link=page.getByRole('link',{name:'thumbnaillinkfixture 상세 보기'});
    await expect(link).toHaveAttribute('href',`/app/notes/${row.id}`);
    await expect(link.locator('img')).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/app/notes/${row.id}$`));
    await expect(page.getByRole('heading',{name:'thumbnaillinkfixture'})).toBeVisible();
    await expect(page.getByRole('link',{name:'제목으로 찾기 ↗'})).toBeVisible();
    const originalLink=page.getByRole('link',{name:'샤오홍슈 원문 ↗'});
    await expect(originalLink).toHaveAttribute('href',`/app/notes/${row.id}/original`);
    await expect(originalLink).toHaveAttribute('target','_blank');
    // Inspect the redirect without following it. Browser routing does not intercept every redirect hop.
    const response=await page.request.get(`/app/notes/${row.id}/original`,{maxRedirects:0});
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(original);
    expect(response.headers()['cache-control']).toContain('no-store');
    await db.query(`update note_access_links set expires_at=now()-interval '1 second' where note_id=$1`,[row.id]);
    await page.reload();
    await expect(page.getByRole('link',{name:'샤오홍슈 원문 ↗'})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'제목으로 찾기 ↗'})).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/app/notes/${row.id}$`));
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByRole('button',{name:/student-c@other-org\.demo\.invalid/}).click();
    await page.waitForURL(/\/app/);
    expect((await page.request.get(`/app/notes/${row.id}`)).status()).toBe(404);
  } finally { await db.query('delete from notes where id=$1',[row.id]); await db.end(); }
});


test('student discover has no paid search or cost confirmation controls', async ({page})=>{
  await page.goto('/login');
  await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/discover?q=敏感肌&refresh=1');
  await expect(page.getByRole('button',{name:'검색',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/새 게시물 검색|비용 확인 후 조회|확인하고 실행/})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'새 게시물 찾기'})).toHaveCount(0);
  await page.getByRole('textbox',{name:'검색어',exact:true}).fill('#敏感肌');
  await page.getByRole('button',{name:'검색',exact:true}).click();
  await expect(page.locator('article').first()).toBeVisible();
  await expect(page).not.toHaveURL(/quote=/);
});


test('an unavailable preferred cover falls back to the stored original cover', async ({page,context})=>{
  const {default:pg}=await import('pg');
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const org='00000000-0000-4000-b000-000000000001';
  const good='https://sns-i10.rednotecdn.com/synthetic-good.svg';
  const bad='https://sns-i10.rednotecdn.com/synthetic-bad.jpg';
  const note=(await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,cover_url,provenance)
    values ($1,'mock','alternate-cover-fixture','mock','https://demo.invalid/alternate','alternatecoverfixture',$2,'{}') returning id`,[org,good])).rows[0];
  const job=(await db.query(`insert into app_jobs(org_id,kind,data_mode,dedupe_key,state) values($1,'note_enrichment','mock','alternate-cover-fixture','succeeded') returning id`,[org])).rows[0];
  try {
    await db.query(`insert into note_enrichments(note_id,org_id,permission_id,cover_url,actor_build,job_id,expires_at) values($1,$2,null,$3,'1.0.0',$4,now()+interval '1 hour')`,[note.id,org,bad,job.id]);
    await context.route(bad,route=>route.abort());
    await context.route(good,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>'}));
    await page.goto('/login');
    await page.getByRole('button',{name:/admin@demo\.invalid/}).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover?q=alternatecoverfixture');
    await expect(page.locator('article img')).toHaveAttribute('src',good);
    await expect(page.getByText('표지를 불러오지 못함')).toHaveCount(0);
    await expect(page.getByRole('link',{name:/이미지 업데이트/})).toHaveCount(0);
  } finally { await db.query('delete from notes where id=$1',[note.id]);await db.query('delete from app_jobs where id=$1',[job.id]);await db.end(); }
});

test('student automatic search runs without cost controls and reuses the same search',async({page})=>{
  const {default:pg}=await import('pg');
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const org='00000000-0000-4000-b000-000000000001';
  const previous=(await db.query('select settings from organizations where id=$1',[org])).rows[0].settings;
  try {
    await db.query(`update organizations set settings=jsonb_set(settings,'{auto_search}',$2::jsonb) where id=$1`,[org,{enabled:true,approvedBy:'00000000-0000-4000-a000-000000000005',expiresAt:new Date(Date.now()+86400_000).toISOString(),cacheHours:24,perStudent:3,perDay:20,maxCny:'0.30'}]);
    await page.goto('/login');await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();await page.waitForURL(/\/app/);
    await page.goto('/app/discover');
    await page.getByRole('textbox',{name:'검색어',exact:true}).fill('自动测试');
    await page.getByRole('button',{name:'검색',exact:true}).click();
    await expect(page).toHaveURL(/auto=/);
    await expect(page.getByRole('status')).toContainText('최신 검색 결과',{timeout:20000});
    await expect(page.getByRole('button',{name:'확인하고 실행'})).toHaveCount(0);
    const first=new URL(page.url()).searchParams.get('auto');
    await page.getByRole('button',{name:'검색',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`auto=${first}`));
  } finally {await db.query('update organizations set settings=$2 where id=$1',[org,previous]);await db.end();}
});
