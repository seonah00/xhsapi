import { redirect } from 'next/navigation';
import { createReference } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { orRedirectWithError } from '@/server/actions-util';
import { btn, Card, ErrorNotice, input, label, PageHeader } from '@/components/ui';

export const metadata = { title: '레퍼런스 추가' };

async function add(f: FormData) {
  'use server';
  const kind = String(f.get('sourceType'));
  const common = { title: String(f.get('title') ?? '').trim() || undefined, memo: String(f.get('memo') ?? '') || undefined, licenseAssertion: String(f.get('license') ?? 'reference_only') };
  const id = await orRedirectWithError('/app/references/new', () => withPageCtx((ctx) => createReference(ctx,
    kind === 'manual_url' ? { sourceType: 'manual_url', url: String(f.get('url') ?? ''), ...common } : { sourceType: 'pasted_text', text: String(f.get('text') ?? ''), ...common })));
  redirect(`/app/references/${id}`);
}

function Rights() {
  return (
    <fieldset className="text-sm">
      <legend className={label}>자료 권리</legend>
      <label className="mr-3"><input type="radio" name="license" value="reference_only" defaultChecked /> 참고용(타인 콘텐츠)</label>
      <label className="mr-3"><input type="radio" name="license" value="own_content" /> 내가 만든 콘텐츠</label>
      <label><input type="radio" name="license" value="licensed" /> 사용 허락 받음</label>
      <p className="mt-1 text-xs text-muted">공유 범위는 비공개(나만 보기)입니다.</p>
    </fieldset>
  );
}

export default async function NewReference({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="레퍼런스 직접 추가" description="링크만 저장하며 서버가 해당 페이지를 가져오지 않습니다. 이미지 첨부·분석은 다음 단계에서 지원합니다." />
      <ErrorNotice message={error} />
      <Card>
        <h2 className="font-semibold">링크 + 메모</h2>
        <form action={add} className="mt-3 space-y-3">
          <input type="hidden" name="sourceType" value="manual_url" />
          <div><label htmlFor="url" className={label}>링크</label><input id="url" name="url" type="url" required className={input} placeholder="https://www.xiaohongshu.com/explore/…" /></div>
          <div><label htmlFor="t1" className={label}>제목 (선택)</label><input id="t1" name="title" maxLength={200} className={input} /></div>
          <div><label htmlFor="m1" className={label}>내 메모</label><textarea id="m1" name="memo" rows={3} maxLength={5000} className={input} /></div>
          <Rights />
          <p className="text-xs text-muted">샤오홍슈 링크의 접근 토큰(xsec_token)과 추적 파라미터는 저장하지 않습니다.</p>
          <button className={btn.primary}>저장</button>
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">텍스트 붙여넣기</h2>
        <form action={add} className="mt-3 space-y-3">
          <input type="hidden" name="sourceType" value="pasted_text" />
          <div><label htmlFor="t2" className={label}>제목 (선택)</label><input id="t2" name="title" maxLength={200} className={input} /></div>
          <div><label htmlFor="txt" className={label}>본문</label><textarea id="txt" name="text" rows={6} required maxLength={20000} className={`${input} zh`} /></div>
          <div><label htmlFor="m2" className={label}>내 메모</label><textarea id="m2" name="memo" rows={2} maxLength={5000} className={input} /></div>
          <Rights />
          <button className={btn.primary}>저장</button>
        </form>
      </Card>
    </div>
  );
}
