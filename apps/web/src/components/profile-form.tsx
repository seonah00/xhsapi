import type { AccountProfile } from '@xhs/core';
import { GOAL_LABELS, LEVEL_LABELS, TONE_LABELS } from '@xhs/core';
import { FORMAT_LABEL, TOPIC_LABEL } from './labels';
import { btn, input, label } from './ui';

export function profileFromForm(f: FormData): unknown {
  const list = (k: string) => f.getAll(k).map(String).filter(Boolean);
  const csv = (k: string) => String(f.get(k) ?? '').split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
  const opt = (k: string) => { const v = String(f.get(k) ?? '').trim(); return v ? v : undefined; };
  const childAllowed = f.get('childAllowed') === 'on';
  return {
    displayName: String(f.get('displayName') ?? ''),
    topics: list('topics'),
    mainTopic: String(f.get('mainTopic') ?? ''),
    subTopics: csv('subTopics'),
    audience: String(f.get('audience') ?? ''),
    goals: list('goals'),
    tone: String(f.get('tone') ?? ''),
    toneCustom: opt('toneCustom'),
    formats: list('formats'),
    chineseLevel: String(f.get('chineseLevel') ?? ''),
    showFace: f.get('showFace') === 'on',
    useVoice: f.get('useVoice') === 'on',
    profileUrl: opt('profileUrl'),
    region: opt('region'),
    audienceRegion: opt('audienceRegion'),
    ownedItems: opt('ownedItems'),
    shootingTime: opt('shootingTime'),
    avoidTopics: csv('avoidTopics'),
    childContent: childAllowed ? { allowed: true, ageBand: opt('ageBand') } : undefined,
  };
}

function Check({ name, value, checked, children }: { name: string; value: string; checked: boolean; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
      <input type="checkbox" name={name} value={value} defaultChecked={checked} className="accent-[var(--color-accent)]" />
      {children}
    </label>
  );
}

export function ProfileForm({ action, defaults, submitLabel, hidden }: {
  action: (f: FormData) => Promise<void>; defaults?: Partial<AccountProfile>; submitLabel: string; hidden?: Record<string, string>;
}) {
  const d = defaults ?? {};
  return (
    <form action={action} className="space-y-6">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">기본 방향 <span className="text-xs font-normal text-muted">(필수)</span></legend>
        <div>
          <label htmlFor="displayName" className={label}>계정 표시명</label>
          <input id="displayName" name="displayName" required maxLength={80} defaultValue={d.displayName} className={input} />
        </div>
        <div>
          <p className={label}>다룰 주제 (1개 이상)</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(TOPIC_LABEL).map(([v, l]) => <Check key={v} name="topics" value={v} checked={!!d.topics?.includes(v as never)}>{l}</Check>)}
          </div>
        </div>
        <div>
          <label htmlFor="mainTopic" className={label}>주력 주제 (위에서 고른 것 중 하나)</label>
          <select id="mainTopic" name="mainTopic" required defaultValue={d.mainTopic ?? ''} className={input}>
            <option value="" disabled>선택하세요</option>
            {Object.entries(TOPIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audience" className={label}>목표 독자</label>
          <textarea id="audience" name="audience" required maxLength={500} rows={2} defaultValue={d.audience} className={input} placeholder="예: 한국 여행을 준비하는 20~30대 중국어 사용자" />
        </div>
        <div>
          <p className={label}>운영 목표 (1개 이상)</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(GOAL_LABELS).map(([v, l]) => <Check key={v} name="goals" value={v} checked={!!d.goals?.includes(v as never)}>{l}</Check>)}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tone" className={label}>말투</label>
            <select id="tone" name="tone" required defaultValue={d.tone ?? 'friendly'} className={input}>
              {Object.entries(TONE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="toneCustom" className={label}>사용자 정의 말투 (선택)</label>
            <input id="toneCustom" name="toneCustom" maxLength={100} defaultValue={d.toneCustom} className={input} />
          </div>
        </div>
        <div>
          <p className={label}>촬영 가능한 형식 (1개 이상)</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(FORMAT_LABEL).map(([v, l]) => <Check key={v} name="formats" value={v} checked={!!d.formats?.includes(v as never)}>{l}</Check>)}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="chineseLevel" className={label}>중국어 수준</label>
            <select id="chineseLevel" name="chineseLevel" required defaultValue={d.chineseLevel ?? 'beginner'} className={input}>
              {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm sm:mt-6"><input type="checkbox" name="showFace" defaultChecked={d.showFace ?? false} /> 얼굴 노출 가능</label>
          <label className="flex items-center gap-2 text-sm sm:mt-6"><input type="checkbox" name="useVoice" defaultChecked={d.useVoice ?? true} /> 음성(목소리) 사용 가능</label>
        </div>
      </fieldset>

      <details className="rounded-2xl border border-line bg-surface p-4" open={!!d.region || !!d.avoidTopics?.length}>
        <summary className="cursor-pointer font-semibold">선택 입력</summary>
        <p className="mt-1 text-xs text-muted">링크나 팔로워 수가 없어도 사용할 수 있습니다. 링크를 저장해도 자동으로 외부 조회하지 않습니다.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="profileUrl" className={label}>샤오홍슈 프로필 링크</label><input id="profileUrl" name="profileUrl" type="url" defaultValue={d.profileUrl} className={input} /></div>
          <div><label htmlFor="subTopics" className={label}>보조 주제 (쉼표로 최대 3개)</label><input id="subTopics" name="subTopics" defaultValue={d.subTopics?.join(', ')} className={input} /></div>
          <div><label htmlFor="region" className={label}>거주·촬영 지역 (시·구 수준)</label><input id="region" name="region" defaultValue={d.region} className={input} placeholder="예: 서울 마포구" /></div>
          <div><label htmlFor="audienceRegion" className={label}>독자 관심 지역</label><input id="audienceRegion" name="audienceRegion" defaultValue={d.audienceRegion} className={input} /></div>
          <div><label htmlFor="ownedItems" className={label}>보유 제품·소재</label><input id="ownedItems" name="ownedItems" defaultValue={d.ownedItems} className={input} /></div>
          <div><label htmlFor="shootingTime" className={label}>가능한 촬영 시간·예산</label><input id="shootingTime" name="shootingTime" defaultValue={d.shootingTime} className={input} /></div>
          <div className="sm:col-span-2"><label htmlFor="avoidTopics" className={label}>피하고 싶은 주제 (쉼표 구분)</label><input id="avoidTopics" name="avoidTopics" defaultValue={d.avoidTopics?.join(', ')} className={input} /></div>
        </div>
        <div className="mt-4 rounded-xl bg-bg p-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="childAllowed" defaultChecked={!!d.childContent?.allowed} /> 자녀 관련 콘텐츠를 다룰 수 있음</label>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="ageBand">대략 연령대</label>
            <select id="ageBand" name="ageBand" defaultValue={d.childContent?.ageBand ?? ''} className="rounded-lg border border-line bg-surface px-2 py-1">
              <option value="">선택 안 함</option><option value="0-2">0~2세</option><option value="3-6">3~6세</option><option value="7-12">7~12세</option><option value="13+">13세 이상</option>
            </select>
          </div>
          <p className="mt-2 text-xs text-muted">자녀의 실명·학교·정확한 생일은 입력하지 마세요.</p>
        </div>
      </details>
      <button className={btn.primary}>{submitLabel}</button>
    </form>
  );
}
