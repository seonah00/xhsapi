import { AppError } from '@xhs/domain';
import { notFound, pgCode, type Ctx } from './context.ts';
import { AccountProfile } from './profile.ts';

export type AccountRow = {
  id: string;
  display_name: string;
  profile_url: string | null;
  revision: number;
  updated_at: Date;
  profile_version: number;
  profile: AccountProfile;
};

const SELECT = `
  select a.id, a.display_name, a.profile_url, a.revision, a.updated_at, v.version as profile_version, v.profile_json as profile
  from creator_accounts a join account_profile_versions v on v.id = a.current_profile_version_id
  where a.org_id = $1 and a.deleted_at is null`;

export async function listAccounts(ctx: Ctx): Promise<AccountRow[]> {
  return (await ctx.db.query<AccountRow>(`${SELECT} order by a.created_at`, [ctx.orgId])).rows;
}

export async function getAccount(ctx: Ctx, id: string): Promise<AccountRow> {
  const row = (await ctx.db.query<AccountRow>(`${SELECT} and a.id = $2`, [ctx.orgId, id])).rows[0];
  return row ?? notFound();
}

export async function createAccount(ctx: Ctx, input: unknown): Promise<string> {
  const profile = AccountProfile.parse(input);
  try {
    const id = (await ctx.db.query<{ id: string }>(
      `insert into creator_accounts (org_id, owner_user_id, display_name, profile_url) values ($1, $2, $3, $4) returning id`,
      [ctx.orgId, ctx.uid, profile.displayName, profile.profileUrl ?? null],
    )).rows[0]!.id;
    const v = (await ctx.db.query<{ id: string }>(
      `insert into account_profile_versions (org_id, account_id, version, profile_json, created_by) values ($1, $2, 1, $3, $4) returning id`,
      [ctx.orgId, id, profile, ctx.uid],
    )).rows[0]!.id;
    await ctx.db.query(`update creator_accounts set current_profile_version_id = $1 where id = $2`, [v, id]);
    return id;
  } catch (e) {
    if (pgCode(e) === 'ACCOUNT_LIMIT') throw new AppError('CONFLICT', '활성 계정은 최대 3개까지 만들 수 있습니다.');
    throw e;
  }
}

/** Profile edits create a new immutable version; past plans keep theirs (spec F02). */
export async function updateAccountProfile(ctx: Ctx, id: string, input: unknown, revision: number): Promise<number> {
  const profile = AccountProfile.parse(input);
  const current = await getAccount(ctx, id);
  if (current.revision !== revision) throw new AppError('STALE_REVISION', '다른 곳에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.');
  const version = current.profile_version + 1;
  const v = (await ctx.db.query<{ id: string }>(
    `insert into account_profile_versions (org_id, account_id, version, profile_json, created_by) values ($1, $2, $3, $4, $5) returning id`,
    [ctx.orgId, id, version, profile, ctx.uid],
  )).rows[0]!.id;
  const upd = await ctx.db.query(
    `update creator_accounts set current_profile_version_id = $1, display_name = $2, profile_url = $3, revision = revision + 1
     where id = $4 and revision = $5`,
    [v, profile.displayName, profile.profileUrl ?? null, id, revision],
  );
  if (upd.rowCount !== 1) throw new AppError('STALE_REVISION', '다른 곳에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.');
  return version;
}
