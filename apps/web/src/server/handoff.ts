import 'server-only';
import { checksForVersion, getPlan, type Ctx, type PlanVersion, type CheckRunView } from '@xhs/core';
import { notFound } from 'next/navigation';

export type Handoff = { planTitle: string; accountId: string; version: PlanVersion; check: CheckRunView | null; checkState: 'none' | 'partial' | 'ok'; unresolved: number; dataMode: string };

export async function loadHandoff(ctx: Ctx, planId: string, versionId?: string): Promise<Handoff> {
  const plan = await getPlan(ctx, planId);
  const version = versionId ? plan.versions.find((v) => v.id === versionId && v.kind === 'edit') : plan.versions.find((v) => v.kind === 'edit');
  if (!version) notFound();
  const check = (await checksForVersion(ctx, version.id))[0] ?? null;
  return {
    planTitle: plan.title, accountId: plan.accountId, version, check,
    checkState: !check ? 'none' : check.status === 'completed' ? 'ok' : 'partial',
    unresolved: check?.findings.filter((f) => f.requiresHumanReview).length ?? 0,
    dataMode: ctx.mode,
  };
}

export function toMarkdown(h: Handoff): string {
  const c = h.version.content;
  return [
    h.dataMode === 'mock' ? '> 데모 데이터 · 실제 샤오홍슈 데이터 아님' : '',
    `# ${c.title || h.planTitle}`,
    `- 기획 버전: v${h.version.version}`,
    `- 점검: ${h.checkState === 'none' ? '미점검' : h.checkState === 'partial' ? '부분 점검' : '점검 완료'} (게시 승인·법적 안전 보장 아님)`,
    '', '## 표지 문구', c.cover, '', '## 본문', c.body, '', '## 해시태그', c.tags.map((t) => `#${t}`).join(' '),
    '', '## 자막', c.subtitles, '', '## 촬영표', ...c.shots.map((s, i) => `${i + 1}. ${s.scene}${s.note ? ` — ${s.note}` : ''}`),
    '', '## 한국어 의미', c.meaningKo,
  ].filter((l) => l !== null).join('\n');
}
