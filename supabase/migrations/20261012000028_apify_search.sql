-- Search is priced independently of per-note detail calls. No automatic paid activation.
insert into public.provider_capabilities(provider,endpoint,path,params_status,verification_status,price_status,phase,note)
values ('apify','AP02','/v2/actors/zen-studio~rednote-search-scraper/run-sync-get-dataset-items','documented','documented','unknown','P0','Zen keyword search; pinned APIFY_SEARCH_BUILD and verified USD/run required');
