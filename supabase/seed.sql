-- Demo seed: synthetic people and orgs only (spec 12.1). No real student data.
-- Passwords are not seeded here; local login setup is documented in README.

insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'student-a@demo.invalid'),
  ('00000000-0000-4000-a000-000000000002', 'student-b@demo.invalid'),
  ('00000000-0000-4000-a000-000000000003', 'reviewer@demo.invalid'),
  ('00000000-0000-4000-a000-000000000004', 'reviewer-other-cohort@demo.invalid'),
  ('00000000-0000-4000-a000-000000000005', 'admin@demo.invalid'),
  ('00000000-0000-4000-a000-000000000006', 'student-c@other-org.demo.invalid'),
  ('00000000-0000-4000-a000-000000000007', 'admin@other-org.demo.invalid')
on conflict (id) do nothing;

insert into public.organizations (id, name) values
  ('00000000-0000-4000-b000-000000000001', '데모 샤오홍슈 클래스'),
  ('00000000-0000-4000-b000-000000000002', '다른 조직(격리 테스트)')
on conflict (id) do nothing;

insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'student'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'student'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003', 'reviewer'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000004', 'reviewer'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000005', 'org_admin'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000006', 'student'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000007', 'org_admin')
on conflict (org_id, user_id) do nothing;

insert into public.cohorts (id, org_id, name) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '2026 가을 1기'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000001', '2026 가을 2기'),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000002', '다른 조직 1기')
on conflict (id) do nothing;

insert into public.cohort_members (org_id, cohort_id, user_id, role) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000001', 'student'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000002', 'student'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000003', 'reviewer'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000004', 'reviewer'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000003', '00000000-0000-4000-a000-000000000006', 'student')
on conflict do nothing;

-- Global taxonomy terms come from migration 20261005000013 (needed in production too).

-- Independently written TEST editorial rules (not copied from any third-party list).
insert into public.check_rules (org_id, rule_key, source_class, scope, match_config, finding_type, severity, rationale, status, reviewed_at, review_due_at) values
  (null, 'abs-best', 'test_editorial', '{"fields": ["title", "body", "cover"]}', '{"type": "keyword", "value": "最好"}', 'absolute_or_exaggerated_claim', 'medium',
   '최상급 단정 표현은 근거 없이 쓰면 과장으로 읽힐 수 있습니다. 비교 기준이나 개인 경험임을 밝히세요.', 'active', now(), now() + interval '30 days'),
  (null, 'abs-first', 'test_editorial', '{"fields": ["title", "body", "cover"]}', '{"type": "keyword", "value": "第一"}', 'absolute_or_exaggerated_claim', 'medium',
   '순위 단정은 출처가 필요합니다. 출처가 없으면 개인 의견으로 표현하세요.', 'active', now(), now() + interval '30 days'),
  (null, 'health-cure', 'test_editorial', '{"fields": ["title", "body", "subtitles"]}', '{"type": "keyword", "value": "治疗"}', 'unsupported_health_claim', 'high',
   '치료 효과를 암시하는 표현은 일반 제품 후기에서 근거 없이 쓰기 어렵습니다. 실제 사용 경험으로 바꾸세요.', 'active', now(), now() + interval '30 days'),
  (null, 'health-100', 'test_editorial', '{"fields": ["title", "body"]}', '{"type": "exact_phrase", "value": "100%有效"}', 'unsupported_health_claim', 'high',
   '효과 보장 표현입니다. 개인차가 있음을 밝히고 확인된 사실만 쓰세요.', 'active', now(), now() + interval '30 days'),
  (null, 'sponsor-hint', 'test_editorial', '{"fields": ["body"]}', '{"type": "keyword", "value": "合作"}', 'sponsorship_review_needed', 'info',
   '협찬·제휴 여부를 확인하세요. 광고라면 표시가 필요할 수 있습니다.', 'active', now(), now() + interval '30 days')
on conflict do nothing;

-- Provider permission exists but stays pending: live is blocked (spec 6.2).
insert into public.provider_permissions (org_id, provider, scope) values
  ('00000000-0000-4000-b000-000000000001', 'redfox', 'environment')
on conflict do nothing;

-- Live budget defaults to 0 (spec 9.2).
insert into public.usage_budgets (org_id, subject_type, subject_id, period_start, period_end, currency, amount_limit) values
  ('00000000-0000-4000-b000-000000000001', 'org', '00000000-0000-4000-b000-000000000001', date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month')::date, 'CNY', 0)
on conflict do nothing;
