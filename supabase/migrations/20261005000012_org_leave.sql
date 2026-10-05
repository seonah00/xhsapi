-- Voluntary org leave (F01): access ends immediately, data is deleted by the
-- user_deletion job, the membership row stays (status 'left') for audit and FKs.

alter table public.memberships drop constraint memberships_status_check;
alter table public.memberships add constraint memberships_status_check check (status in ('active', 'suspended', 'left'));
alter table public.memberships add column left_at timestamptz;

alter table public.deletion_requests drop constraint deletion_requests_scope_check;
alter table public.deletion_requests add constraint deletion_requests_scope_check
  check (scope in ('all_my_data', 'account', 'reference', 'plan', 'transcript', 'leave_org'));

create or replace function app.leave_org(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not app.is_member(p_org) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  -- The last active org_admin is protected by app.guard_last_admin (raises LAST_ADMIN).
  update public.memberships set status = 'left', left_at = now() where org_id = p_org and user_id = v_uid and status = 'active';
  update public.cohort_members set status = 'removed' where org_id = p_org and user_id = v_uid and status = 'active';
  perform app.audit(p_org, 'membership.left', 'membership', null, '{}'::jsonb);
end $$;
revoke all on function app.leave_org(uuid) from public;
grant execute on function app.leave_org(uuid) to authenticated;

-- Re-invited former members come back as active; suspended members stay suspended (admin decision).
create or replace function app.redeem_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select * into v_inv from public.invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    for update;
  if not found or v_inv.used_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'INVITATION_INVALID' using errcode = 'P0001';
  end if;
  insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do update set status = 'active', role = excluded.role, left_at = null
      where public.memberships.status = 'left';
  if v_inv.cohort_id is not null and v_inv.role in ('student', 'reviewer') then
    insert into public.cohort_members (org_id, cohort_id, user_id, role)
      values (v_inv.org_id, v_inv.cohort_id, v_uid, v_inv.role)
      on conflict (cohort_id, user_id, role) do update set status = 'active';
  end if;
  update public.invitations set used_at = now(), used_by = v_uid where id = v_inv.id;
  perform app.audit(v_inv.org_id, 'invitation.redeemed', 'invitation', v_inv.id, '{}'::jsonb);
  return v_inv.org_id;
end $$;
revoke all on function app.redeem_invitation(text) from public;
grant execute on function app.redeem_invitation(text) to authenticated;
