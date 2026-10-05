'use server';
import { createInvitation } from '@xhs/core';
import { AppError } from '@xhs/domain';
import { ZodError } from 'zod';
import { headers } from 'next/headers';
import { withAdmin } from '../forbidden-guard';

export type InviteState = { link?: string; error?: string };

/** Returns the link in the action result only: the token never goes into a URL, cookie or log. */
export async function createInviteAction(_prev: InviteState, f: FormData): Promise<InviteState> {
  try {
    const { token } = await withAdmin((ctx) => createInvitation(ctx, {
      role: String(f.get('role')), cohortId: String(f.get('cohortId') ?? '') || undefined,
      email: String(f.get('email') ?? '').trim() || undefined, expiresInDays: f.get('expiresInDays') ?? 7,
    }));
    const h = await headers();
    const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
    return { link: `${origin}/invite/${token}` };
  } catch (e) {
    if (e instanceof AppError) return { error: e.messageKo };
    if (e instanceof ZodError) return { error: '입력값을 확인하세요.' };
    throw e;
  }
}
