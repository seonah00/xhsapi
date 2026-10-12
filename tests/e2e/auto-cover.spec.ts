import { test, expect } from '@playwright/test';

test('student failed cover refreshes under sponsorship without paid controls or a resubmit loop', async ({page,context}) => {
  const {default:pg} = await import('pg');
  const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
  const org = '00000000-0000-4000-b000-000000000001';
  const bad = 'https://sns-i10.rednotecdn.com/auto-cover-bad.jpg';
  const good = 'https://sns-i10.rednotecdn.com/auto-cover-good.svg';
  const prior = (await db.query(`select settings from organizations where id=$1`,[org])).rows[0].settings;
  const note = (await db.query(`insert into notes(org_id,provider,platform_note_id,data_mode,canonical_url,title,cover_url,provenance)
    values($1,'mock','auto-cover-e2e','mock','https://demo.invalid/auto-cover','autocoverfixture',$2,'{}') returning id`,[org,bad])).rows[0].id;
  let submits = 0;
  try {
    await db.query(`update organizations set settings=jsonb_set(settings,'{auto_cover}',$2::jsonb) where id=$1`,[org,{enabled:true,expiresAt:new Date(Date.now()+86400_000).toISOString()}]);
    await context.route(bad,r=>r.abort());
    await context.route(good,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>'}));
    await page.route('**/api/covers/automatic',async route=>{
      submits++;
      expect(route.request().postDataJSON()).toEqual({noteIds:[note]});
      await db.query('update notes set cover_url=$2 where id=$1',[note,good]);
      await route.fulfill({contentType:'application/json',body:JSON.stringify({data:{jobId:'00000000-0000-4000-b000-000000000099'}})});
    });
    await page.route('**/api/covers/automatic/*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({data:{state:'succeeded'}})}));
    await page.goto('/login');
    await page.getByRole('button',{name:/student-b@demo\.invalid/}).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/discover?q=autocoverfixture');
    await expect(page.locator('article img')).toHaveAttribute('src',good,{timeout:15000});
    await expect(page.getByRole('link',{name:/이미지 업데이트/})).toHaveCount(0);
    await expect(page.getByRole('button',{name:/비용|확인하고 실행/})).toHaveCount(0);
    expect(submits).toBe(1);
  } finally {
    await db.query('update organizations set settings=$2 where id=$1',[org,prior]);
    await db.query('delete from notes where id=$1',[note]);
    await db.end();
  }
});
