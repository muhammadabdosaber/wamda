-- ============================================================================
-- 02. Enums + core tables
-- ============================================================================
-- THE LOAD-BEARING RULE OF THIS SCHEMA:
--   Never store a display label as a key.
--
-- Categories, priorities, and actions are stable English identifiers. Their
-- Arabic (later English) labels live in the client's i18n bundle. Storing a
-- category as the Arabic string would mean a data migration the moment a
-- second language appears -- and a broken UI the moment a label is reworded.
-- Storing 'task' costs nothing and survives every future language.
-- ============================================================================

create type public.note_source      as enum ('voice', 'text');
create type public.note_status      as enum ('draft', 'queued', 'transcribing', 'enriching', 'ready', 'failed');
create type public.note_category    as enum ('task', 'event', 'idea', 'learning', 'reference', 'personal', 'other');
create type public.note_priority    as enum ('urgent', 'high', 'normal', 'low');
create type public.suggested_action as enum ('create_task', 'create_event', 'archive', 'review_later', 'none');
create type public.relation_kind    as enum ('similar', 'continuation', 'duplicate');
create type public.job_stage        as enum ('transcribe', 'detect_language', 'enrich', 'embed', 'relate', 'digest');
create type public.job_status       as enum ('pending', 'running', 'succeeded', 'failed');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- ui_locale defaults to Arabic. The app is Arabic-first by default, not
-- Arabic-only by construction.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text,
  ui_locale      text        not null default 'ar',
  input_locale   text        not null default 'ar',
  timezone       text        not null default 'Asia/Dubai',
  week_starts_on smallint    not null default 6,  -- 0=Sun .. 6=Sat
  audio_retention_days smallint not null default 30,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint profiles_ui_locale_ck    check (ui_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint profiles_input_locale_ck check (input_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint profiles_week_start_ck   check (week_starts_on between 0 and 6)
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Provision a profile on signup so the client never has to special-case a
-- missing row on first launch.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create table public.notes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid()
                        references auth.users (id) on delete cascade,

  -- Offline idempotency: the client mints this before it has connectivity and
  -- replays with it. Unique per user, so a retried sync cannot duplicate a
  -- thought the user only had once.
  client_id           uuid not null,

  source              public.note_source not null,
  status              public.note_status not null default 'draft',

  -- input_language  = what we were TOLD the note is (resolved at the edge)
  -- detected_language = what the pipeline OBSERVED it to be
  -- Keeping both separate is what makes phase 2 a routing change, not a rewrite.
  input_language      text not null default 'ar',
  detected_language   text,
  language_confidence real,

  raw_text            text,
  audio_path          text,
  audio_duration_ms   integer,
  transcript_confidence real,

  -- Client wall-clock at capture. Distinct from created_at (server receipt),
  -- which can be hours later for an offline note. Ordering the timeline by
  -- created_at would scramble a day's notes after a sync.
  client_created_at   timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,

  constraint notes_client_id_uq       unique (user_id, client_id),
  constraint notes_input_language_ck  check (input_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint notes_lang_conf_ck       check (language_confidence is null or language_confidence between 0 and 1),
  constraint notes_transcript_conf_ck check (transcript_confidence is null or transcript_confidence between 0 and 1),
  -- A voice note may arrive with no text yet; a text note may not.
  constraint notes_text_present_ck    check (source = 'voice' or nullif(btrim(raw_text), '') is not null)
);

-- Lexical search vector, language-dispatched.
--
-- CAVEAT: Postgres does not recompute stored generated columns when a
-- referenced function is redefined. If normalize_ar() or ts_config_for()
-- ever changes, existing rows must be backfilled:
--   update public.notes set raw_text = raw_text;
alter table public.notes
  add column search_vector tsvector
  generated always as (
    to_tsvector(
      public.ts_config_for(input_language),
      public.normalize_for(raw_text, input_language)
    )
  ) stored;

create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- note_enrichments -- ONE ROW PER (note, language)
-- ---------------------------------------------------------------------------
-- This is the entire multilingual story in one table. An English summary of
-- an Arabic note in phase 2 is a second row, not a schema change.
-- ---------------------------------------------------------------------------
create table public.note_enrichments (
  id               uuid primary key default gen_random_uuid(),
  note_id          uuid not null references public.notes (id) on delete cascade,
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  language         text not null,

  title            text,
  summary          text not null,
  category         public.note_category    not null default 'other',
  priority         public.note_priority    not null default 'normal',
  suggested_action public.suggested_action not null default 'none',
  action_due_at    timestamptz,

  -- Preserved context the model extracted but that has no dedicated column:
  -- people, places, referenced artifacts, open questions.
  context          jsonb not null default '{}'::jsonb,

  model            text not null,
  prompt_version   text not null,
  input_tokens     integer,
  output_tokens    integer,
  cached_tokens    integer,
  created_at       timestamptz not null default now(),

  constraint note_enrichments_uq       unique (note_id, language, prompt_version),
  constraint note_enrichments_lang_ck  check (language ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

-- ---------------------------------------------------------------------------
-- tags: language-neutral identity + per-language labels
-- ---------------------------------------------------------------------------
create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  slug       text not null,
  created_at timestamptz not null default now(),
  constraint tags_slug_uq unique (user_id, slug)
);

create table public.tag_labels (
  tag_id   uuid not null references public.tags (id) on delete cascade,
  language text not null,
  label    text not null,
  primary key (tag_id, language),
  constraint tag_labels_lang_ck check (language ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

create table public.note_tags (
  note_id    uuid not null references public.notes (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  confidence real,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- note_embeddings -- ONE ROW PER (note, language, model)
-- ---------------------------------------------------------------------------
-- The model is part of the key so a future embedding-model upgrade can be
-- rolled out incrementally (dual-write, verify, cut over) instead of as a
-- big-bang reindex that takes search offline.
-- ---------------------------------------------------------------------------
create table public.note_embeddings (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.notes (id) on delete cascade,
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  language    text not null,
  model       text not null,
  chunk_index smallint not null default 0,
  content     text not null,
  embedding   extensions.vector(1024) not null,
  created_at  timestamptz not null default now(),
  constraint note_embeddings_uq unique (note_id, language, model, chunk_index)
);

-- ---------------------------------------------------------------------------
-- note_relations
-- ---------------------------------------------------------------------------
create table public.note_relations (
  from_note_id uuid not null references public.notes (id) on delete cascade,
  to_note_id   uuid not null references public.notes (id) on delete cascade,
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
  kind         public.relation_kind not null default 'similar',
  score        real not null,
  created_at   timestamptz not null default now(),
  primary key (from_note_id, to_note_id, kind),
  constraint note_relations_no_self_ck check (from_note_id <> to_note_id),
  constraint note_relations_score_ck   check (score between 0 and 1)
);

-- ---------------------------------------------------------------------------
-- weekly_digests
-- ---------------------------------------------------------------------------
create table public.weekly_digests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
  language     text not null,
  period_start date not null,
  period_end   date not null,
  content      jsonb not null,
  model        text not null,
  created_at   timestamptz not null default now(),
  constraint weekly_digests_uq     unique (user_id, period_start, language),
  constraint weekly_digests_period_ck check (period_end > period_start)
);

-- ---------------------------------------------------------------------------
-- ai_jobs -- pipeline observability
-- ---------------------------------------------------------------------------
-- Records shape and cost, never content. Note text is the most sensitive data
-- in the system; it must not end up in an operational table that gets queried
-- casually during debugging.
-- ---------------------------------------------------------------------------
create table public.ai_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  note_id      uuid references public.notes (id) on delete cascade,
  stage        public.job_stage  not null,
  status       public.job_status not null default 'pending',
  language     text,
  provider     text,
  model        text,
  attempt      smallint not null default 1,
  latency_ms   integer,
  input_tokens integer,
  output_tokens integer,
  cached_tokens integer,
  cost_usd     numeric(10, 6),
  error_code   text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

comment on table public.ai_jobs is
  'Pipeline telemetry: stage, status, latency, tokens, cost, error code. Never note content.';
