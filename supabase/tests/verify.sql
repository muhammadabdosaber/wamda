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

-- Cleanup so the script is re-runnable.
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222');

\echo 'ALL SCHEMA CHECKS PASSED'
