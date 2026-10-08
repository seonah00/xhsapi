import Link from 'next/link';
import { listDictionaryImports } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { Badge, Card, Empty, ErrorNotice, Notice, PageHeader } from '@/components/ui';
import { DictionaryUploadForm } from './upload-form';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '공용 사전' };

const STATUS = {
  staged: { label: '검토 전', tone: 'warn' as const },
  reviewed: { label: '검토 완료', tone: 'info' as const },
  published: { label: '반영 완료', tone: 'ok' as const },
};

type Params = { error?: string; imported?: string };

export default async function AdminDictionary({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const imports = await withAdmin((ctx) => listDictionaryImports(ctx));
  return (
    <>
      <PageHeader title="공용 사전" description="관리자가 JSON을 올리고 정규화 결과를 검토한 뒤, 별도 확인을 거쳐 학생용 공용 사전에 반영합니다." />
      <ErrorNotice message={sp.error} />
      {sp.imported && <div className="mb-4"><Notice tone="ok">공용 사전에 반영했습니다.</Notice></div>}

      <Card className="mb-6">
        <h2 className="font-semibold">JSON 가져오기</h2>
        <p className="mt-1 text-sm text-muted">원본 파일은 관리자 처리용 비공개 자료입니다. 학생 화면이나 공개 API에 원문·출처·인용문·URL을 노출하지 않습니다.</p>
        <DictionaryUploadForm />
      </Card>

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="mb-3 font-semibold">가져오기 기록</h2>
        {imports.length === 0 ? <Empty title="가져온 사전이 없습니다">JSON 파일을 올리면 검토용 미리보기가 만들어집니다.</Empty> : (
          <ul className="space-y-2">
            {imports.map((item) => (
              <li key={item.id}>
                <Link href={`/admin/dictionary/${item.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:border-accent">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="mt-1 text-xs text-muted">태그 {item.counts.tags.toLocaleString()}개 · 표현 {item.counts.expressions.toLocaleString()}개 · 총 {item.counts.total.toLocaleString()}개</p>
                    </div>
                    <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted">{fmtDate(item.createdAt, true)} 가져옴 · 리비전 {item.revision}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
