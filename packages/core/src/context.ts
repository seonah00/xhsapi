import type pg from 'pg';
import { AppError, type DataMode, type OrgRole } from '@xhs/domain';

export type Db = pg.PoolClient;

/** Per-request context. `db` runs as the user with RLS; `service` bypasses RLS for server-owned writes. */
export type Ctx = {
  db: Db;
  uid: string;
  orgId: string;
  role: OrgRole;
  mode: DataMode;
};

export type ServiceRunner = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export async function listMemberships(db: Db, uid: string) {
  const r = await db.query<{ org_id: string; name: string; role: OrgRole }>(
    `select m.org_id, o.name, m.role from memberships m join organizations o on o.id = m.org_id
     where m.user_id = $1 and m.status = 'active' and o.status = 'active' order by o.name`,
    [uid],
  );
  return r.rows;
}

/** Server-side membership check on every request; never trusts org_id from the client body. */
export async function resolveRole(db: Db, uid: string, orgId: string): Promise<OrgRole> {
  const r = await db.query<{ role: OrgRole }>(
    `select role from memberships where org_id = $1 and user_id = $2 and status = 'active'`,
    [orgId, uid],
  );
  const role = r.rows[0]?.role;
  if (!role) throw new AppError('FORBIDDEN', '이 조직에 접근할 권한이 없습니다.');
  return role;
}

export function notFound(): never {
  throw new AppError('NOT_FOUND', '접근할 수 없는 항목입니다.');
}

export function pgCode(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : '';
  return /^([A-Z_]+)/.exec(msg)?.[1] ?? null;
}
