import { randomBytes } from 'node:crypto';
import { AppError, sha256Hex, type OrgRole } from '@xhs/domain';
import { z } from 'zod';
import { notFound, pgCode, type Ctx, type Db } from './context.ts';

/** Admin services: org_admin only. None of these read student drafts (spec 1.2, F12). */
export function requireAdmin(ctx: Ctx): void {
  if (ctx.role !== 'org_admin') throw new AppError('FORBIDDEN', '조직 관리자만 사용할 수 있습니다.');
}

export type Member = { userId: string; email: string; role: OrgRole; status: 'active' | 'suspended' | 'left'; joinedAt: string; cohorts: { id: string; name: string; role: string }[] };

export async function listMembers(ctx: Ctx): Promise<Member[]> {
  requireAdmin(ctx);
  const dir = (await ctx.db.query(`select * from app.member_directory($1)`, [ctx.orgId])).rows;
  const cm = (await ctx.db.query(
    `select cm.user_id, c.id, c.name, cm.role from cohort_members cm join cohorts c on c.id = cm.cohort_id
     where cm.org_id = $1 and cm.status = 'active' and c.status = 'active' order by c.name`, [ctx.orgId],
  )).rows;
  return dir.map((d) => ({
    userId: d.user_id, email: d.email, role: d.role, status: d.status, joinedAt: d.joined_at.toISOString(),
    cohorts: cm.filter((c) => c.user_id === d.user_id).map((c) => ({ id: c.id, name: c.name, role: c.role })),
  }));
}

const ConfirmedChange = z.object({
  userId: z.string().uuid(),
  confirm: z.literal(true, { errorMap: () => ({ message: '변경 내용을 확인해 주세요.' }) }),
});

function mapAdminError(e: unknown): never {
  const code = pgCode(e);
  if (code === 'LAST_ADMIN') throw new AppError('CONFLICT', '마지막 관리자는 변경할 수 없습니다. 다른 관리자를 먼저 지정하세요.');
  if (code === 'COHORT_ROLE_MISMATCH') throw new AppError('VALIDATION_FAILED', '조직 역할과 기수 역할이 맞지 않습니다(학생은 학생으로, 강사는 강사·관리자만).');
  throw e;
}

export async function changeMemberRole(ctx: Ctx, input: { userId: string; role: OrgRole; confirm: boolean }): Promise<void> {
  requireAdmin(ctx);
  const { userId } = ConfirmedChange.parse(input);
  const role = z.enum(['student', 'reviewer', 'org_admin']).parse(input.role);
  try {
    const r = await ctx.db.query(`update memberships set role = $3 where org_id = $1 and user_id = $2 and status <> 'left'`, [ctx.orgId, userId, role]);
    if (!r.rowCount) notFound();
    // A cohort seat that no longer matches the org role is deactivated (e.g. reviewer → student).
    await ctx.db.query(
      `update cohort_members set status = 'removed' where org_id = $1 and user_id = $2 and status = 'active'
         and ((role = 'student' and $3 <> 'student') or (role = 'reviewer' and $3 = 'student'))`, [ctx.orgId, userId, role],
    );
  } catch (e) {
    mapAdminError(e);
  }
}

export async function setMemberStatus(ctx: Ctx, input: { userId: string; status: 'active' | 'suspended'; confirm: boolean }): Promise<void> {
  requireAdmin(ctx);
  const { userId } = ConfirmedChange.parse(input);
  const status = z.enum(['active', 'suspended']).parse(input.status);
  try {
    const r = await ctx.db.query(`update memberships set status = $3 where org_id = $1 and user_id = $2 and status <> 'left'`, [ctx.orgId, userId, status]);
    if (!r.rowCount) notFound();
  } catch (e) {
    mapAdminError(e);
  }
}

// ---------------------------------------------------------------- invitations

export const InvitationCreate = z.object({
  role: z.enum(['student', 'reviewer', 'org_admin']),
  cohortId: z.string().uuid().optional(),
  email: z.string().trim().email().max(200).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(7).default(7),
});

export type InvitationRow = {
  id: string; role: string; cohortId: string | null; cohortName: string | null; email: string | null;
  state: 'active' | 'used' | 'expired' | 'revoked'; createdAt: string; expiresAt: string; usedAt: string | null;
};

/**
 * Creates a single-use invitation. The plaintext token is returned once for the
 * link and stored only as a SHA-256 hash. No email is sent (spec F01).
 */
export async function createInvitation(ctx: Ctx, input: unknown): Promise<{ id: string; token: string }> {
  requireAdmin(ctx);
  const d = InvitationCreate.parse(input);
  if (d.cohortId && d.role === 'org_admin') throw new AppError('VALIDATION_FAILED', '관리자 초대에는 기수를 지정하지 않습니다.');
  if (d.cohortId) {
    const c = await ctx.db.query(`select 1 from cohorts where id = $1 and org_id = $2 and status = 'active'`, [d.cohortId, ctx.orgId]);
    if (!c.rowCount) notFound();
  }
  const token = randomBytes(24).toString('base64url');
  const id = (await ctx.db.query<{ id: string }>(
    `insert into invitations (org_id, cohort_id, email, token_hash, role, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7)) returning id`,
    [ctx.orgId, d.cohortId ?? null, d.email ?? null, sha256Hex(token), d.role, ctx.uid, d.expiresInDays],
  )).rows[0]!.id;
  return { id, token };
}

export async function listInvitations(ctx: Ctx): Promise<InvitationRow[]> {
  requireAdmin(ctx);
  return (await ctx.db.query(
    `select i.id, i.role, i.cohort_id, c.name as cohort_name, i.email, i.created_at, i.expires_at, i.used_at,
            case when i.revoked_at is not null then 'revoked' when i.used_at is not null then 'used'
                 when i.expires_at <= now() then 'expired' else 'active' end as state
     from invitations i left join cohorts c on c.id = i.cohort_id
     where i.org_id = $1 order by i.created_at desc limit 200`, [ctx.orgId],
  )).rows.map((r) => ({
    id: r.id, role: r.role, cohortId: r.cohort_id, cohortName: r.cohort_name, email: r.email, state: r.state,
    createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString(), usedAt: r.used_at?.toISOString() ?? null,
  }));
}

export async function revokeInvitation(ctx: Ctx, id: string): Promise<void> {
  requireAdmin(ctx);
  const r = await ctx.db.query(`update invitations set revoked_at = now() where id = $1 and org_id = $2 and used_at is null and revoked_at is null`, [id, ctx.orgId]);
  if (!r.rowCount) throw new AppError('CONFLICT', '이미 사용했거나 취소된 초대입니다.');
}

// ---------------------------------------------------------------- cohorts

export type CohortRow = { id: string; name: string; status: 'active' | 'archived'; students: number; reviewers: number; createdAt: string };

export async function listCohorts(ctx: Ctx): Promise<CohortRow[]> {
  requireAdmin(ctx);
  return (await ctx.db.query(
    `select c.id, c.name, c.status, c.created_at,
            count(*) filter (where cm.role = 'student' and cm.status = 'active')::int as students,
            count(*) filter (where cm.role = 'reviewer' and cm.status = 'active')::int as reviewers
     from cohorts c left join cohort_members cm on cm.cohort_id = c.id
     where c.org_id = $1 group by c.id order by c.status, c.created_at desc`, [ctx.orgId],
  )).rows.map((r) => ({ id: r.id, name: r.name, status: r.status, students: r.students, reviewers: r.reviewers, createdAt: r.created_at.toISOString() }));
}

export async function createCohort(ctx: Ctx, name: string): Promise<string> {
  requireAdmin(ctx);
  const n = z.string().trim().min(1).max(80).parse(name);
  return (await ctx.db.query<{ id: string }>(`insert into cohorts (org_id, name) values ($1, $2) returning id`, [ctx.orgId, n])).rows[0]!.id;
}

export async function updateCohort(ctx: Ctx, id: string, input: { name?: string; status?: 'active' | 'archived' }): Promise<void> {
  requireAdmin(ctx);
  const d = z.object({ name: z.string().trim().min(1).max(80).optional(), status: z.enum(['active', 'archived']).optional() }).parse(input);
  const r = await ctx.db.query(
    `update cohorts set name = coalesce($3, name), status = coalesce($4, status) where id = $1 and org_id = $2`,
    [id, ctx.orgId, d.name ?? null, d.status ?? null],
  );
  if (!r.rowCount) notFound();
}

export type CohortMember = { userId: string; email: string; role: 'student' | 'reviewer'; status: 'active' | 'removed' };

export async function getCohort(ctx: Ctx, id: string): Promise<{ cohort: CohortRow; members: CohortMember[] }> {
  const cohort = (await listCohorts(ctx)).find((c) => c.id === id);
  if (!cohort) notFound();
  const dir = new Map((await ctx.db.query(`select user_id, email from app.member_directory($1)`, [ctx.orgId])).rows.map((r) => [r.user_id, r.email]));
  const members = (await ctx.db.query(
    `select user_id, role, status from cohort_members where cohort_id = $1 and org_id = $2 order by status, role`, [id, ctx.orgId],
  )).rows.map((r) => ({ userId: r.user_id, email: dir.get(r.user_id) ?? '(알 수 없음)', role: r.role, status: r.status }));
  return { cohort, members };
}

/** Adds or re-activates a seat. Reviewers of a cohort can read that cohort's submissions (spec F10). */
export async function setCohortMember(ctx: Ctx, input: { cohortId: string; userId: string; role: 'student' | 'reviewer'; active: boolean }): Promise<void> {
  requireAdmin(ctx);
  const d = z.object({ cohortId: z.string().uuid(), userId: z.string().uuid(), role: z.enum(['student', 'reviewer']), active: z.boolean() }).parse(input);
  const c = await ctx.db.query(`select status from cohorts where id = $1 and org_id = $2`, [d.cohortId, ctx.orgId]);
  if (!c.rowCount) notFound();
  if (d.active && c.rows[0].status !== 'active') throw new AppError('CONFLICT', '보관된 기수에는 추가할 수 없습니다.');
  try {
    if (d.active) {
      await ctx.db.query(
        `insert into cohort_members (org_id, cohort_id, user_id, role) values ($1, $2, $3, $4)
         on conflict (cohort_id, user_id, role) do update set status = 'active'`, [ctx.orgId, d.cohortId, d.userId, d.role],
      );
    } else {
      const r = await ctx.db.query(
        `update cohort_members set status = 'removed' where cohort_id = $1 and user_id = $2 and role = $3 and org_id = $4`, [d.cohortId, d.userId, d.role, ctx.orgId],
      );
      if (!r.rowCount) notFound();
    }
  } catch (e) {
    if (/foreign key/.test(String(e))) throw new AppError('VALIDATION_FAILED', '이 조직의 멤버만 기수에 추가할 수 있습니다.');
    mapAdminError(e);
  }
}

// ---------------------------------------------------------------- audit + overview

export type AuditRow = { id: number; at: string; actor: string | null; action: string; targetType: string | null; meta: Record<string, unknown> };

export async function listAudit(ctx: Ctx, input: { before?: number; limit?: number } = {}): Promise<{ items: AuditRow[]; nextBefore: number | null }> {
  requireAdmin(ctx);
  const limit = Math.min(input.limit ?? 50, 100);
  const dir = new Map((await ctx.db.query(`select user_id, email from app.member_directory($1)`, [ctx.orgId])).rows.map((r) => [r.user_id, r.email]));
  const rows = (await ctx.db.query(
    `select id, created_at, actor_id, action, target_type, redacted_metadata from audit_events
     where org_id = $1 and ($2::bigint is null or id < $2) order by id desc limit $3`, [ctx.orgId, input.before ?? null, limit + 1],
  )).rows;
  const items = rows.slice(0, limit).map((r) => ({
    id: Number(r.id), at: r.created_at.toISOString(), actor: r.actor_id ? dir.get(r.actor_id) ?? '(조직 외부/탈퇴)' : '시스템',
    action: r.action, targetType: r.target_type, meta: r.redacted_metadata,
  }));
  return { items, nextBefore: rows.length > limit ? items[items.length - 1]!.id : null };
}

export type AdminOverview = {
  students: number; reviewers: number; admins: number; suspended: number; cohorts: number; open_invitations: number; recent: AuditRow[];
};

export async function adminOverview(ctx: Ctx): Promise<AdminOverview> {
  requireAdmin(ctx);
  const r = (await ctx.db.query<Omit<AdminOverview, 'recent'>>(
    `select
       (select count(*) filter (where role = 'student' and status = 'active') from memberships where org_id = $1)::int as students,
       (select count(*) filter (where role = 'reviewer' and status = 'active') from memberships where org_id = $1)::int as reviewers,
       (select count(*) filter (where role = 'org_admin' and status = 'active') from memberships where org_id = $1)::int as admins,
       (select count(*) filter (where status = 'suspended') from memberships where org_id = $1)::int as suspended,
       (select count(*) from cohorts where org_id = $1 and status = 'active')::int as cohorts,
       (select count(*) from invitations where org_id = $1 and used_at is null and revoked_at is null and expires_at > now())::int as open_invitations`,
    [ctx.orgId],
  )).rows[0]!;
  return { ...r, recent: (await listAudit(ctx, { limit: 8 })).items };
}

// ---------------------------------------------------------------- password set links (Supabase Auth)

/**
 * An admin may issue a one-time password link only for a member whose active memberships
 * are all in this org: otherwise one org's admin could take over an account used elsewhere.
 * Returns the member's email; the caller creates the link with service rights.
 */
export async function resettableMemberEmail(ctx: Ctx, userId: string): Promise<string> {
  requireAdmin(ctx);
  const uid = z.string().uuid().parse(userId);
  if (uid === ctx.uid) throw new AppError('VALIDATION_FAILED', '본인 비밀번호는 로그인 화면이 아니라 다른 관리자에게 링크를 요청하세요.');
  const r = (await ctx.db.query(`select d.email, d.status from app.member_directory($1) d where d.user_id = $2`, [ctx.orgId, uid])).rows[0];
  if (!r || r.status === 'left') notFound();
  const elsewhere = await ctx.db.query(`select app.member_in_other_org($1, $2) as x`, [ctx.orgId, uid]);
  if (elsewhere.rows[0]?.x) throw new AppError('CONFLICT', '다른 조직에도 속한 사용자라 여기서 비밀번호 링크를 만들 수 없습니다. 운영자에게 요청하세요.');
  await ctx.db.query(`select app.log_password_link($1, $2)`, [ctx.orgId, uid]);
  return r.email as string;
}

export type InvitationPreview = { orgId: string; orgName: string; role: string; email: string | null; valid: boolean };

/** Service-side lookup by plaintext token (compared by hash) for the sign-up page. orgId is for server-side checks only; never render it. */
export async function invitationPreview(db: Db, token: string): Promise<InvitationPreview | null> {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return null;
  const r = (await db.query(
    `select o.id as org_id, o.name, i.role, i.email, (i.used_at is null and i.revoked_at is null and i.expires_at > now()) as valid
     from invitations i join organizations o on o.id = i.org_id where i.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [token],
  )).rows[0];
  return r ? { orgId: r.org_id, orgName: r.name, role: r.role, email: r.email, valid: r.valid } : null;
}
