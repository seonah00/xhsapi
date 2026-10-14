-- Shares the existing enrichment RLS, permission and expiry boundary. No media bytes stored.
alter table public.note_enrichments add column video_stream_url text
  check (video_stream_url is null or length(video_stream_url)<=4000);
