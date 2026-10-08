import Link from 'next/link';
import { getDictionaryImport, type DictionaryImportDiffItem } from '@xhs/core';
import { notFound } from 'next/navigation';
import { Badge, btn, Card, ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';
import { withAdmin } from '../../forbidden-guard';
import { completeDictionaryReview, publishDictionary } from './actions';

export const metadata = { title: '공용 사전 가져오기 검토' };

const ACTION: Record<DictionaryImportDiffItem['action'], { label: string; tone: 'ok' | 'info' | 'neutral' }> = {
  create: { label: '추가', tone: 'ok' },
  update: { label: '수정', tone: 'info' },
  unchanged: { label: '유지', tone: 'neutral' },
};
const ENTRY_TYPE = { tag: '태그', expression: '표현' };

type Params = { id: string };
type Search = {
  error?: string;
  staged?: string;
  reviewed?: string;
  published?: string;
  previewType?: string;
  previewPage?: string;
  previewPageSize?: string;
};

function previewHref(id: string, type: string | undefined, page: number, pageSize: number) {
  const query = new URLSearchParams();
  if (type === 'tag' || type === 'expression') query.set('previewType', type);
  if (page > 1) query.set('previewPage', String(page));
  query.set('previewPageSize', String(pageSize));
  return `/admin/dictionary/${id}?${query}`;
}

export default async function DictionaryImportDetail({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const detail = await withAdmin((ctx) => getDictionaryImport(ctx, id));
  const byKey = new Map(detail.preview.entries.map((entry) => [entry.canonicalKey, entry]));
  const previewType = sp.previewType === 'tag' || sp.previewType === 'expression' ? sp.previewType : undefined;
  const pageSize = sp.previewPageSize === '100' ? 100 : 50;
  const filteredDiff = previewType ? detail.preview.diff.items.filter((item) => item.entryType === previewType) : detail.preview.diff.items;
  const requestedPage = Math.max(1, Number.parseInt(sp.previewPage ?? '1', 10) || 1);
  const previewPages = Math.max(1, Math.ceil(filteredDiff.length / pageSize));
  const previewPage = Math.min(requestedPage, previewPages);
  const startIndex = (previewPage - 1) * pageSize;
  const visibleDiff = filteredDiff.slice(startIndex, startIndex + pageSize);
  return (
    <>
      <PageHeader title={detail.label} description={`태그 ${detail.counts.tags.toLocaleString()}개 · 표현 ${detail.counts.expressions.toLocaleString()}개 · 총 ${detail.counts.total.toLocaleString()}개`} actions={<Link href="/admin/dictionary" className={btn.secondary}>목록</Link>} />
      <ErrorNotice message={sp.error} />
      {sp.staged && <div className="mb-4"><Notice>정규화와 차이 계산이 끝났습니다. 내용을 확인한 뒤 검토 완료 처리하세요.</Notice></div>}
      {sp.reviewed && <div className="mb-4"><Notice tone="ok">검토 완료로 표시했습니다. 아직 학생 사전에는 반영되지 않았습니다.</Notice></div>}
      {sp.published && <div className="mb-4"><Notice tone="ok">공용 사전에 반영했습니다.</Notice></div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><p className="text-xs text-muted">새로 추가</p><p className="mt-1 text-2xl font-bold tabular-nums">{detail.preview.diff.counts.create.toLocaleString()}</p></Card>
        <Card><p className="text-xs text-muted">기존 항목 수정</p><p className="mt-1 text-2xl font-bold tabular-nums">{detail.preview.diff.counts.update.toLocaleString()}</p></Card>
        <Card><p className="text-xs text-muted">변경 없음</p><p className="mt-1 text-2xl font-bold tabular-nums">{detail.preview.diff.counts.unchanged.toLocaleString()}</p></Card>
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-semibold">변경 미리보기</h2><p className="mt-1 text-xs text-muted">정규화된 공개 항목만 표시합니다. 업로드 원문은 브라우저에 포함하지 않습니다.</p></div>
          <Badge tone={detail.status === 'published' ? 'ok' : detail.status === 'reviewed' ? 'info' : 'warn'}>{detail.status === 'published' ? '반영 완료' : detail.status === 'reviewed' ? '검토 완료' : '검토 전'}</Badge>
        </div>
        <form key={`${previewType ?? 'all'}-${pageSize}`} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">항목 종류
            <select name="previewType" defaultValue={previewType ?? ''} className="mt-1 block rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <option value="">태그와 표현 전체</option><option value="tag">태그</option><option value="expression">표현</option>
            </select>
          </label>
          <label className="text-sm">페이지당
            <select name="previewPageSize" defaultValue={String(pageSize)} className="mt-1 block rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <option value="50">50개</option><option value="100">100개</option>
            </select>
          </label>
          <button className={btn.secondary}>미리보기 적용</button>
        </form>
        <p className="mt-3 text-xs text-muted">
          {filteredDiff.length === 0 ? '표시할 항목 없음' : `${startIndex + 1}-${Math.min(startIndex + pageSize, filteredDiff.length)} / ${filteredDiff.length.toLocaleString()}개`}
          {previewType && ` · 전체 ${detail.preview.diff.items.length.toLocaleString()}개`}
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 font-normal">변경</th><th scope="col" className="font-normal">종류</th><th scope="col" className="font-normal">항목</th><th scope="col" className="font-normal">뜻</th><th scope="col" className="font-normal">분류</th><th scope="col" className="font-normal">주의</th></tr></thead>
            <tbody>
              {visibleDiff.map((diff) => {
                const entry = byKey.get(diff.canonicalKey);
                return (
                  <tr key={diff.canonicalKey} className="border-b border-line align-top last:border-0">
                    <td className="py-2"><Badge tone={ACTION[diff.action].tone}>{ACTION[diff.action].label}</Badge></td>
                    <td className="py-2">{ENTRY_TYPE[diff.entryType]}</td>
                    <td className="zh py-2 font-medium" lang="zh-CN">{diff.term}</td>
                    <td className="py-2">{entry?.meaning || '-'}</td>
                    <td className="py-2 text-xs text-muted">{entry?.categories.join(', ') || '-'}</td>
                    <td className="py-2 text-xs text-muted">{entry?.cautions.join(', ') || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {previewPages > 1 && (
          <nav aria-label="변경 미리보기 페이지" className="mt-4 flex items-center justify-center gap-2">
            {previewPage > 1 ? <Link href={previewHref(detail.id, previewType, previewPage - 1, pageSize)} className={btn.secondary}>이전</Link> : <span className={`${btn.secondary} pointer-events-none opacity-40`}>이전</span>}
            <Badge>{previewPage} / {previewPages}</Badge>
            {previewPage < previewPages ? <Link href={previewHref(detail.id, previewType, previewPage + 1, pageSize)} className={btn.secondary}>다음</Link> : <span className={`${btn.secondary} pointer-events-none opacity-40`}>다음</span>}
          </nav>
        )}
      </Card>

      {detail.status === 'staged' && (
        <Card className="mt-4">
          <h2 className="font-semibold">1. 검토 완료</h2>
          <p className="mt-1 text-sm text-muted">이 단계는 내용을 확인했다는 기록만 남깁니다. 학생 화면에는 아직 공개되지 않습니다.</p>
          <form action={completeDictionaryReview} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={detail.id} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" required className="mt-1" /><span>추가·수정·유지 건수와 정규화된 항목을 확인했습니다.</span></label>
            <button className={btn.primary}>검토 완료</button>
          </form>
        </Card>
      )}

      {detail.status === 'reviewed' && (
        <Card className="mt-4 border-accent/40">
          <h2 className="font-semibold">2. 공용 사전에 반영</h2>
          <p className="mt-1 text-sm text-muted">반영하면 이 조직의 학생이 검색하고 선택할 수 있습니다. 인기도·검색량 순위로 제공되는 정보가 아닙니다.</p>
          <form action={publishDictionary} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={detail.id} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" required className="mt-1" /><span>검토 결과를 학생용 공용 사전에 공개하는 것을 확인합니다.</span></label>
            <button className={btn.primary}>공용 사전에 반영</button>
          </form>
        </Card>
      )}

      {detail.status === 'published' && (
        <div className="mt-4"><Notice tone="ok">{fmtDate(detail.publishedAt, true)} 공용 사전에 반영됨 · 이후 가져오기는 새 리비전으로 별도 검토합니다.</Notice></div>
      )}
    </>
  );
}
