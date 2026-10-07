import { redirect } from 'next/navigation';
import { autoSearchPolicy, setAutoSearchPolicy, effectiveSwitches, GATE_REASON_KO, liveReadiness, orgOps, providerOverview, setFeatureSwitches, setProviderSwitches } from '@xhs/core';
import { publicCapabilities } from '@xhs/domain';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { env } from '@/server/env';
import { Badge, btn, Card, ErrorNotice, Notice, PageHeader } from '@/components/ui';

export const metadata = { title: '공급자·스위치' };
const back = '/admin/providers';

async function saveFeatures(f: FormData) {
  'use server';
  await orRedirectWithError(back, () => withAdmin((ctx) => setFeatureSwitches(ctx, { ai: f.get('ai') === 'on', transcript: f.get('transcript') === 'on', provider_search: f.get('provider_search') === 'on' }, Number(f.get('revision')))));
  redirect(`${back}?saved=1`);
}
async function saveProvider(f: FormData) {
  'use server';
  if (f.get('confirm') !== 'on') redirect(`${back}?error=${encodeURIComponent('변경 내용을 확인했다고 체크하세요.')}`);
  await orRedirectWithError(back, () => withAdmin((ctx) => setProviderSwitches(ctx, { live: f.get('live') === 'on', kill: f.get('kill') === 'on' }, Number(f.get('revision')))));
  redirect(`${back}?saved=1`);
}
async function saveAutoSearch(f:FormData) {
  'use server';
  await orRedirectWithError(back,()=>withAdmin(ctx=>setAutoSearchPolicy(ctx,{
    enabled:f.get('enabled')==='on',cacheHours:Number(f.get('cacheHours')),perStudent:Number(f.get('perStudent')),perDay:Number(f.get('perDay')),maxCny:String(f.get('maxCny')),
    ...(f.get('expiresAt')?{expiresAt:new Date(String(f.get('expiresAt'))+'T23:59:59+09:00').toISOString()}:{})
  })));
  redirect(`${back}?saved=1`);
}
export default async function Providers({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const d = await withAdmin(async (ctx) => {
    const ops = await orgOps(ctx.db, ctx.orgId);
    return { auto:await autoSearchPolicy(ctx), overview: await providerOverview(ctx), readiness: await liveReadiness(ctx, env()), ops, effective: effectiveSwitches(env(), ops) };
  });
  const caps = publicCapabilities(env());
  return (
    <>
      <PageHeader title="공급자·기능 스위치" description="외부 호출은 환경 설정·조직 스위치·실제 단가·예산·사용자 승인이 모두 갖춰져야 실행됩니다. API 키는 이 화면에서 보거나 바꿀 수 없습니다." />
      <ErrorNotice message={sp.error} />
      {sp.saved && <div className="mb-3"><Notice tone="ok">저장했습니다. 변경은 감사 기록에 남습니다.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">환경 설정 (서버, 읽기 전용)</h2>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <li>데이터 모드: <Badge tone={caps.mode === 'mock' ? 'warn' : 'accent'}>{caps.mode}</Badge></li>
            <li>외부 공급자 호출: <Badge>{caps.liveProviderCalls ? '허용' : '꺼짐'}</Badge></li>
            <li>외부 AI 호출: <Badge>{caps.liveLlmCalls ? '허용' : '꺼짐'}</Badge></li>
            <li>Apify 상세 보완: <Badge>{env().APIFY_ENABLED ? '허용' : '꺼짐'}</Badge></li>
            <li>음성 문안 live: <Badge>{caps.transcript ? '허용' : '꺼짐'}</Badge></li>
          </ul>
          <p className="mt-2 text-xs text-muted">환경에서 꺼진 기능은 조직 스위치로 켤 수 없습니다. 현재 실제 live 가능 여부: <strong>{d.effective.live ? '가능' : '불가'}</strong></p>
        </Card>
        <Card>
          <h2 className="font-semibold">조직 기능 스위치</h2>
          <form action={saveFeatures} className="mt-2 space-y-1 text-sm">
            <input type="hidden" name="revision" value={d.ops.revision} />
            <label className="flex items-center gap-2"><input type="checkbox" name="ai" defaultChecked={d.ops.features.ai} /> AI 작업(분석·제안·문맥 점검·회고)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="transcript" defaultChecked={d.ops.features.transcript} /> 음성 문안 추출</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="provider_search" defaultChecked={d.ops.features.provider_search} /> 외부 자료 조회</label>
            <button className={btn.secondary}>저장</button>
          </form>
          <form action={saveProvider} className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            <input type="hidden" name="revision" value={d.ops.revision} />
            <label className="flex items-center gap-2"><input type="checkbox" name="live" defaultChecked={d.ops.provider.live} /> 이 조직의 live 공급자 호출 허용(환경·단가·예산도 필요)</label>
            <label className="flex items-center gap-2 text-accent"><input type="checkbox" name="kill" defaultChecked={d.ops.provider.kill} /> 전체 중지(kill switch): 새 작업과 대기 작업을 모두 막음</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" /> 변경 내용을 확인했습니다</label>
            <button className={btn.secondary}>적용</button>
          </form>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="font-semibold">학생 자동 검색</h2>
        <p className="mt-2 text-sm text-muted">학생 검색을 조직 예산으로 실행합니다. 동일 검색은 재사용하며 50건 목표로 최대 5페이지를 조회합니다. 실제 결과 수는 공급자에 따라 달라집니다. 표지 추가 조회는 포함하지 않습니다. 서버 AUTO_REFRESH_ENABLED도 켜야 합니다.</p>
        <form action={saveAutoSearch} className="mt-3 grid gap-2 text-sm">
          <label><input type="checkbox" name="enabled" defaultChecked={d.auto.enabled}/> 아래 범위의 학생 자동 검색 비용을 승인합니다</label>
          <label>승인 종료일(최대 31일) <input type="date" name="expiresAt" defaultValue={d.auto.expiresAt?.slice(0,10)}/></label>
          <label>검색 1회 최대 CNY <input name="maxCny" defaultValue={d.auto.maxCny} required/></label>
          <label>학생 1명 일일 새 검색 <input type="number" name="perStudent" min="1" max="20" defaultValue={d.auto.perStudent}/></label>
          <label>조직 일일 새 검색 <input type="number" name="perDay" min="1" max="100" defaultValue={d.auto.perDay}/></label>
          <label>동일 검색 재사용 시간 <input type="number" name="cacheHours" min="1" max="168" defaultValue={d.auto.cacheHours}/></label>
          <p>월간 CNY 예산도 함께 적용됩니다. 승인 만료·관리자 권한 해제·전체 중지 시 추가 호출을 중단합니다.</p>
          <button className={btn.secondary}>자동 검색 설정 저장</button>
        </form>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold">공급자 엔드포인트 상태</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 font-normal">ID</th><th scope="col" className="font-normal">경로</th><th scope="col" className="font-normal">파라미터</th><th scope="col" className="font-normal">검증</th><th scope="col" className="font-normal">단가</th><th scope="col" className="font-normal">단계</th></tr></thead>
            <tbody>{d.overview.capabilities.map((c) => (
              <tr key={c.endpoint} className="border-b border-line last:border-0">
                <td className="py-1.5 font-mono text-xs">{c.endpoint}</td><td className="max-w-[260px] truncate font-mono text-xs" title={c.path}>{c.path}</td>
                <td><Badge tone={c.paramsStatus === 'documented' ? 'neutral' : 'warn'}>{c.paramsStatus}</Badge></td><td><Badge>{c.verificationStatus}</Badge></td>
                <td><Badge tone={c.priceStatus === 'unknown' ? 'warn' : 'ok'}>{c.priceStatus === 'unknown' ? '미확인' : '확인'}</Badge>{c.price && <span className="ml-1 text-xs text-muted">{c.price}</span>}</td>
                <td>{c.phase === 'excluded' ? <Badge tone="accent">제외</Badge> : c.phase}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">모든 엔드포인트는 문서 확인 단계이며 실제 호출로 검증하지 않았습니다. 단가가 미확인이면 live 호출은 차단됩니다. 단가는 운영자가 근거와 함께 서버에서 등록합니다(<code>pnpm price</code>).</p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">live 전환 점검표</h2>
        <p className="mt-1 text-xs text-muted">명세 6.3 게이트를 이 조직의 현재 설정으로 평가한 결과입니다(외부 호출 없음). 요청할 때 따로 확인하는 항목: {d.readiness.perRequest.join(', ')}.</p>
        <p className="mt-1 text-xs">live 예산: {d.readiness.liveBudget ? `${d.readiness.liveBudget.limit} ${d.readiness.liveBudget.currency}` : '설정 없음'}</p>
        <p className="mt-1 text-xs">외부 검색에 쓰는 엔드포인트: <strong>{d.readiness.searchEndpoint}</strong> {d.readiness.searchEndpoint === 'RF02' ? '(표지·형식·조회수 포함)' : '(RF02는 검증된 단가가 필요)'}. 표지는 제공된 미리보기 주소로 표시합니다.</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {d.readiness.rows.map((r) => (
            <li key={r.endpoint} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-12 font-mono text-xs">{r.endpoint}</span>
              {r.ready ? <Badge tone="ok">준비됨</Badge> : <Badge tone="warn">차단 {r.reasons.length}</Badge>}
              <span className="text-xs text-muted">{r.reasons.map((x) => GATE_REASON_KO[x] ?? x).join(' · ')}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">실행과 비용 확인</h2>
        <p className="mt-2 text-sm">별도 이용 허가 승인이나 증빙 업로드 없이 예상 비용을 확인하고 실행할 수 있습니다. 예산 한도·중복 과금 방지·전체 중지 스위치는 계속 적용됩니다.</p>
        <p className="mt-2 text-xs text-muted">Apify 보완 자료는 24시간 보관하며 조직 안에서만 표시합니다.</p>
      </Card>
    </>
  );
}
