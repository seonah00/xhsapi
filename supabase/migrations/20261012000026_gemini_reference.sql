-- No automatic activation or assumed model price. Operator must verify the full request bound.
insert into public.provider_capabilities(provider,endpoint,path,params_status,verification_status,price_status,phase,note)
values('gemini','AI01','/v1beta/models/{model}:generateContent','documented','documented','unknown','P1',
'Text-only reference analysis. Verify configured model USD/run cap covering 20,000 input and 6,000 total output tokens (including thinking) before activation.');
