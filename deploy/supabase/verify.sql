-- 배포 점검(읽기 전용). Supabase SQL Editor에 붙여 넣어 실행하면 항목별 ok(true/false)가 나옵니다.
-- 전부 true여야 합니다. (PC에서 실행할 수 있으면 `pnpm verify:db`가 더 자세히 확인합니다.)
select '마이그레이션 13개 적용' as check, (select count(*) from app.applied_migrations) >= 13 as ok
union all select 'Supabase 역할 존재', (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) = 3
union all select '접속 역할이 authenticated로 전환 가능', pg_has_role(current_user, 'authenticated', 'member')
union all select 'public 모든 테이블 RLS 켜짐', not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
union all select '기본 분류 14개 이상', (select count(*) from public.taxonomy_terms where org_id is null) >= 14
union all select 'RedFox 엔드포인트 목록', (select count(*) from public.provider_capabilities where provider = 'redfox') >= 14
union all select '데모 계정 없음', not exists (select 1 from auth.users where email like '%demo.invalid');
