import { expressionGuide } from '@xhs/core/expression-guides';
import { listSharedDictionary } from '@xhs/core';
import { withPageCtx } from '@/server/ctx';
import { PageHeader } from '@/components/ui';
import { RediPicker } from './picker';

export const metadata = { title: 'REDi에 사용할 표현 선택' };
export default async function Page() {
  const items = await withPageCtx(async ctx => {
    const all = [];
    // Published shared entries only, with the existing membership and RLS checks.
    for (const entryType of ['expression', 'tag'] as const) {
      for (let page = 1; page <= 100; page++) {
        const result = await listSharedDictionary(ctx, { entryType, page, pageSize: 100 });
        all.push(...result.items);
        if (page * result.pageSize >= result.total) break;
      }
    }
    return all.map(({ id, entryType, term, meaning, usage, cautions, categories }) => ({ id, entryType, term, meaning, usage: usage ?? expressionGuide(term)?.situation ?? '', cautions: [...new Set([...cautions, ...(expressionGuide(term)?.avoid ? [expressionGuide(term)!.avoid] : [])])], categories }));
  });
  return <><PageHeader title="REDi에 사용할 표현 선택" description="검색어와 관련된 공용 사전 표현을 골라 가져오세요. 선택하지 않아도 REDi에서 작성할 수 있습니다."/><RediPicker items={items}/></>;
}
