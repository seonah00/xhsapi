import { redirect } from 'next/navigation';
import { approvePermission, createPermission, effectiveSwitches, GATE_REASON_KO, listMyAssets, liveReadiness, orgOps, providerOverview, revokePermission, setFeatureSwitches, setProviderSwitches } from '@xhs/core';
import { publicCapabilities } from '@xhs/domain';
import { withAdmin } from '../forbidden-guard';
import { orRedirectWithError } from '@/server/actions-util';
import { env } from '@/server/env';
import { Uploader } from '@/components/uploader';
import { Badge, btn, Card, ErrorNotice, input, Notice, PageHeader } from '@/components/ui';
import { fmtDate } from '@/components/labels';

export const metadata = { title: '공급자·스위치' };
const ALLOW: [string, string][] = [['allowFetch', '수집'], ['allowMetadataDisplay', '메타데이터 표시'], ['allowExcerptDisplay', '발췌 표시'], ['allowMediaDisplay', '미디어 표시'], ['allowAiProcessing', 'AI 가공'], ['allowCache', '캐시 보관']];
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
async function addPermission(f: FormData) {
  'use server';
  await orRedirectWithError(back, () => withAdmin((ctx) => createPermission(ctx, {
    provider: 'redfox', scope: String(f.get('scope') ?? 'environment'), allowedEndpoints: f.getAll('endpoints').map(String),
    ...Object.fromEntries(ALLOW.map(([k]) => [k, f.get(k) === 'on'])),
    cacheTtlSeconds: f.get('ttl') ? Number(f.get('ttl')) * 86400 : undefined,
    expiresAt: f.get('expiresAt') ? new Date(String(f.get('expiresAt'))).toISOString() : undefined,
  })));
  redirect(`${back}?saved=1`);
}
async function approve(f: FormData) {
  'use server';
  await orRedirectWithError(back, () => withAdmin((ctx) => approvePermission(ctx, String(f.get('id')), { evidenceAssetId: String(f.get('evidence') ?? ''), confirm: f.get('confirm') === 'on' })));
  redirect(`${back}?saved=1`);
}
async function revoke(f: FormData) {
  'use server';
  await orRedirectWithError(back, () => withAdmin((ctx) => revokePermission(ctx, String(f.get('id')))));
  redirect(`${back}?saved=1`);
}

export default async function Providers({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const d = await withAdmin(async (ctx) => {
    const ops = await orgOps(ctx.db, ctx.orgId);
    return { overview: await providerOverview(ctx), readiness: await liveReadiness(ctx, env()), ops, effective: effectiveSwitches(env(), ops), evidence: await listMyAssets(ctx, 'permission_evidence') };
  });
  const caps = publicCapabilities(env());
  return (
    <>
      <PageHeader title="공급자·기능 스위치" description="외부 호출은 환경 설정·조직 스위치·이용 허가·실제 단가·예산·사용자 승인이 모두 갖춰져야 실행됩니다. API 키는 이 화면에서 보거나 바꿀 수 없습니다." />
      <ErrorNotice message={sp.error} />
      {sp.saved && <div className="mb-3"><Notice tone="ok">저장했습니다. 변경은 감사 기록에 남습니다.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">환경 설정 (서버, 읽기 전용)</h2>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <li>데이터 모드: <Badge tone={caps.mode === 'mock' ? 'warn' : 'accent'}>{caps.mode}</Badge></li>
            <li>외부 공급자 호출: <Badge>{caps.liveProviderCalls ? '허용' : '꺼짐'}</Badge></li>
            <li>외부 AI 호출: <Badge>{caps.liveLlmCalls ? '허용' : '꺼짐'}</Badge></li>
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
            <label className="flex items-center gap-2"><input type="checkbox" name="live" defaultChecked={d.ops.provider.live} /> 이 조직의 live 공급자 호출 허용(환경·허가·단가·예산도 필요)</label>
            <label className="flex items-center gap-2 text-accent"><input type="checkbox" name="kill" defaultChecked={d.ops.provider.kill} /> 전체 중지(kill switch): 새 작업과 대기 작업을 모두 막음</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" /> 변경 내용을 확인했습니다</label>
            <button className={btn.secondary}>적용</button>
          </form>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="font-semibold">RedFox 엔드포인트 상태</h2>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">이용 허가 기록</h2>
          <p className="mt-1 text-xs text-muted">허가는 실제 계약·문서에 근거해야 합니다. 새 기록은 항상 “대기”로 만들어지고, 증빙을 첨부해 사람이 승인합니다.</p>
          <ul className="mt-3 space-y-2">
            {d.overview.permissions.length === 0 && <li className="text-sm text-muted">기록이 없습니다.</li>}
            {d.overview.permissions.map((p) => (
              <li key={p.id} className="rounded-xl bg-bg p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1"><Badge tone={p.status === 'approved' ? 'ok' : p.status === 'pending' ? 'warn' : 'neutral'}>{({ pending: '대기', approved: '승인', revoked: '철회', expired: '만료' } as Record<string, string>)[p.status]}</Badge>
                  <span className="font-mono text-xs">{p.endpoints.join(', ') || '엔드포인트 없음'}</span><span className="text-xs text-muted">· 만료 {fmtDate(p.expiresAt)}</span></div>
                <p className="mt-1 text-xs">{ALLOW.map(([k, l]) => `${l} ${p.allows[{ allowFetch: 'fetch', allowMetadataDisplay: 'metadata', allowExcerptDisplay: 'excerpt', allowMediaDisplay: 'media', allowAiProcessing: 'ai', allowCache: 'cache' }[k]!] ? '○' : '×'}`).join(' · ')}</p>
                {p.evidenceName && <p className="text-xs text-muted">증빙: {p.evidenceName} · 승인 {fmtDate(p.approvedAt, true)}</p>}
                {p.status === 'pending' && (
                  <form action={approve} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="sr-only" htmlFor={`ev-${p.id}`}>증빙 파일</label>
                    <select id={`ev-${p.id}`} name="evidence" required className="rounded-lg border border-line bg-surface px-2 py-1"><option value="">증빙 선택</option>{d.evidence.map((e) => <option key={e.id} value={e.id}>{e.originalName}</option>)}</select>
                    <label className="flex items-center gap-1"><input type="checkbox" name="confirm" /> 증빙과 허가 범위를 확인함</label>
                    <button className={btn.small}>승인</button>
                  </form>
                )}
                {(p.status === 'pending' || p.status === 'approved') && <form action={revoke} className="mt-1"><input type="hidden" name="id" value={p.id} /><button className={btn.ghost}>철회</button></form>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-semibold">새 허가 기록 (대기)</h2>
          <form action={addPermission} className="mt-3 space-y-2 text-sm">
            <fieldset><legend className="text-xs text-muted">엔드포인트</legend>
              <div className="flex flex-wrap gap-2">{d.overview.capabilities.filter((c) => c.phase !== 'excluded').map((c) => <label key={c.endpoint} className="font-mono text-xs"><input type="checkbox" name="endpoints" value={c.endpoint} /> {c.endpoint}</label>)}</div></fieldset>
            <fieldset><legend className="text-xs text-muted">허용 범위</legend>
              <div className="flex flex-wrap gap-2">{ALLOW.map(([k, l]) => <label key={k} className="text-xs"><input type="checkbox" name={k} /> {l}</label>)}</div></fieldset>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">캐시 보관 일수<input name="ttl" type="number" min={1} max={365} className={`${input} mt-1`} /></label>
              <label className="text-xs">허가 만료일<input name="expiresAt" type="date" className={`${input} mt-1`} /></label>
            </div>
            <p className="text-xs text-muted">조직 간 데이터 공유는 허가와 관계없이 지원하지 않습니다.</p>
            <button className={btn.secondary}>대기 기록 만들기</button>
          </form>
          <div className="mt-4 border-t border-line pt-3"><Uploader purpose="permission_evidence" label="증빙 파일 올리기(계약서·이메일 PDF 등)" accept="application/pdf,image/jpeg,image/png,image/webp" /></div>
        </Card>
      </div>
    </>
  );
}
