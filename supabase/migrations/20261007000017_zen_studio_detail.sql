-- AP01 now targets a different Actor. Require pricing verification again before new quotes.
update public.provider_capabilities
set path='/v2/actors/zen-studio~rednote-note-detail-scraper/run-sync-get-dataset-items',
    price_status='unknown',
    note='Zen Studio note detail; preview URLs only; reverify pinned build and USD/run cap'
where provider='apify' and endpoint='AP01';
