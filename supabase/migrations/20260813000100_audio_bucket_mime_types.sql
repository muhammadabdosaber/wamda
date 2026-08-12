-- `20260801000400_rls.sql` creates the `audio` bucket with
-- `insert ... on conflict (id) do nothing`, and has named the full 7-type
-- list (mp4/aac/mpeg/ogg/opus/webm/wav) since it was written. On the hosted
-- project the bucket row already existed -- created narrower, before that
-- migration ever ran -- so `on conflict do nothing` silently kept the old
-- `{audio/webm, audio/ogg}` list forever. Every non-Chrome recording
-- (iOS Safari's `audio/mp4`, and every other browser not already on the
-- list) was rejected by Storage with `mime type ... is not supported`,
-- confirmed live on a real iPhone recording 2026-08-13. `on conflict do
-- nothing` is exactly why a later edit to that INSERT's array would never
-- have reached hosted either -- this has to be a real UPDATE, not another
-- insert.
update storage.buckets
set allowed_mime_types = array[
  'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/opus',
  'audio/webm', 'audio/wav'
]
where id = 'audio';
