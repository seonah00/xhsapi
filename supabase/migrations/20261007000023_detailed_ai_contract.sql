-- Versioned output bounds: a quote approved for 2,000 tokens must not fund a 6,000-token request.
alter table public.provider_price_versions add column output_token_limit integer check (output_token_limit > 0);
update public.provider_price_versions set output_token_limit=2000 where provider='openai';
update public.provider_capabilities set price_status='unknown',
  note='Text-only AI workflows. Run cap must cover 20,000 input and 6,000 output tokens; output_token_limit must be recorded. Reverify price before activation.'
where provider='openai' and endpoint='AI01';
