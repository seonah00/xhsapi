'use client';

import { useActionState, useId, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import type { DictionaryAiInput, DictionaryAiStatus, SharedDictionaryEntry } from '@xhs/core';
import { Badge, btn, Card } from '@/components/ui';
import { dictionaryAiAction, type DictionaryAiState } from './actions';
import {expressionGuide} from './expression-guides';
import { ExpressionPractice } from './expression-practice';
import { WritingEditor } from '@/components/writing-editor';
import { SavePersonal } from '@/components/save-personal';
import { CopyButton } from '@/components/copy-button';
import { dictionaryAiFormFingerprint } from './dictionary-ai-form-fingerprint';



const ENTRY_TYPE = { tag: '태그', expression: '표현' };
const MAX = { tag: 8, expression: 3 } as const;

const DISABLED_REASON: Record<Exclude<DictionaryAiStatus['disabledReason'], null>, string> = {
  environment_disabled: '서버의 AI 실행 설정이 꺼져 있습니다.',
  missing_api_key: 'Gemini API 키가 아직 설정되지 않았습니다.',
  missing_session_secret: '미리보기 서명 설정이 필요합니다.',
  invalid_fixed_config: '고정 모델·한도 설정을 확인해야 합니다.',
  mock_mode: '데모 모드에서는 외부 AI를 호출하지 않습니다.',
  organization_disabled: '조직의 AI 또는 live 실행 설정이 꺼져 있습니다.',
  monthly_limit: '이번 달 개인 생성 한도를 모두 사용했습니다.',
  global_cap: '전체 월간 AI 비용 한도에 도달했습니다.',
};

function AiComposer({
  chosen,
  canManage,
  status,
  selectionVersion,
  onRemove,
  standalone = false,
  panel,
  setPanel,
}: {
  standalone?: boolean;
  panel: 'write'|'ai';
  setPanel: (panel: 'write'|'ai') => void;
  chosen: SharedDictionaryEntry[];
  canManage: boolean;
  status: DictionaryAiStatus;
  selectionVersion: number;
  onRemove: (item: SharedDictionaryEntry) => void;
}) {
  const panelId = useId();
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'write' : event.key === 'End' ? 'ai' : panel === 'write' ? 'ai' : 'write';
    setPanel(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-panel="${next}"]`)?.focus();
  }
  const [state, action, actionPending] = useActionState<DictionaryAiState, FormData>(dictionaryAiAction, {});
  const [transitionPending, startTransition] = useTransition();
  const [category, setCategory] = useState<DictionaryAiInput['category']>('뷰티');
  const [mode, setMode] = useState<DictionaryAiInput['mode']>('record');
  const [tone, setTone] = useState<DictionaryAiInput['tone']>('friendly');
  const [disclosure, setDisclosure] = useState<DictionaryAiInput['disclosure']>('none');
  const [notes, setNotes] = useState('');
  const [experienceConfirmed, setExperienceConfirmed] = useState(false);
  const [externalConsent, setExternalConsent] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const pending = actionPending || transitionPending;
  const tags = chosen.filter((item) => item.entryType === 'tag');
  const expressions = chosen.filter((item) => item.entryType === 'expression');
  const currentInput = useMemo<DictionaryAiInput>(() => ({
    entryIds: chosen.map((item) => item.id),
    category,
    notes,
    mode,
    tone,
    disclosure,
    experienceConfirmed,
  }), [category, chosen, disclosure, experienceConfirmed, mode, notes, tone]);
  const currentFingerprint = useMemo(() => dictionaryAiFormFingerprint(currentInput), [currentInput]);
  const requestRevision = `${selectionVersion}:${formVersion}`;
  const previewIsCurrent = Boolean(
    state.preview
    && state.previewFingerprint === currentFingerprint
    && state.requestRevision === requestRevision,
  );
  const output = state.generation?.result;

  function invalidatePreview() {
    setFormVersion((current) => current + 1);
    setExternalConsent(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === 'generate' ? 'generate' : 'preview';
    const form = new FormData(event.currentTarget);
    form.set('intent', intent);
    form.set('formRevision', requestRevision);
    if (intent === 'preview') setExternalConsent(false);
    startTransition(() => action(form));
  }

  return (
    <Card>
      <h2 className="font-semibold">작성 도구</h2>
      <p className="mt-1 text-xs text-muted">선택한 공용사전·내 사전 항목과 직접 적은 조건만 사용합니다. 개인 초안과 결과는 공용 사전에 공유되지 않으며, 생성 결과는 게시 전에 직접 검토해야 합니다.</p>
      <p className="mt-3 text-sm">태그 {tags.length}/8 · 표현 {expressions.length}/3</p>
      {chosen.length === 0 ? <p className="mt-3 text-sm text-muted">{standalone ? <><Link href="/app/dictionary/mine" className="inline-flex min-h-11 items-center text-accent underline">내 사전에서 항목 선택</Link> · 항목 없이 직접 작성할 수도 있습니다.</> : '목록에서 항목을 선택하거나 바로 직접 작성하세요.'}</p> : (
        <ul className="mt-3 flex flex-wrap gap-1" aria-label="선택한 항목">
          {chosen.map((item) => (
            <li key={item.id}>
              <Badge tone={item.entryType === 'tag' ? 'info' : 'accent'}>
                <span className="zh" lang="zh-CN">{item.term}</span>
                <button type="button" onClick={() => onRemove(item)} aria-label={`${item.term} 선택 해제`} className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded font-bold">×</button>
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div role="tablist" aria-label="글쓰기 방식" className="mt-4 flex gap-2">
        {(['write','ai'] as const).map(value=><button key={value} id={`${panelId}-${value}-tab`} type="button" role="tab" data-panel={value} aria-selected={panel===value} aria-controls={`${panelId}-${value}-panel`} tabIndex={panel===value?0:-1} onKeyDown={navigateTabs} onClick={()=>setPanel(value)} className={`${panel===value?btn.primary:btn.secondary} min-h-11`}>{value==='write'?'직접 작성':'AI 도움'}</button>)}
      </div>
      <div id={`${panelId}-write-panel`} role="tabpanel" aria-labelledby={`${panelId}-write-tab`} hidden={panel!=='write'}>
        <WritingEditor entries={chosen} suggestion={output}/>
      </div>
      <div id={`${panelId}-ai-panel`} role="tabpanel" aria-labelledby={`${panelId}-ai-tab`} hidden={panel!=='ai'}>
      <h3 className="mt-4 font-semibold">AI 초안제시</h3>
      <p className="mt-1 text-xs text-muted">이번 달 생성 가능 {status.userMonthlyRemaining}/{status.userMonthlyLimit}회{canManage && <> · 월간 전체 상한 {status.globalMonthlyUsdLimit} USD</>}</p>
      {!status.enabled && status.disabledReason && <p role="status" className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">{canManage ? DISABLED_REASON[status.disabledReason] : '현재 AI 생성을 이용할 수 없습니다. 관리자에게 문의해 주세요.'} 미리보기는 가능하지만 실제 결과를 만들지는 않습니다.</p>}
      <form onSubmit={submit} className="mt-4 space-y-3">
        {chosen.map((item) => <input key={item.id} type="hidden" name="entryIds" value={item.id} />)}
        <label className="block text-sm">카테고리
          <select name="category" value={category} onChange={(event) => { setCategory(event.target.value as DictionaryAiInput['category']); invalidatePreview(); }} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <option value="맛집">맛집</option><option value="브이로그">브이로그</option><option value="일상">일상</option><option value="뷰티">뷰티</option>
          </select>
        </label>
        <label className="block text-sm">작성 방식
          <select name="mode" value={mode} onChange={(event) => { const nextMode = event.target.value as DictionaryAiInput['mode']; setMode(nextMode); if (nextMode === 'plan') setExperienceConfirmed(false); invalidatePreview(); }} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <option value="record">직접 경험 기록</option><option value="plan">촬영·방문 계획</option>
          </select>
        </label>
        {mode === 'record' && <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="experienceConfirmed" required checked={experienceConfirmed} onChange={(event) => { setExperienceConfirmed(event.target.checked); invalidatePreview(); }} className="mt-0.5" /><span>아래 메모는 내가 실제로 경험한 사실이며, 과장하거나 지어내지 않았습니다.</span></label>}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">말투
            <select name="tone" value={tone} onChange={(event) => { setTone(event.target.value as DictionaryAiInput['tone']); invalidatePreview(); }} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"><option value="calm">차분하게</option><option value="friendly">친근하게</option></select>
          </label>
          <label className="text-sm">광고 표시
            <select name="disclosure" value={disclosure} onChange={(event) => { setDisclosure(event.target.value as DictionaryAiInput['disclosure']); invalidatePreview(); }} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"><option value="none">해당 없음</option><option value="gifted">제품·서비스 제공</option><option value="paid">유료 광고</option></select>
          </label>
        </div>
        <label className="block text-sm">내 조건과 사실
          <textarea name="notes" required maxLength={2000} rows={6} value={notes} onChange={(event) => { setNotes(event.target.value); invalidatePreview(); }} placeholder={mode === 'record' ? '직접 경험한 장소·제품·과정·느낌을 사실대로 적으세요.' : '촬영하거나 방문할 계획과 아직 확인하지 않은 점을 구분해 적으세요.'} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
          <span className="mt-1 block text-xs text-muted">최대 2,000자. 비밀번호, 연락처, 비공개 출처 원문은 입력하지 마세요.</span>
        </label>
        {state.error && <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">{state.error}</p>}
        {state.preview && !previewIsCurrent && !output && <p role="status" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">입력이나 선택 항목이 변경되었습니다. 생성 전에 새 미리보기가 필요합니다.</p>}
        <button type="submit" name="intent" value="preview" disabled={pending || chosen.length === 0} className={`${btn.secondary} w-full`}>{pending ? '확인 중…' : canManage ? '전송 내용·비용 미리보기' : '전송 내용 미리보기'}</button>

        {state.preview && previewIsCurrent && !output && (
          <section aria-labelledby="ai-preview-title" className="rounded-xl border-2 border-accent/40 p-3">
            <h3 id="ai-preview-title" className="font-semibold">실행 전 최종 확인</h3>
            <dl className="mt-2 grid gap-1 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-muted">모델</dt><dd className="font-mono">{state.preview.model}</dd></div>
              {canManage && <div className="flex justify-between gap-2"><dt className="text-muted">상류 API 최대 예상 비용</dt><dd><strong>{state.preview.estimatedMaxCostUsd} USD</strong> · 추정치</dd></div>}
              {canManage && <div className="flex justify-between gap-2"><dt className="text-muted">조직 예산 예약 상한</dt><dd><strong>{status.reservationMaxCostUsd} USD</strong> · 실제 청구서 아님</dd></div>}
              <div className="flex justify-between gap-2"><dt className="text-muted">미리보기 만료</dt><dd>{new Date(state.preview.expiresAt).toLocaleString('ko-KR')}</dd></div>
            </dl>
            <details className="mt-3 rounded-lg bg-bg p-2 text-xs">
              <summary className="cursor-pointer font-medium">Gemini에 보낼 정확한 내용</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(state.preview.context, null, 2)}</pre>
            </details>
            <label className="mt-3 flex items-start gap-2 text-xs">
              <input type="checkbox" name="externalConsent" checked={externalConsent} onChange={(event) => setExternalConsent(event.target.checked)} className="mt-0.5" />
              <span>위 내용이 Google Gemini로 전송되는 데 동의합니다.{canManage && <> 조직 예산에서 최대 {status.reservationMaxCostUsd} USD가 예약됩니다. 호출 실패 시에도 예약·사용 기록이 남을 수 있으며 실제 청구서가 아닙니다.</>} 선택한 공용사전·내 사전 항목, 카테고리, 내 메모, 작성 방식, 말투, 광고 표시 외의 사전 원문·출처·인용문·URL은 보내지 않습니다.</span>
            </label>
            <input type="hidden" name="token" value={state.preview.token} />
            <button type="submit" name="intent" value="generate" disabled={pending || !status.enabled || !externalConsent} className={`${btn.primary} mt-3 w-full`}>{pending ? '생성 중…' : '동의하고 1회 생성'}</button>
            <p className="mt-2 text-xs text-muted">누르면 외부 AI 호출이 한 번 실행됩니다. 자동 재시도하지 않습니다.</p>
          </section>
        )}
      </form>

      {output && (
        <section aria-labelledby="ai-result-title" className="mt-4 space-y-3 rounded-xl border border-line bg-bg p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="ai-result-title" className="font-semibold">AI 초안제시 결과</h3><Badge tone="warn">검토 필요</Badge></div>
          {output.blockers.length > 0 && <div className="rounded-lg bg-accent-soft p-2 text-sm text-accent"><strong>진행 전 확인</strong><ul className="mt-1 list-disc pl-5">{output.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {output.warnings.length > 0 && <div className="rounded-lg bg-warn-soft p-2 text-sm text-warn"><strong>주의</strong><ul className="mt-1 list-disc pl-5">{output.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          <div><h4 className="text-sm font-semibold">제목 3안</h4><ol className="mt-1 space-y-2">{output.titles.map((title, index) => <li key={`${title.kind}-${index}`} className="rounded-lg bg-surface p-2 text-sm"><Badge>{title.kind}</Badge><p className="zh mt-1 font-medium" lang="zh-CN">{title.zh}</p><p className="mt-1 text-xs text-muted">{title.ko}</p></li>)}</ol></div>
          <div><h4 className="text-sm font-semibold">본문</h4><p className="zh mt-1 whitespace-pre-wrap rounded-lg bg-surface p-2 text-sm" lang="zh-CN">{output.bodyZh}</p><details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">한국어 확인본</summary><p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface p-2">{output.bodyKo}</p></details></div>
          <CopyButton text={[output.titles[0]?.zh, output.bodyZh, output.tags.join(' ')].filter(Boolean).join('\n\n')} label="제목·본문·태그 복사"/><div><h4 className="text-sm font-semibold">태그</h4><p className="zh mt-1 text-sm" lang="zh-CN">{output.tags.join(' ')}</p></div>
          {output.usedTerms.length > 0 && <div><h4 className="text-sm font-semibold">사용한 항목과 이유</h4><ul className="mt-1 space-y-1 text-xs">{output.usedTerms.map((item) => <li key={`${item.term}-${item.reason}`}><span className="zh font-medium" lang="zh-CN">{item.term}</span> · {item.reason}</li>)}</ul></div>}
          {output.heldTerms.length > 0 && <div><h4 className="text-sm font-semibold">보류한 항목과 이유</h4><ul className="mt-1 space-y-1 text-xs">{output.heldTerms.map((item) => <li key={`${item.term}-${item.reason}`}><span className="zh font-medium" lang="zh-CN">{item.term}</span> · {item.reason}</li>)}</ul></div>}
          <p className="text-xs text-muted">{canManage && <>모델 {state.generation?.model} · 예약 최대 비용 {state.generation?.usage.reservedMaxCostUsd} USD. 표시 비용은 실제 청구서가 아닌 상한 추정치입니다. </>} 이 결과는 내 비공개 초안이며 공용 사전에 추가되지 않습니다.</p>
        </section>
      )}
      {output && <button type="button" className={`${btn.secondary} mt-3`} onClick={()=>setPanel('write')}>결과를 직접 편집하기</button>}
      {output && !previewIsCurrent && <p role="status" className="mt-3 text-sm text-warn">생성 후 입력이 변경되었습니다. 현재 선택으로 새 미리보기를 만들거나 원래 결과를 복사해 보관하세요.</p>}
      </div>
      {chosen.length > 0 && <ExpressionPractice entries={chosen}/>}
    </Card>
  );
}

export function DictionaryWorkspace({ items, aiStatus, canManage = false }: { canManage?: boolean; items: SharedDictionaryEntry[]; aiStatus: DictionaryAiStatus }) {
  const composer = useRef<HTMLElement>(null);
  const composerId = useId();
  const [panel, setPanel] = useState<'write'|'ai'>('write');
  const [selectedItems, setSelectedItems] = useState<Map<string, SharedDictionaryEntry>>(() => new Map());
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [limitMessage, setLimitMessage] = useState<string>();
  const chosen = useMemo(() => Array.from(selectedItems.values()), [selectedItems]);

  function toggle(item: SharedDictionaryEntry, checked: boolean) {
    setLimitMessage(undefined);
    if (selectedItems.has(item.id) === checked) return;
    if (checked) {
      const currentTypeCount = chosen.filter((candidate) => candidate.entryType === item.entryType).length;
      if (currentTypeCount >= MAX[item.entryType]) {
        setLimitMessage(`${ENTRY_TYPE[item.entryType]}은 최대 ${MAX[item.entryType]}개까지 선택할 수 있습니다.`);
        return;
      }
    }
    const next = new Map(selectedItems);
    if (checked) next.set(item.id, item);
    else next.delete(item.id);
    setSelectedItems(next);
    setSelectionVersion((current) => current + 1);
  }

  return (
    <div className="pb-24 lg:pb-0">
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t border-line bg-surface p-3 shadow-lg lg:static lg:mb-4 lg:rounded-xl lg:border lg:shadow-none">
        <span aria-live="polite" className="text-sm">{chosen.length}개 선택됨</span>
        <button type="button" aria-controls={composerId} disabled={chosen.length===0} className={`${btn.primary} min-h-11`} onClick={()=>{setPanel('write');composer.current?.focus({preventScroll:true});composer.current?.scrollIntoView({block:'start',behavior:'auto'});}}>선택한 {chosen.length}개로 글쓰기</button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        {limitMessage && <p role="alert" className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{limitMessage}</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const checked = selectedItems.has(item.id);
            return (
              <li key={item.id}>
                <div className={`h-full break-words rounded-2xl border bg-surface p-4 ${checked?'border-accent ring-1 ring-accent':'border-line'}`}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={checked} onChange={event=>toggle(item,event.target.checked)} aria-label={`${item.term} 선택`}/><strong className="zh text-lg" lang="zh-CN">{item.term}</strong><Badge>{ENTRY_TYPE[item.entryType]}</Badge></label>
                <p className="mt-2 text-sm">{item.meaning}</p>{expressionGuide(item.term)?.situation&&<p className="mt-2 text-sm">사용 상황: {expressionGuide(item.term)?.situation}</p>}
                {item.cautions.length>0&&<p className="mt-2 text-xs text-warn">주의: {item.cautions.join(' · ')}</p>}{item.unknownTrendNote&&<p className="mt-1 text-xs text-warn">{item.unknownTrendNote}</p>}
                <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">분류·예문·관찰 정보</summary><div className="space-y-2">{item.categories.map(category=><Badge key={category}>{category}</Badge>)}{item.groups.length>0&&<p>묶음: {item.groups.join(', ')}</p>}{item.observedCount!==null&&<p>편집 자료에서 관찰 {item.observedCount}회 · 인기 지표 아님</p>}{expressionGuide(item.term)&&<><p lang="zh-CN">{expressionGuide(item.term)?.zh}</p><p>{expressionGuide(item.term)?.ko}</p></>}</div></details></div>
                <SavePersonal source={{kind:"shared",id:item.id}}/>
              </li>
            );
          })}
        </ul>
      </div>
      <aside ref={composer} id={composerId} tabIndex={-1} aria-label="선택한 사전 항목" className="min-w-0 scroll-mt-28 lg:sticky lg:top-4 lg:self-start">
        <AiComposer panel={panel} setPanel={setPanel} canManage={canManage} chosen={chosen} status={aiStatus} selectionVersion={selectionVersion} onRemove={(item) => toggle(item, false)} />
      </aside>
      </div>
    </div>
  );
}

export function DirectWriter({items,aiStatus,canManage}:{items:SharedDictionaryEntry[];aiStatus:DictionaryAiStatus;canManage:boolean}) {
 const [panel,setPanel]=useState<'write'|'ai'>('write');
 const [chosen,setChosen]=useState(items);const [version,setVersion]=useState(0);
 return <AiComposer standalone panel={panel} setPanel={setPanel} chosen={chosen} canManage={canManage} status={aiStatus} selectionVersion={version} onRemove={item=>{setChosen(current=>current.filter(e=>e.id!==item.id));setVersion(v=>v+1);}}/>;
}
