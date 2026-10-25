import {test,expect} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import pg from 'pg';
test('selection survives paging and search; draft preview and Korean review survive recovery @mobile',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const prefix='持久选择'+info.project.name;
 if(!process.env.DATABASE_URL?.includes('.tmp/pg'))throw new Error('Mock DB required');
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try{await db.query(`insert into personal_dictionary(org_id,owner_user_id,data_mode,entry_type,term,canonical_term,meaning,source_kind,saved_at) select '00000000-0000-4000-b000-000000000001','00000000-0000-4000-a000-000000000002','mock','tag',$1||n,$1||n,'합성 뜻','manual',now()-n*interval '1 second' from generate_series(1,13)n`,[prefix]);}finally{await db.end();}
 await page.goto('/login');await page.getByRole('button',{name:/student-b@demo.invalid/}).click();await page.waitForURL(/\/app/);
 await page.goto('/app/dictionary/mine?q='+encodeURIComponent(prefix));await page.getByLabel(prefix+'1 글쓰기 선택',{exact:true}).check();
 await page.getByRole('navigation',{name:'내 사전 페이지',exact:true}).getByRole('link',{name:'다음',exact:true}).click();await page.getByLabel(prefix+'13 글쓰기 선택',{exact:true}).check();await expect(page.getByText('2개 선택됨',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByLabel(prefix+'13 글쓰기 선택',{exact:true})).toBeChecked();await expect(page.getByRole('button',{name:'선택한 2개로 바로 글쓰기',exact:true})).toBeEnabled();
 await page.getByLabel('내 사전 검색',{exact:true}).fill('없는검색어'+prefix);await page.getByRole('button',{name:'검색',exact:true}).click();await expect(page.getByText('2개 선택됨',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'선택한 2개로 바로 글쓰기',exact:true}).click();await page.getByLabel('중국어 제목',{exact:true}).fill('预览标题');await page.getByLabel('중국어 본문',{exact:true}).fill('原来的正文');
 await page.getByLabel('한국어 확인본',{exact:true}).fill('기존 본문');
 await page.getByRole('button',{name:'한국어 확인본 검토 완료',exact:true}).click();
 await page.getByLabel('중국어 본문',{exact:true}).fill('修改后的正文');await expect(page.getByText(/중국어 원문과 한국어 확인본을 다시 대조/)).toBeVisible();
 await expect(page.getByRole('heading',{name:'게시물 미리보기',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'제목만 복사',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'본문만 복사',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'태그만 복사',exact:true})).toBeVisible();
 await expect(page.getByText('자동 임시 저장 완료',{exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'임시 저장 복원',exact:true}).click();await expect(page.getByLabel('중국어 본문',{exact:true})).toHaveValue('修改后的正文');await expect(page.getByText(/중국어 원문과 한국어 확인본을 다시 대조/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});

test('admin reviews a case, student adapts it and requests an immutable writing review @mobile',async({page},info)=>{
 const title='검토 사례 '+info.project.name;const login=async(email:string)=>{await page.context().clearCookies();await page.goto('/login');await page.getByRole('button',{name:new RegExp(email.replaceAll('.','\\.'))}).click();await page.waitForURL(/\/app/);};
 await login('admin@demo.invalid');await page.goto('/app/guides/new');
 for(const [label,value] of [['사례 이름',title],['독자','초보'],['상황','주말'],['표지 분석','한 장면'],['제목 분석','궁금증'],['본문 구성','경험과 정리'],['영상 구성','시작과 끝'],['참고할 요소','내 장면 순서'],['그대로 복사하면 안 되는 요소','남의 경험'],['내 소재로 바꾸는 질문 (한 줄에 하나, 최대 8개)','내 경험은?'],['검토 체크리스트 (한 줄에 하나, 최대 12개)','내 사실인가?']] as const)await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole('button',{name:'비공개로 저장',exact:true}).click();await page.waitForURL(/\/guides\/[0-9a-f-]+$/);const guideUrl=page.url();
 await login('student-a@demo.invalid');expect((await page.goto(guideUrl))?.status()).toBe(404);
 await login('admin@demo.invalid');await page.goto(guideUrl);await page.getByText('관리자 편집·공개',{exact:true}).click();await page.getByRole('checkbox',{name:/사실·구성/}).check();await page.getByRole('button',{name:'검토 완료 후 공개',exact:true}).click();await expect(page.getByText('관리자 검토 후 공개한 사례입니다.',{exact:true})).toBeVisible();
 await login('student-a@demo.invalid');await page.goto(guideUrl);await page.getByLabel('내 경험은?',{exact:true}).fill('내가 산책한 경험');await page.getByRole('button',{name:'답변을 글쓰기로 가져오기',exact:true}).click();await page.waitForURL(/\/app\/write$/);await page.getByRole('button',{name:'임시 저장 복원',exact:true}).click();await expect(page.getByLabel('개인 참고 메모 (검토 요청에 공유되지 않음)',{exact:true})).toHaveValue(/내가 산책한 경험/);
 await page.getByLabel('중국어 제목',{exact:true}).fill('提交内容'+info.project.name);await page.getByLabel('중국어 본문',{exact:true}).fill('提交的第一版');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();await expect(page.getByText(/버전 1 저장 완료/)).toBeVisible();await page.getByRole('link',{name:'저장본·이력 열기',exact:true}).click();await page.waitForURL(/\/history\/[0-9a-f-]+$/);const draftUrl=page.url();
 await page.getByRole('checkbox',{name:/선택한 저장본의 표지/}).check();await page.getByRole('button',{name:'이 버전 검토 요청',exact:true}).click();await page.waitForURL(/\/reviews\/[0-9a-f-]+$/);const reviewUrl=page.url();
 await page.goto(draftUrl);await page.getByLabel('중국어 본문',{exact:true}).fill('私人的第二版');await page.getByRole('button',{name:'작성 이력에 저장',exact:true}).click();await expect(page.getByText(/버전 2 저장 완료/)).toBeVisible();
 await login('reviewer@demo.invalid');await page.goto(reviewUrl);await expect(page.getByText('提交的第一版',{exact:true})).toBeVisible();await expect(page.getByText('私人的第二版',{exact:true})).toHaveCount(0);await expect(page.getByText('내가 산책한 경험',{exact:true})).toHaveCount(0);await page.getByLabel('피드백 내용',{exact:true}).fill('시작을 구체화하세요');await page.getByRole('button',{name:'피드백 저장',exact:true}).click();await expect(page.getByText('시작을 구체화하세요',{exact:true})).toBeVisible();
 await login('student-a@demo.invalid');await page.goto(reviewUrl);await expect(page.getByRole('link',{name:'내 작성물 이어서 수정',exact:true})).toHaveAttribute('href',new URL(draftUrl).pathname);
});
