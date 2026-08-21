-- ============================================================================
-- Schema verification. Run with:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/verify.sql
--
-- Every Arabic string is built with chr() so this file is pure ASCII and
-- cannot be corrupted by bidirectional text reordering. The code points are
-- named in comments.
-- ============================================================================

\set ON_ERROR_STOP on

-- Building blocks
-- 1575 alef      1571 alef-hamza-above   1573 alef-hamza-below
-- 1577 taa-marbuta  1607 haa             1600 tatweel
-- 1614 fatha     1581 haa(H)             1605 meem
-- 1583 dal       1585 raa                1587 seen
-- 1604 lam       1610 yaa                1608 waw
-- 1593 ain       1602 qaf                1578 taa

-- ---------------------------------------------------------------------------
-- 1. Arabic normalization folds orthographic variants
-- ---------------------------------------------------------------------------
do $$
declare
  -- "Ahmad" written with alef-hamza vs bare alef
  hamza_form text := chr(1571) || chr(1581) || chr(1605) || chr(1583);
  bare_form  text := chr(1575) || chr(1581) || chr(1605) || chr(1583);
  -- same word with a tatweel and a fatha injected
  decorated  text := chr(1571) || chr(1614) || chr(1581) || chr(1600) || chr(1605) || chr(1583);
begin
  if public.normalize_ar(hamza_form) <> public.normalize_ar(bare_form) then
    raise exception 'alef-hamza did not fold to bare alef: % vs %',
      public.normalize_ar(hamza_form), public.normalize_ar(bare_form);
  end if;

  if public.normalize_ar(decorated) <> public.normalize_ar(bare_form) then
    raise exception 'tatweel/harakat were not stripped: % vs %',
      public.normalize_ar(decorated), public.normalize_ar(bare_form);
  end if;

  raise notice 'PASS: alef-hamza, tatweel, harakat all fold';
end
$$;

do $$
declare
  -- "madrasa" ending in taa-marbuta vs haa
  marbuta text := chr(1605) || chr(1583) || chr(1585) || chr(1587) || chr(1577);
  haa     text := chr(1605) || chr(1583) || chr(1585) || chr(1587) || chr(1607);
begin
  if public.normalize_ar(marbuta) <> public.normalize_ar(haa) then
    raise exception 'taa-marbuta did not fold to haa';
  end if;
  raise notice 'PASS: taa-marbuta folds to haa';
end
$$;

-- Slugs must converge for spelling variants, or the tag graph fragments.
do $$
declare
  a text := public.slugify(chr(1571) || chr(1581) || chr(1605) || chr(1583), 'ar');
  b text := public.slugify(chr(1575) || chr(1581) || chr(1605) || chr(1583), 'ar');
begin
  if a is null or a <> b then
    raise exception 'slug variants did not converge: % vs %', a, b;
  end if;
  raise notice 'PASS: slugify converges (%)', a;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Arabic text search config is real and produces lexemes
-- ---------------------------------------------------------------------------
do $$
declare
  -- "al-madrasa al-kabira" -- a two-word Arabic phrase
  phrase text := chr(1575) || chr(1604) || chr(1605) || chr(1583) || chr(1585)
              || chr(1587) || chr(1577) || ' '
              || chr(1575) || chr(1604) || chr(1603) || chr(1576) || chr(1610) || chr(1585);
  v tsvector;
begin
  if public.ts_config_for('ar')::text <> 'arabic' then
    raise exception 'ts_config_for(ar) returned %', public.ts_config_for('ar');
  end if;

  v := to_tsvector(public.ts_config_for('ar'), public.normalize_for(phrase, 'ar'));
  if length(v::text) = 0 then
    raise exception 'Arabic tsvector came back empty';
  end if;
  raise notice 'PASS: arabic tsvector = %', v;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Seed two users and exercise RLS
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@example.test', '', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bassam@example.test', '', now(), now(), now())
on conflict (id) do nothing;

-- The signup trigger should already have created both profiles.
do $$
declare n integer;
begin
  select count(*) into n from public.profiles
   where id in ('11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222');
  if n <> 2 then
    raise exception 'handle_new_user did not provision profiles (found %)', n;
  end if;
  raise notice 'PASS: profiles auto-provisioned on signup';
end
$$;

-- Alice captures a note, as Alice.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.capture_note(
  '33333333-3333-3333-3333-333333333333'::uuid,
  'text'::public.note_source,
  'ar',
  chr(1575) || chr(1604) || chr(1605) || chr(1583) || chr(1585) || chr(1587) || chr(1577)
);

-- Replaying the same client_id must resolve to the SAME row, not a duplicate.
do $$
declare
  first_id  uuid;
  second_id uuid;
  total     integer;
begin
  select id into first_id from public.notes
   where client_id = '33333333-3333-3333-3333-333333333333';

  second_id := public.capture_note(
    '33333333-3333-3333-3333-333333333333'::uuid,
    'text'::public.note_source, 'ar', 'replay');

  select count(*) into total from public.notes
   where client_id = '33333333-3333-3333-3333-333333333333';

  if first_id <> second_id or total <> 1 then
    raise exception 'offline replay was not idempotent (ids %/%, count %)',
      first_id, second_id, total;
  end if;
  raise notice 'PASS: capture_note is idempotent on client_id';
end
$$;
commit;

-- Bassam must not be able to see it.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.notes
   where client_id = '33333333-3333-3333-3333-333333333333';
  if n <> 0 then
    raise exception 'RLS BREACH: user B read user A''s note (% rows)', n;
  end if;

  select count(*) into n from public.notes;
  if n <> 0 then
    raise exception 'RLS BREACH: user B sees % notes total', n;
  end if;

  select count(*) into n from public.note_tags;
  if n <> 0 then
    raise exception 'RLS BREACH: user B sees note_tags';
  end if;

  select count(*) into n from public.note_embeddings;
  if n <> 0 then
    raise exception 'RLS BREACH: user B sees note_embeddings';
  end if;

  raise notice 'PASS: cross-user reads blocked on notes, note_tags, note_embeddings';
end
$$;
commit;

-- ---------------------------------------------------------------------------
-- 4. Generated search vector + lexical search path
-- ---------------------------------------------------------------------------
-- Mark the note ready as the PIPELINE would -- i.e. privileged, not as the
-- client. Since migration 10 the authenticated role can no longer set
-- `status` itself (that is section 5b's assertion), so this stands in for the
-- service role rather than reaching through the client's grant.
update public.notes set status = 'ready'
 where client_id = '33333333-3333-3333-3333-333333333333';

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v tsvector;
begin
  select search_vector into v from public.notes
   where client_id = '33333333-3333-3333-3333-333333333333';
  if v is null or length(v::text) = 0 then
    raise exception 'generated search_vector is empty';
  end if;
  raise notice 'PASS: generated search_vector populated = %', v;
end
$$;

-- Query with a DIFFERENT spelling than was stored (taa-marbuta -> haa).
-- This is the whole point of normalizing on both sides.
do $$
declare
  variant_query text := chr(1575) || chr(1604) || chr(1605) || chr(1583)
                     || chr(1585) || chr(1587) || chr(1607); -- ends in haa
  hits integer;
begin
  select count(*) into hits
    from public.search_notes(variant_query, 'ar', null, 'lexical');
  if hits < 1 then
    raise exception 'lexical search missed a spelling variant of the stored note';
  end if;
  raise notice 'PASS: lexical search matches across spelling variants (% hit(s))', hits;
end
$$;

-- search_notes must tolerate a note that has no enrichment row yet.
do $$
declare summary_val text;
begin
  select s.summary into summary_val
    from public.search_notes(
      chr(1575) || chr(1604) || chr(1605) || chr(1583) || chr(1585) || chr(1587) || chr(1607),
      'ar', null, 'lexical') s
   limit 1;
  raise notice 'PASS: unenriched note is still findable (summary is null: %)',
    summary_val is null;
end
$$;
commit;

-- ---------------------------------------------------------------------------
-- 5. Tag attachment collapses spelling variants onto one tag
-- ---------------------------------------------------------------------------
do $$
declare
  note_uuid uuid;
  tag_count integer;
begin
  select id into note_uuid from public.notes
   where client_id = '33333333-3333-3333-3333-333333333333';

  perform public.attach_tags(
    '11111111-1111-1111-1111-111111111111'::uuid,
    note_uuid, 'ar',
    array[
      chr(1571) || chr(1581) || chr(1605) || chr(1583),  -- with hamza
      chr(1575) || chr(1581) || chr(1605) || chr(1583)   -- without
    ]
  );

  select count(*) into tag_count from public.tags
   where user_id = '11111111-1111-1111-1111-111111111111';

  if tag_count <> 1 then
    raise exception 'spelling variants created % tags, expected 1', tag_count;
  end if;
  raise notice 'PASS: tag variants collapsed to a single tag';
end
$$;

-- ---------------------------------------------------------------------------
-- 5b. The client's UPDATE on notes is scoped to the columns it owns
-- ---------------------------------------------------------------------------
-- completed_at (migration 09) exists, and the scoped grant (migration 10) lets
-- an authenticated client write its own response columns while rejecting any
-- attempt to touch pipeline-owned state like `status`.
do $$
declare has_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notes'
       and column_name = 'completed_at'
  ) into has_col;
  if not has_col then
    raise exception 'notes.completed_at column is missing';
  end if;
  raise notice 'PASS: notes.completed_at exists';
end
$$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  -- The three columns the client owns must all be writable on its own note.
  update public.notes
     set completed_at = now(), archived_at = null, action_dismissed_at = null
   where client_id = '33333333-3333-3333-3333-333333333333';
  update public.notes
     set completed_at = null
   where client_id = '33333333-3333-3333-3333-333333333333';

  -- A pipeline-owned column must be rejected at the grant layer, not silently
  -- written. 42501 is insufficient_privilege -- the column-level UPDATE denial.
  begin
    update public.notes set status = 'queued'
     where client_id = '33333333-3333-3333-3333-333333333333';
    raise exception 'GRANT BREACH: authenticated client updated notes.status';
  exception
    when insufficient_privilege then
      raise notice 'PASS: scoped grant blocks notes.status, allows completed_at';
  end;
end
$$;
commit;

-- ---------------------------------------------------------------------------
-- 6. Every public table has RLS enabled -- no table may be forgotten
-- ---------------------------------------------------------------------------
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'tables without RLS: %', unprotected;
  end if;
  raise notice 'PASS: every public table has RLS enabled';
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Per-user rate limit gate (SB-002)
-- ---------------------------------------------------------------------------
-- rate_limit_hit() is the single count query both /enrich and /transcribe
-- call before reaching the vendor. Proven here against a live count of real
-- ai_jobs rows, not asserted from reading the SQL.
do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
begin
  delete from public.ai_jobs where user_id = alice and stage = 'enrich';

  insert into public.ai_jobs (user_id, stage, status)
  select alice, 'enrich', 'succeeded' from generate_series(1, 2);

  if public.rate_limit_hit(alice, 'enrich', 3, 60) then
    raise exception 'rate_limit_hit tripped early at 2 of a 3-call limit';
  end if;

  insert into public.ai_jobs (user_id, stage, status)
  values (alice, 'enrich', 'succeeded');

  if not public.rate_limit_hit(alice, 'enrich', 3, 60) then
    raise exception 'rate_limit_hit did not trip at the 3rd of a 3-call limit';
  end if;
  raise notice 'PASS: rate_limit_hit trips exactly at the Nth call, not before';

  -- A different stage for the same user must have its own counter.
  if public.rate_limit_hit(alice, 'transcribe', 3, 60) then
    raise exception 'rate_limit_hit leaked count across stages';
  end if;
  raise notice 'PASS: rate_limit_hit is scoped per stage, not per user alone';

  -- Calls from outside the window must not count against a fresh window.
  delete from public.ai_jobs where user_id = alice and stage = 'enrich';
  insert into public.ai_jobs (user_id, stage, status, created_at)
  select alice, 'enrich', 'succeeded', now() - interval '2 hours'
  from generate_series(1, 5);

  if public.rate_limit_hit(alice, 'enrich', 3, 60) then
    raise exception 'rate_limit_hit counted calls from outside the window';
  end if;
  raise notice 'PASS: rate_limit_hit ignores calls outside the window';

  delete from public.ai_jobs where user_id = alice and stage = 'enrich';
end
$$;

-- ---------------------------------------------------------------------------
-- 8. ai_jobs retention (SB-004)
-- ---------------------------------------------------------------------------
do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  removed integer;
  remaining integer;
begin
  delete from public.ai_jobs where user_id = alice and stage = 'digest';

  insert into public.ai_jobs (user_id, stage, status, created_at)
  values
    (alice, 'digest', 'succeeded', now() - interval '120 days'), -- old, must go
    (alice, 'digest', 'succeeded', now() - interval '10 days');  -- recent, must stay

  removed := public.purge_old_ai_jobs(90);
  if removed < 1 then
    raise exception 'purge_old_ai_jobs removed % rows, expected at least 1', removed;
  end if;

  select count(*) into remaining from public.ai_jobs
   where user_id = alice and stage = 'digest';
  if remaining <> 1 then
    raise exception 'purge_old_ai_jobs left % rows for alice, expected exactly 1 (the recent one)', remaining;
  end if;

  raise notice 'PASS: purge_old_ai_jobs removes rows past the window, keeps recent ones';

  delete from public.ai_jobs where user_id = alice and stage = 'digest';
end
$$;

-- ---------------------------------------------------------------------------
-- 9. Audio retention query (SB-009)
-- ---------------------------------------------------------------------------
-- notes_audio_expired() only finds candidates -- the actual Storage delete
-- needs the Storage API, not SQL, and is exercised live (00-verification.md).
-- This proves the per-user boundary: audio_retention_days differs by user,
-- so it cannot be a single global cutoff.
do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  retention_days integer;
  expired_ids uuid[];
begin
  select audio_retention_days into retention_days from public.profiles where id = alice;

  delete from public.notes where user_id = alice and client_id in (
    '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555');

  -- Expired: captured well past this user's own retention window.
  insert into public.notes (user_id, client_id, source, status, input_language, audio_path, client_created_at)
  values (alice, '44444444-4444-4444-4444-444444444444', 'voice', 'ready', 'ar',
          alice::text || '/expired-test.webm',
          now() - make_interval(days => retention_days + 10));

  -- Not expired: captured yesterday.
  insert into public.notes (user_id, client_id, source, status, input_language, audio_path, client_created_at)
  values (alice, '55555555-5555-5555-5555-555555555555', 'voice', 'ready', 'ar',
          alice::text || '/fresh-test.webm',
          now() - interval '1 day');

  select array_agg(note_id) into expired_ids
    from public.notes_audio_expired(100)
   where note_id in (
     select id from public.notes where user_id = alice and client_id in (
       '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555'));

  if expired_ids is null or array_length(expired_ids, 1) <> 1 then
    raise exception 'notes_audio_expired flagged % of alice''s 2 test notes, expected exactly 1',
      coalesce(array_length(expired_ids, 1), 0);
  end if;
  if expired_ids[1] <> (select id from public.notes where client_id = '44444444-4444-4444-4444-444444444444') then
    raise exception 'notes_audio_expired flagged the wrong note';
  end if;

  raise notice 'PASS: notes_audio_expired flags only the note past its owner''s retention window';

  delete from public.notes where user_id = alice and client_id in (
    '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555');
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Pipeline failures are queryable by note id, no ad hoc SQL (SB-019)
-- ---------------------------------------------------------------------------
do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  note_uuid uuid;
  hit_count integer;
  found_error text;
begin
  select id into note_uuid from public.notes
   where client_id = '33333333-3333-3333-3333-333333333333';

  delete from public.ai_jobs where note_id = note_uuid;

  -- enrich failed once, then succeeded on retry -- must NOT read as "currently failing".
  insert into public.ai_jobs (user_id, note_id, stage, status, attempt, error_code, created_at)
  values
    (alice, note_uuid, 'enrich', 'failed',    1, 'vendor_timeout', now() - interval '2 minutes'),
    (alice, note_uuid, 'enrich', 'succeeded', 2, null,             now() - interval '1 minute');

  -- embed failed and was never retried -- must read as currently failing.
  insert into public.ai_jobs (user_id, note_id, stage, status, attempt, error_code, created_at)
  values (alice, note_uuid, 'embed', 'failed', 1, 'missing_configuration', now());

  select count(*) into hit_count from public.failed_ai_jobs where note_id = note_uuid;
  if hit_count <> 1 then
    raise exception 'failed_ai_jobs showed % row(s) for the test note, expected exactly 1 (a stage that failed then succeeded must not appear)',
      hit_count;
  end if;

  select error_code into found_error from public.failed_ai_jobs where note_id = note_uuid;
  if found_error <> 'missing_configuration' then
    raise exception 'failed_ai_jobs surfaced the wrong stage: error_code = %, expected missing_configuration', found_error;
  end if;

  raise notice 'PASS: failed_ai_jobs surfaces only stages whose latest attempt is still failing, filterable by note_id';

  delete from public.ai_jobs where note_id = note_uuid;
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Success metrics (SB-020)
-- ---------------------------------------------------------------------------
-- 11a. capture_note stores the client-measured latency.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  new_note_id uuid;
  stored_latency integer;
begin
  new_note_id := public.capture_note(
    '66666666-6666-6666-6666-666666666666'::uuid,
    'text'::public.note_source, 'ar', 'latency test note', now(), 123);

  select capture_latency_ms into stored_latency from public.notes where id = new_note_id;
  if stored_latency <> 123 then
    raise exception 'capture_note did not store capture_latency_ms: got %, expected 123', stored_latency;
  end if;
  raise notice 'PASS: capture_note stores capture_latency_ms (%)', stored_latency;
end
$$;
commit;

delete from public.notes where client_id = '66666666-6666-6666-6666-666666666666';

-- 11b. capture_latency_stats -- percentile_cont(0.95) is deterministic on a
-- known set (100, 200, 300, 400): interpolated position 0.95*(4-1) = 2.85,
-- so 300 + 0.85*(400-300) = 385 exactly.
do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  stats record;
begin
  delete from public.notes where user_id = alice and capture_latency_ms is not null;

  insert into public.notes (user_id, client_id, source, status, input_language, raw_text, client_created_at, capture_latency_ms)
  select alice, gen_random_uuid(), 'text', 'ready', 'ar', 'latency fixture', now(), ms
  from unnest(array[100, 200, 300, 400]) as ms;

  select * into stats from public.capture_latency_stats;

  if stats.notes_measured <> 4 or stats.avg_ms <> 250 or stats.p95_ms <> 385 or stats.max_ms <> 400 then
    raise exception 'capture_latency_stats wrong: measured=%, avg=%, p95=%, max=% (expected 4, 250, 385, 400)',
      stats.notes_measured, stats.avg_ms, stats.p95_ms, stats.max_ms;
  end if;
  raise notice 'PASS: capture_latency_stats (avg % ms, p95 % ms over % notes)',
    stats.avg_ms, stats.p95_ms, stats.notes_measured;

  delete from public.notes where user_id = alice and capture_latency_ms is not null;
end
$$;

-- 11c. stuck_notes: docs/10-product-spec.md's own ">1h outside a terminal
-- state" -- a genuinely stuck note appears, a fresh in-flight one and an
-- old-but-archived one do not.
do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  stuck_hit boolean;
  fresh_hit boolean;
  archived_hit boolean;
begin
  delete from public.notes where user_id = alice and client_id in (
    '77777777-7777-7777-7777-777777777777',
    '88888888-8888-8888-8888-888888888888',
    '99999999-9999-9999-9999-999999999999');

  insert into public.notes (user_id, client_id, source, status, input_language, raw_text, client_created_at, updated_at)
  values
    (alice, '77777777-7777-7777-7777-777777777777', 'text', 'enriching', 'ar', 'stuck', now() - interval '2 hours', now() - interval '2 hours'),
    (alice, '88888888-8888-8888-8888-888888888888', 'text', 'enriching', 'ar', 'fresh', now() - interval '5 minutes', now() - interval '5 minutes'),
    (alice, '99999999-9999-9999-9999-999999999999', 'text', 'queued',    'ar', 'archived-old', now() - interval '3 hours', now() - interval '3 hours');

  update public.notes set archived_at = now()
   where user_id = alice and client_id = '99999999-9999-9999-9999-999999999999';

  select exists(select 1 from public.stuck_notes s join public.notes n on n.id = s.note_id where n.client_id = '77777777-7777-7777-7777-777777777777') into stuck_hit;
  select exists(select 1 from public.stuck_notes s join public.notes n on n.id = s.note_id where n.client_id = '88888888-8888-8888-8888-888888888888') into fresh_hit;
  select exists(select 1 from public.stuck_notes s join public.notes n on n.id = s.note_id where n.client_id = '99999999-9999-9999-9999-999999999999') into archived_hit;

  if not stuck_hit then
    raise exception 'stuck_notes missed a note enriching for 2 hours';
  end if;
  if fresh_hit then
    raise exception 'stuck_notes flagged a note only 5 minutes into enriching';
  end if;
  if archived_hit then
    raise exception 'stuck_notes flagged an archived note';
  end if;
  raise notice 'PASS: stuck_notes flags only a non-terminal note past 1 hour, not fresh or archived ones';

  delete from public.notes where user_id = alice and client_id in (
    '77777777-7777-7777-7777-777777777777',
    '88888888-8888-8888-8888-888888888888',
    '99999999-9999-9999-9999-999999999999');
end
$$;

-- 11d. note_cost / cost_summary sum ai_jobs.cost_usd correctly, split by stage.
do $$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  note_uuid uuid;
  row_cost record;
begin
  select id into note_uuid from public.notes
   where client_id = '33333333-3333-3333-3333-333333333333';

  delete from public.ai_jobs where note_id = note_uuid;

  insert into public.ai_jobs (user_id, note_id, stage, status, cost_usd)
  values
    (alice, note_uuid, 'enrich', 'succeeded', 0.010000),
    (alice, note_uuid, 'embed',  'succeeded', 0.000050);

  select * into row_cost from public.note_cost where note_id = note_uuid;

  if row_cost.enrich_cost_usd <> 0.010000 or row_cost.total_cost_usd <> 0.010050 then
    raise exception 'note_cost wrong: enrich=%, total=% (expected 0.010000, 0.010050)',
      row_cost.enrich_cost_usd, row_cost.total_cost_usd;
  end if;
  raise notice 'PASS: note_cost splits enrich cost ($%) from total cost ($%)',
    row_cost.enrich_cost_usd, row_cost.total_cost_usd;

  if not exists (select 1 from public.cost_summary where notes_with_cost >= 1) then
    raise exception 'cost_summary returned no rows';
  end if;
  raise notice 'PASS: cost_summary aggregates across notes';

  delete from public.ai_jobs where note_id = note_uuid;
end
$$;

-- 12. `audio` bucket's allowed_mime_types matches every real MediaRecorder
-- output this app records, not whatever the row happened to hold when it
-- was first created. `insert ... on conflict do nothing` in
-- 20260801000400_rls.sql means an edit to that INSERT's array would never
-- reach an environment where the bucket row already exists -- this is the
-- guard against that ever happening silently again (2026-08-13, a real
-- iPhone recording rejected with `mime type audio/mp4 is not supported`
-- because the hosted bucket was stuck on an older, narrower list).
do $$
declare
  types text[];
  expected text[] := array[
    'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/opus',
    'audio/webm', 'audio/wav'
  ];
  missing text;
begin
  select allowed_mime_types into types from storage.buckets where id = 'audio';

  if types is null then
    raise exception 'audio bucket does not exist';
  end if;

  foreach missing in array expected loop
    if not (missing = any(types)) then
      raise exception 'audio bucket allowed_mime_types missing %: got %', missing, types;
    end if;
  end loop;
  raise notice 'PASS: audio bucket accepts every recorded MIME type (%)', types;
end
$$;


-- ---------------------------------------------------------------------------
-- 13. Web push subscriptions: isolation, scoped grant, ops-table denial
-- ---------------------------------------------------------------------------
-- SB-051. A subscription row identifies a device and carries the keys needed
-- to send that device a payload -- leaking one across users would let a
-- stranger's notification reach your phone. Same RLS treatment as notes,
-- asserted the same way rather than assumed to follow.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.push_subscriptions (endpoint, p256dh, auth_secret, user_agent)
values ('https://push.example.test/alice-1', 'alice-p256dh', 'alice-auth', 'test-agent');

do $$
begin
  -- The client owns its own keys and must be able to rewrite them: browsers
  -- rotate endpoints, and a re-subscribe is an upsert, not a new row.
  update public.push_subscriptions
     set endpoint = 'https://push.example.test/alice-2', p256dh = 'rotated'
   where endpoint = 'https://push.example.test/alice-1';

  -- The sender's own bookkeeping is not the client's to touch. Same
  -- column-scoped grant reasoning as notes.status (section 5b).
  begin
    update public.push_subscriptions set disabled_at = null;
    raise exception 'GRANT BREACH: authenticated client updated push_subscriptions.disabled_at';
  exception
    when insufficient_privilege then
      raise notice 'PASS: scoped grant blocks disabled_at, allows endpoint rotation';
  end;

  -- push_deliveries has RLS enabled and NO grant to authenticated -- denial
  -- twice over, on purpose.
  begin
    perform 1 from public.push_deliveries;
    raise exception 'GRANT BREACH: authenticated client read push_deliveries';
  exception
    when insufficient_privilege then
      raise notice 'PASS: push_deliveries is not reachable by the client';
  end;
end
$$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.push_subscriptions;
  if n <> 0 then
    raise exception 'RLS BREACH: user B sees % push subscription(s) of user A', n;
  end if;
  raise notice 'PASS: cross-user reads blocked on push_subscriptions';
end
$$;
commit;

-- ---------------------------------------------------------------------------
-- 14. push_due_candidates() counts what the badge counts
-- ---------------------------------------------------------------------------
-- The client rule (web/src/core/due.ts): category 'task', not completed, not
-- archived, due at or before the end of today, overdue folded in. This
-- asserts the SQL says the same thing -- drift here reaches the user as a
-- notification about a task the app itself does not list.
--
-- Bassam gets a due task too, but no subscription: he must not appear at all.
do $$
declare
  alice        uuid := '11111111-1111-1111-1111-111111111111';
  bassam       uuid := '22222222-2222-2222-2222-222222222222';
  overdue_note uuid;
  other_note   uuid;
  n_rows       integer;
  r            record;
begin
  insert into public.notes (user_id, client_id, source, status, input_language, raw_text)
  values (alice, gen_random_uuid(), 'text', 'ready', 'ar', 'overdue task')
  returning id into overdue_note;

  insert into public.note_enrichments
    (note_id, user_id, language, summary, category, action_due_at, title, model, prompt_version)
  values (overdue_note, alice, 'ar', 'summary', 'task', now() - interval '2 days',
          'the overdue one', 'test-model', 'v-test');

  -- Due in five days: real, dated, and deliberately not counted.
  insert into public.notes (user_id, client_id, source, status, input_language, raw_text)
  values (alice, gen_random_uuid(), 'text', 'ready', 'ar', 'later task')
  returning id into other_note;
  insert into public.note_enrichments
    (note_id, user_id, language, summary, category, action_due_at, model, prompt_version)
  values (other_note, alice, 'ar', 'summary', 'task', now() + interval '5 days',
          'test-model', 'v-test');

  -- Completed but overdue: done is done.
  insert into public.notes (user_id, client_id, source, status, input_language, raw_text, completed_at)
  values (alice, gen_random_uuid(), 'text', 'ready', 'ar', 'done task', now())
  returning id into other_note;
  insert into public.note_enrichments
    (note_id, user_id, language, summary, category, action_due_at, model, prompt_version)
  values (other_note, alice, 'ar', 'summary', 'task', now() - interval '2 days',
          'test-model', 'v-test');

  -- Archived but overdue: out of sight, out of the count.
  insert into public.notes (user_id, client_id, source, status, input_language, raw_text, archived_at)
  values (alice, gen_random_uuid(), 'text', 'ready', 'ar', 'archived task', now())
  returning id into other_note;
  insert into public.note_enrichments
    (note_id, user_id, language, summary, category, action_due_at, model, prompt_version)
  values (other_note, alice, 'ar', 'summary', 'task', now() - interval '2 days',
          'test-model', 'v-test');

  -- Bassam: overdue task, no subscription.
  insert into public.notes (user_id, client_id, source, status, input_language, raw_text)
  values (bassam, gen_random_uuid(), 'text', 'ready', 'ar', 'bassam task')
  returning id into other_note;
  insert into public.note_enrichments
    (note_id, user_id, language, summary, category, action_due_at, model, prompt_version)
  values (other_note, bassam, 'ar', 'summary', 'task', now() - interval '2 days',
          'test-model', 'v-test');

  select count(*) into n_rows from public.push_due_candidates();
  if n_rows <> 1 then
    raise exception 'push_due_candidates returned % rows, expected exactly 1 (Alice only -- Bassam has no subscription)', n_rows;
  end if;

  select * into r from public.push_due_candidates();
  if r.user_id <> alice then
    raise exception 'push_due_candidates returned the wrong user: %', r.user_id;
  end if;
  if r.overdue_count <> 1 then
    raise exception 'push_due_candidates overdue_count = %, expected 1 (completed, archived and later-this-week tasks must all be excluded)', r.overdue_count;
  end if;
  if r.due_today_count <> 0 then
    raise exception 'push_due_candidates due_today_count = %, expected 0', r.due_today_count;
  end if;
  if r.sample_note_id <> overdue_note then
    raise exception 'push_due_candidates picked the wrong sample note';
  end if;
  if r.timezone is null or r.local_hour is null or r.local_date is null then
    raise exception 'push_due_candidates returned no timezone/local clock (tz %, hour %, date %)',
      r.timezone, r.local_hour, r.local_date;
  end if;

  raise notice 'PASS: push_due_candidates counts 1 overdue for the subscribed user only (tz %, local hour %)',
    r.timezone, r.local_hour;
end
$$;

-- The same function must be unreachable from the client: it reads every
-- user's rows by design.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  begin
    perform public.push_due_candidates();
    raise exception 'GRANT BREACH: authenticated client executed push_due_candidates()';
  exception
    when insufficient_privilege then
      raise notice 'PASS: push_due_candidates is service-role only';
  end;
end
$$;
commit;

-- Cleanup so the script is re-runnable.
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222');

\echo 'ALL SCHEMA CHECKS PASSED'
