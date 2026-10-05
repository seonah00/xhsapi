import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createTerm, listTaxonomy, setTermActive } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { Badge, btn, Card, ErrorNotice, input, label, PageHeader } from '@/components/ui';

export const metadata = { title: '분류 체계' };

const KIND: Record<string, string> = { topic: '주제(기본)', format: '형식(기본)', subtopic: '세부 주제', purpose: '목적', region: '지역', search_seed: '검색 시드' };

async function create(f: FormData) {
  'use server';
  await orRedirectWithError('/admin/taxonomy', () => withAdmin((ctx) => createTerm(ctx, {
    kind: String(f.get('kind')), slug: String(f.get('slug') ?? ''), labelKo: String(f.get('labelKo') ?? ''), labelZh: String(f.get('labelZh') ?? '').trim() || undefined,
  })));
  redirect('/admin/taxonomy');
}

async function toggle(f: FormData) {
  'use server';
  const id = z.string().uuid().parse(f.get('id'));
  await orRedirectWithError('/admin/taxonomy', () => withAdmin((ctx) => setTermActive(ctx, id, f.get('active') === '1')));
  redirect('/admin/taxonomy');
}

export default async function Taxonomy({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const terms = await withAdmin((ctx) => listTaxonomy(ctx, { includeInactive: true }));
  const kinds = [...new Set(terms.map((t) => t.kind))];
  return (
    <>
      <PageHeader title="분류 체계" description="기본 주제·형식은 고정입니다. 조직 전용 세부 주제·목적·지역·검색 시드를 추가할 수 있으며, 삭제 대신 비활성화합니다(기존 자료의 분류는 유지)." />
      <ErrorNotice message={error} />
      <Card className="mb-6">
        <h2 className="font-semibold">조직 분류 추가</h2>
        <form action={create} className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto] sm:items-end">
          <div><label htmlFor="kind" className={label}>종류</label><select id="kind" name="kind" className={input}>{['subtopic', 'purpose', 'region', 'search_seed'].map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></div>
          <div><label htmlFor="slug" className={label}>슬러그</label><input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,39}" placeholder="예: seoul-mapo" className={input} /></div>
          <div><label htmlFor="labelKo" className={label}>한국어 이름</label><input id="labelKo" name="labelKo" required maxLength={40} className={input} /></div>
          <div><label htmlFor="labelZh" className={label}>중국어 이름(선택)</label><input id="labelZh" name="labelZh" maxLength={40} lang="zh-CN" className={input} /></div>
          <button className={btn.primary}>추가</button>
        </form>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {kinds.map((k) => (
          <Card key={k}>
            <h2 className="font-semibold">{KIND[k] ?? k}</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              {terms.filter((t) => t.kind === k).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <span className={t.active ? '' : 'text-muted line-through'}>{t.labelKo}{t.labelZh && <span className="zh ml-1 text-muted" lang="zh-CN">{t.labelZh}</span>} <code className="text-xs text-muted">{t.slug}</code></span>
                  {t.global ? <Badge>기본</Badge> : (
                    <form action={toggle}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={t.active ? '0' : '1'} />
                      <button className={btn.small}>{t.active ? '비활성화' : '다시 활성화'}</button></form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
