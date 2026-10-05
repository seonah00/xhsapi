import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { listMemberships, resolveRole, type Ctx, type Runner } from '@xhs/core';
import { AppError } from '@xhs/domain';
import { env } from './env';
import { withService, withUser } from './db';
import { readSession } from './session';

export const service: Runner = (fn) => withService(fn);

/** Page helper: requires login + selected org, re-checks membership in the same transaction. */
export async function withPageCtx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const s = await readSession();
  if (!s) redirect('/login');
  if (!s.orgId) redirect('/app/select-organization');
  const orgId = s.orgId;
  try {
    return await withUser(s.uid, async (db) => {
      const role = await resolveRole(db, s.uid, orgId);
      return fn({ db, uid: s.uid, orgId, role, mode: env().APP_DATA_MODE });
    });
  } catch (e) {
    if (e instanceof AppError && e.code === 'FORBIDDEN') redirect('/app/select-organization');
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
}

/** API helper: same checks, but throws AppError instead of redirecting. */
export async function withApiCtx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const s = await readSession();
  if (!s) throw new AppError('UNAUTHENTICATED', '로그인이 필요합니다.');
  if (!s.orgId) throw new AppError('FORBIDDEN', '조직을 먼저 선택하세요.');
  const orgId = s.orgId;
  return withUser(s.uid, async (db) => {
    const role = await resolveRole(db, s.uid, orgId);
    return fn({ db, uid: s.uid, orgId, role, mode: env().APP_DATA_MODE });
  });
}

export async function myMemberships(uid: string) {
  return withUser(uid, (db) => listMemberships(db, uid));
}

export async function currentUserEmail(uid: string): Promise<string | null> {
  return withService(async (db) => (await db.query<{ email: string }>(`select email from auth.users where id = $1`, [uid])).rows[0]?.email ?? null);
}
