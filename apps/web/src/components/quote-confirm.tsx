import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import type { Quote } from '@xhs/core';
import { btn } from './ui';
import { PendingButton } from './pending-button';

/** Confirmation panel before any (paid-in-live) job: scope, limits, max cost, expiry (spec F04 step 3, 9.2). */
export function QuoteConfirm({ quote, title, scopeLines, action, hidden, cancelHref }: {
  quote: Quote & { consumed: boolean; expired: boolean }; title: string; scopeLines: string[];
  action: (f: FormData) => Promise<void>; hidden: Record<string, string>; cancelHref: string;
}) {
  const unusable = quote.consumed || quote.expired;
  return (
    <section aria-labelledby="quote-title" className="rounded-2xl border-2 border-accent/40 bg-surface p-4">
      <h2 id="quote-title" className="font-semibold">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {scopeLines.map((l) => <li key={l}>{l}</li>)}
        <li>최대 비용: {quote.mode === 'mock' ? '0 (데모 모드, 실제 과금 없음)' : <strong>{`${quote.maxAmount} ${quote.currency} (실제 비용, 조직 예산에서 예약)`}</strong>}</li>
        <li>오늘 사용: {quote.usedToday} / {quote.dailyLimit}회</li>
        <li>견적 만료: 5분 이내 확인 필요</li>
      </ul>
      <p className="mt-2 text-xs text-muted">작업을 취소해도 이미 발생한 외부 처리·비용의 취소는 보장되지 않습니다.</p>
      {unusable ? (
        <p className="mt-3 text-sm text-warn">{quote.consumed ? '이미 사용한 견적입니다.' : '견적이 만료되었습니다.'} 다시 요청하세요.</p>
      ) : (
        <form action={action} className="mt-3 flex flex-wrap gap-2">
          {Object.entries({ ...hidden, quoteId: quote.id, idem: randomUUID() }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {quote.mode === 'live' && (
            <label className="flex basis-full items-start gap-2 text-sm">
              <input type="checkbox" name="consent" required className="mt-1" />
              {quote.operation === 'reference_analysis' ? <span>제목·본문 발췌·태그·직접 입력한 텍스트와 메모가 OpenAI로 전송되고 조직 예산에서 비용이 발생하는 데 동의합니다. 이미지·영상·로그인 정보는 보내지 않습니다.</span> : <span>요청 정보(검색어 또는 노트 링크)가 외부 공급자({quote.operation === 'note_enrichment' ? 'Apify / Zen Studio' : 'RedFox'})로 전송되고 비용이 발생하는 것에 동의합니다. 내 문안·개인정보는 보내지 않습니다.</span>}
            </label>
          )}
          <PendingButton className={btn.primary} pendingText="요청 보내는 중…">확인하고 실행</PendingButton>
          <Link href={cancelHref} className={btn.secondary}>취소</Link>
        </form>
      )}
    </section>
  );
}
