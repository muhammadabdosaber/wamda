-- ============================================================================
-- 14. Success metrics (SB-020)
-- ============================================================================
-- docs/10-product-spec.md names three metrics and none were measured. Scoped
-- with the owner 2026-08-08 (docs/13-tasks.md): SQL views, checked manually
-- in Supabase Studio -- no new page in web/, no folding into the digest.
--
-- Two of the three were near-free: stuck-note count and cost-per-note only
-- needed a view over data ai_jobs/notes already carry. Capture latency
-- (open -> durable) had zero instrumentation anywhere -- it was previously
-- only ever spot-measured by hand (SB-024: "95 ms with 8 queued", never
-- persisted) -- so it gets a new column, populated by the client, which
-- already measures its own IndexedDB write duration (web/src/data/outbox.ts
-- `capture()`) and sends it along on sync.
-- ============================================================================

alter table public.notes
  add column capture_latency_ms integer
    check (capture_latency_ms is null or capture_latency_ms >= 0);

comment on column public.notes.capture_latency_ms is
  'Client-measured ms from opening the outbox IndexedDB write to it resolving (SB-020). Client-reported, not verified server-side -- a bad value costs a metrics sample, nothing more.';

-- `create or replace function` only replaces a function with the IDENTICAL
-- parameter list. Adding p_capture_latency_ms below without this drop first
-- would leave the original 5-argument capture_note in place alongside the
-- new 6-argument one -- an overload, not a replacement -- and every existing
-- call site (which omits the new argument) becomes ambiguous between the two
-- defaulted signatures. Caught live: `capture_note(...) is not unique`.
drop function if exists public.capture_note(uuid, public.note_source, text, text, timestamptz);

create or replace function public.capture_note(
  p_client_id      uuid,
  p_source         public.note_source,
  p_language       text default 'ar',
  p_raw_text       text default null,
  p_client_created timestamptz default now(),
  p_capture_latency_ms integer default null
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public
as $$
  insert into public.notes (client_id, source, input_language, raw_text, client_created_at, status, capture_latency_ms)
  values (
    p_client_id,
    p_source,
    coalesce(p_language, 'ar'),
    nullif(btrim(p_raw_text), ''),
    coalesce(p_client_created, now()),
    case when p_source = 'text' then 'queued'::public.note_status
         else 'draft'::public.note_status end,
    p_capture_latency_ms
  )
  on conflict (user_id, client_id) do update
    set updated_at = now()
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- Capture latency: p50/p95 against docs/10-product-spec.md's target (p95 < 3 s)
-- ---------------------------------------------------------------------------
create view public.capture_latency_stats as
select
  count(*)                                                          as notes_measured,
  round(avg(capture_latency_ms))                                    as avg_ms,
  percentile_cont(0.5)  within group (order by capture_latency_ms)  as p50_ms,
  percentile_cont(0.95) within group (order by capture_latency_ms)  as p95_ms,
  max(capture_latency_ms)                                           as max_ms
from public.notes
where capture_latency_ms is not null;

comment on view public.capture_latency_stats is
  'One row: capture latency (open -> IndexedDB-durable) against the p95 < 3s target (SB-020). Not time-windowed -- the dataset is small enough that an all-time figure is still meaningful; revisit if that stops being true.';

-- ---------------------------------------------------------------------------
-- Stuck notes: docs/10-product-spec.md's own definition, "> 1 h", which is a
-- different (more generous) threshold than sweep's own 10-minute crash-
-- recovery cutoff (STUCK_MINUTES in supabase/functions/sweep/index.ts) --
-- that one exists to catch a killed worker fast, this one is the product
-- metric for "is the pipeline actually keeping up".
-- ---------------------------------------------------------------------------
create view public.stuck_notes as
select
  id as note_id,
  user_id,
  status,
  updated_at,
  round(extract(epoch from (now() - updated_at)) / 60)::integer as minutes_stuck
from public.notes
where status in ('draft', 'queued', 'transcribing', 'enriching')
  and updated_at < now() - interval '1 hour'
  and archived_at is null;

comment on view public.stuck_notes is
  'Notes outside a terminal state for over an hour (SB-020, target: 0). Excludes archived notes -- hidden from the user already, not a pipeline problem worth counting.';

-- ---------------------------------------------------------------------------
-- Cost per note: ai_jobs.cost_usd already exists per attempt; docs/10-
-- product-spec.md's target is specifically enrichment cost, but total cost
-- across every stage is worth having too.
-- ---------------------------------------------------------------------------
create view public.note_cost as
select
  note_id,
  sum(cost_usd) filter (where stage = 'enrich') as enrich_cost_usd,
  sum(cost_usd)                                 as total_cost_usd
from public.ai_jobs
where note_id is not null and cost_usd is not null
group by note_id;

comment on view public.note_cost is
  'Per-note spend from ai_jobs.cost_usd, split out for enrich vs every stage (SB-020).';

create view public.cost_summary as
select
  count(*)                    as notes_with_cost,
  round(avg(enrich_cost_usd), 6) as avg_enrich_cost_usd,
  round(avg(total_cost_usd), 6)  as avg_total_cost_usd,
  round(sum(total_cost_usd), 6)  as total_cost_usd
from public.note_cost;

comment on view public.cost_summary is
  'One row: average enrichment cost per note against the < $0.015 target (SB-020), and total spend across every stage.';

-- ---------------------------------------------------------------------------
-- None of the four views above are granted to `authenticated`. Scoped with
-- the owner: the intended reader is Supabase Studio, which connects as the
-- Postgres superuser and bypasses RLS entirely -- same reasoning as
-- failed_ai_jobs (SB-019, migration 20260808000100). Granting these to the
-- client role would need `security_invoker` on each view first, or the
-- underlying tables' RLS would be silently bypassed for every authenticated
-- user, not just the owner.
-- ---------------------------------------------------------------------------
