-- 배포 점검(읽기 전용). Supabase SQL Editor에 붙여 넣어 실행하면 항목별 ok(true/false)가 나옵니다.
-- 스키마가 아직 없어도 오류 없이 false로 표시합니다. 전부 true여야 합니다.
select '스키마 적용 기록 있음' as check, to_regclass('app.applied_migrations') is not null as ok
union all select '마이그레이션 14개 이상 적용', coalesce((xpath('/row/n/text()', query_to_xml(
  case when to_regclass('app.applied_migrations') is null then 'select 0 as n' else 'select count(*) as n from app.applied_migrations' end, false, true, '')))[1]::text::int, 0) >= 14
union all select '접속 역할이 authenticated로 전환 가능', pg_has_role(current_user, 'authenticated', 'member')
union all select 'public 모든 테이블 RLS 켜짐(테이블이 있을 때)', to_regclass('public.organizations') is not null and not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
union all select '기본 분류 14개 이상', coalesce((xpath('/row/n/text()', query_to_xml(
  case when to_regclass('public.taxonomy_terms') is null then 'select 0 as n' else 'select count(*) as n from public.taxonomy_terms where org_id is null' end, false, true, '')))[1]::text::int, 0) >= 14
union all select 'RedFox 엔드포인트 목록', coalesce((xpath('/row/n/text()', query_to_xml(
  case when to_regclass('public.provider_capabilities') is null then 'select 0 as n' else 'select count(*) as n from public.provider_capabilities' end, false, true, '')))[1]::text::int, 0) >= 14
union all select '데모 계정 없음', not exists (select 1 from auth.users where email like '%demo.invalid');
