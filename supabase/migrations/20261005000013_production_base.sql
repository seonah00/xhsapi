-- Production readiness: base data every environment needs, and admin helpers for
-- one-time password links (Supabase Auth). Demo users/orgs stay in seed.sql only.

-- Global taxonomy (spec F03). Provider category mapping is a starting point, not 1:1.
insert into public.taxonomy_terms (org_id, kind, slug, label_ko, label_zh, mapping_json) values
  (null, 'topic', 'beauty', '뷰티', '美妆', '{"redfox_rank_category": ["化妆美容", "个人护理"]}'),
  (null, 'topic', 'daily-life', '일상', '日常', '{"redfox_rank_category": ["日常生活"]}'),
  (null, 'topic', 'parenting', '육아', '育儿', '{"redfox_rank_category": ["亲子育儿"]}'),
  (null, 'topic', 'food-places', '맛집·카페', '探店', '{"redfox_rank_category": ["美味佳肴"], "note": "美味佳肴 includes cooking; classify restaurants separately"}'),
  (null, 'topic', 'travel-outing', '여행·외출', '出行', '{"redfox_rank_category": ["旅行度假"]}'),
  (null, 'topic', 'fashion', '패션', '穿搭', '{"redfox_rank_category": ["时尚穿搭", "潮流鞋包"]}'),
  (null, 'format', 'vlog', '브이로그', 'vlog', '{}'),
  (null, 'format', 'review', '리뷰', '测评', '{}'),
  (null, 'format', 'comparison', '비교', '对比', '{}'),
  (null, 'format', 'routine', '루틴', '日常流程', '{}'),
  (null, 'format', 'how-to', '방법 소개', '教程', '{}'),
  (null, 'format', 'information-list', '정보 정리', '合集', '{}'),
  (null, 'format', 'story', '이야기', '故事', '{}'),
  (null, 'format', 'photo-diary', '사진 일기', '图文日记', '{}')
on conflict do nothing;

-- True when the user is active in any org other than p_org (caller must be p_org's admin).
create or replace function app.member_in_other_org(p_org uuid, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['org_admin']) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return exists (select 1 from public.memberships m where m.user_id = p_user and m.org_id <> p_org and m.status = 'active');
end $$;

-- Audit entry for an issued password link (the link itself is never stored).
create or replace function app.log_password_link(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['org_admin']) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.memberships where org_id = p_org and user_id = p_user) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform app.audit(p_org, 'member.password_link_issued', 'user', p_user, '{}'::jsonb);
end $$;

revoke all on function app.member_in_other_org(uuid, uuid), app.log_password_link(uuid, uuid) from public;
grant execute on function app.member_in_other_org(uuid, uuid), app.log_password_link(uuid, uuid) to authenticated;
