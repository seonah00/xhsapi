alter table public.app_jobs drop constraint app_jobs_kind_check;
alter table public.app_jobs add constraint app_jobs_kind_check check(kind in (
  'provider_search','note_enrichment','note_link_recovery','rank_refresh','reference_analysis','query_expansion','plan_generation','contextual_check',
  'results_reflection','trend_aggregation','data_expiry','user_deletion','transcript_submit','transcript_result','ocr','comment_submit','comment_result','csv_import'));
