alter table public.provider_price_versions add column model text;
insert into public.provider_capabilities(provider,endpoint,path,params_status,verification_status,price_status,phase,note)
values('openai','AI01','/v1/chat/completions','documented','documented','unknown','P1','Text-only reference analysis. Verified run cap must cover 20,000 input tokens and 2,000 completion tokens for the configured model.');
