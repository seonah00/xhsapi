'use server';
import { headers } from 'next/headers';
import { AppError } from '@xhs/domain';
import { resettableMemberEmail } from '@xhs/core';
import { withAdmin } from '../forbidden-guard';
import { supabaseAuthEnabled } from '@/server/env';
import { publicOrigin, supabaseAuth } from '@/server/supabase';

export type ResetState = { link?: string; error?: string };

/** One-time password link for a member (no e-mail is sent). Returned once in the action result only. */
export async function passwordLinkAction(_prev: ResetState, f: FormData): Promise<ResetState> {
  if (!supabaseAuthEnabled()) return { error: '실제 로그인(Supabase)에서만 쓸 수 있습니다.' };
  if (f.get('confirm') !== 'on') return { error: '확인란에 체크하세요.' };
  try {
    const email = await withAdmin((ctx) => resettableMemberEmail(ctx, String(f.get('userId'))));
    const hash = await supabaseAuth().recoveryTokenHash(email);
    const h = await headers();
    return { link: `${publicOrigin(h.get('host'), h.get('x-forwarded-proto'))}/auth/set-password?token=${encodeURIComponent(hash)}` };
  } catch (e) {
    if (e instanceof AppError) return { error: e.messageKo };
    return { error: '링크를 만들 수 없습니다. 잠시 뒤 다시 시도하세요.' };
  }
}
